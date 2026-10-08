/*
 * Zatygold's Spectator - a playable Spectator for Civilization VII.
 * Copyright (C) 2026  Zatygold
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Zatygold's Spectator - timeline (in-game scope).
 *
 * One leader's horizontal notched bar in the style of the Victories screen's
 * Culture tab (culture-victory-tab.js): a notch per percent of Age progress
 * (the current progress, crisis stages and Age changes marked, and labelled
 * on the first and last bars), and a pin per group of logged things (such as
 * units) where they happened: pin and dot in the category's colour
 * (with a glow for some), the thing's own icon (the Culture "+" when it holds
 * several), the count below, and a tooltip listing each type.
 *
 * Props: subject ({ categories: [{ color, glow }], pinIcon(source),
 * pinColor(source) (else the category's), icon(source), name(source),
 * detail(source) }: what is logged), pins ([{ position, category,
 * lead (the source it shows), count, turns: [first, last], sources: [{ type, category, count, ... }]
 * }]), notches ([{ position, highlight, color, divider }]: a colour replaces
 * the notch colours, a divider spans the bar's height at its position, between
 * Ages), labels ([{ position, text, color, start, bottom }]: centred on their
 * notch or from it, over or under the bar), showTopLabels / showBottomLabels
 * (the first and last bars), title (the tooltip heading), links ([[from, to]]
 * pin positions joined by the Culture tab's dashed arc).
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createEffect, For, onCleanup, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { CardFrame } from 'fs://game/core/ui-next/components/card-frame.js';
import { Divider } from 'fs://game/core/ui-next/components/divider.js';
import { Tooltip, TooltipHorizontalPosition, TooltipVerticalPosition } from 'fs://game/core/ui-next/components/tooltip.js';
import { drawDashedQuadraticBezier } from 'fs://game/core/ui-next/utilities/canvas-utilities.js';

// The Culture tab's notch colours.
const NOTCH = { color: 'rgba(97, 98, 102, 0.6)', highlight: 'rgba(120, 139, 179, 0.9)', divider: 'rgba(225, 214, 180, 0.6)' };
const DIVIDER_PX = 2;
const AGE_LABEL_GAP = '0.75rem';   // between an Age's divider and its name
const BOTTOM_LABEL_GAP = '0.15rem';   // between the notches and a label under them
const NOTCH_BOTTOM = 90;              // where the notches end, in % of the bar's height (drawNotches)
const NOTCH_WIDTH = 0.8;   // a notch's width in % of the bar (drawNotches)
// The Culture tab's arc between pins: colour, width, dash and gap, end inset, and height by distance.
const ARC = { color: '#616266', width: 2, dash: 6, gap: 4, inset: 6, min: 1, max: 64, linear: 0.38, root: 0.06 };
const DOT_CLASS = 'zom-pin-dot';

const T = {
  bar: template(`<div class="absolute top-0 bottom-0"><div class="absolute inset-0 pointer-events-none"><canvas class="size-full"></canvas></div><div class="absolute inset-0 pointer-events-none"><canvas class="size-full"></canvas></div></div>`),
  label: template(`<div class="absolute text-xs whitespace-nowrap pointer-events-none"></div>`),
  pin: template(`<div class="flex flex-col absolute items-center justify-center h-full pointer-events-auto -translate-x-1\\/2"><div class="size-3 mb-1"></div></div>`),
  pinFace: template(`<div class="relative size-14 mb-1 mt-1"><div class="absolute inset-0 bg-contain bg-center bg-no-repeat pointer-events-none"></div><div class="absolute inset-0 bg-contain bg-center bg-no-repeat"></div><div class="absolute size-7 top-1\\.5 left-3\\.5 bg-no-repeat bg-center bg-contain"></div></div>`),
  plus: template(`<div class="absolute size-5 bottom-4 right-3 bg-contain bg-center bg-no-repeat pointer-events-none"></div>`),
  count: template(`<div></div>`),
  heading: template(`<div class="text-title uppercase text-secondary mb-1"></div>`),
  turns: template(`<div class="mb-3"></div>`),
  source: template(`<div class="flex flex-row items-center victories-culture-tooltip-body p-1 my-1 w-96 relative"><div class="size-9 bg-contain bg-no-repeat bg-center ml-2"></div><div class="flex flex-col justify-center min-h-11 w-64"><div class="uppercase text-title"></div><div class="text-xs"></div></div><div class="absolute right-2"></div></div>`)
};

const turnText = ([first, last]) => (first === last
  ? Locale.compose('LOC_VICTORIES_ITEM_TOOLTIP_TURN', first)
  : Locale.compose('LOC_ZOM_GRAPH_TURNS', first, last));

const PinTooltip = (props) => createComponent(Tooltip.Frame, {
  'class': 'relative flex flex-col p-2 items-center justify-center',
  get children() {
    const heading = T.heading();
    heading.textContent = props.title;
    const turns = T.turns();
    turns.textContent = turnText(props.pin.turns);
    return [heading, turns, createComponent(CardFrame, {
      'class': 'mb-3',
      get children() {
        return createComponent(For, {
          get each() { return props.pin.sources; },
          children: (source, index) => {
            const row = T.source();
            const icon = row.firstChild;
            const text = icon.nextSibling;
            icon.style.backgroundImage = props.subject.icon(source);
            text.firstChild.textContent = props.subject.name(source);
            text.lastChild.textContent = props.subject.detail(source);
            text.nextSibling.textContent = `${source.count}`;
            insert(row, createComponent(Divider.Vertical, { margin: 2, length: '13' }), text);
            return [row, createComponent(Show, {
              get when() { return index() < props.pin.sources.length - 1; },
              get children() { return createComponent(Divider.Horizontal, { 'class': 'my-1 ml-2', length: '84' }); }
            })];
          }
        });
      }
    })];
  }
});

const PIN_ART = 'url(blp:culture_pin_minor)';
const GLOW = { scale: 1.3, origin: '50% 45%', blur: '0.3rem', opacity: '0.9' };   // a larger, blurred copy of the pin behind it

/** The pin itself: tinted pin art, the thing's icon, the "+" when grouped and a glow if the category has one. */
function pinFace(pin, subject) {
  const category = subject.categories[pin.category] ?? {};
  const face = T.pinFace();
  const [glow, art, icon] = Array.from(face.children);
  art.style.backgroundImage = PIN_ART;
  if (category.glow) {
    glow.style.backgroundImage = PIN_ART;
    glow.style.setProperty('fxs-background-image-tint', category.glow);
    glow.style.transform = `scale(${GLOW.scale})`;
    glow.style.transformOrigin = GLOW.origin;
    glow.style.filter = `blur(${GLOW.blur})`;
    glow.style.opacity = GLOW.opacity;
  }
  art.style.setProperty('fxs-background-image-tint', subject.pinColor?.(pin.lead) ?? category.color ?? '#ffffff');
  icon.style.backgroundImage = subject.pinIcon(pin.lead);
  if (pin.sources.length > 1) {
    const plus = T.plus();
    plus.style.backgroundImage = 'url(blp:victories_culturePlus)';
    face.appendChild(plus);
  }
  return face;
}

/** Pin, dot and count stacked like a Culture pip, the dot in the pin's colour. */
const Pin = (props) => {
  const root = T.pin();
  const dot = root.firstChild;
  dot.classList.add(DOT_CLASS);
  root.style.left = `${props.pin.position}%`;
  dot.style.backgroundColor = props.subject.categories[props.pin.category]?.color ?? '#ffffff';
  dot.style.border = '2px solid black';
  dot.style.borderRadius = '50%';
  insert(root, createComponent(Tooltip, {
    initialVPosition: TooltipVerticalPosition.TOP,
    initialHPosition: TooltipHorizontalPosition.CENTER,
    get children() {
      return [
        createComponent(Tooltip.Trigger, { children: pinFace(props.pin, props.subject) }),
        createComponent(Tooltip.Content, { get children() { return createComponent(PinTooltip, { pin: props.pin, title: props.title, subject: props.subject }); } })
      ];
    }
  }), dot);
  const count = T.count();
  count.textContent = `${props.pin.count}`;
  root.appendChild(count);
  return root;
};

/** A label over the bar's top or under the bar: centred on its notch, or starting at it (an Age's name after its divider). */
function notchLabel({ position, text, color, start, bottom }) {
  const label = T.label();
  if (bottom) {   // just under the notches
    label.style.top = `${NOTCH_BOTTOM}%`;
    label.style.marginTop = BOTTOM_LABEL_GAP;
  } else label.style.top = '0';
  label.style.left = `${start ? position : position + NOTCH_WIDTH / 2}%`;
  if (start) label.style.marginLeft = AGE_LABEL_GAP;
  else label.style.transform = 'translateX(-50%)';
  if (color) label.style.color = color;
  label.textContent = text;
  return label;
}

/** The Culture tab's notches: thin bars over 80% of the height, highlighted ones brighter; dividers full height. */
function drawNotches(canvas, notches) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || !rect.width) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const top = canvas.height * (1 - NOTCH_BOTTOM / 100);
  const height = canvas.height * (2 * NOTCH_BOTTOM / 100 - 1);
  const width = Math.max(canvas.width * NOTCH_WIDTH / 100, 1);
  for (const notch of notches) {
    const x = (notch.position / 100) * canvas.width;
    if (notch.divider) {   // on the boundary between two Ages
      ctx.fillStyle = NOTCH.divider;
      ctx.fillRect(Math.round(x - DIVIDER_PX / 2), 0, DIVIDER_PX, canvas.height);
      continue;
    }
    ctx.fillStyle = notch.color ?? (notch.highlight ? NOTCH.highlight : NOTCH.color);
    ctx.fillRect(x, top, width, height);
  }
}

/** The Culture tab's dashed arcs between linked pins, from dot to dot. */
function drawLinks(canvas, bar, links) {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  const dot = bar.querySelector('.' + DOT_CLASS);
  if (!ctx || !rect.width || !dot) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dotRect = dot.getBoundingClientRect();
  const y = dotRect.top + dotRect.height / 2 - rect.top;
  ctx.strokeStyle = ARC.color;
  ctx.lineWidth = ARC.width;
  for (const [from, to] of links) {
    const startX = (from / 100) * canvas.width + ARC.inset;
    const endX = (to / 100) * canvas.width - ARC.inset;
    const distance = Math.abs(endX - startX);
    const height = Math.min(ARC.max, ARC.min + distance * ARC.linear + Math.sqrt(distance) * ARC.root);
    drawDashedQuadraticBezier(ctx, startX, y, (startX + endX) / 2, y - height, endX, y, ARC.dash, ARC.gap);
  }
}

const Timeline = (props) => {
  const bar = T.bar();
  const canvas = bar.firstChild.firstChild;
  const linkCanvas = bar.children[1].firstChild;
  bar.style.left = '1.5%';
  bar.style.right = '2%';
  for (const bottom of [false, true]) {
    insert(bar, createComponent(Show, {
      get when() { return bottom ? props.showBottomLabels : props.showTopLabels; },
      get children() { return createComponent(For, { get each() { return props.labels.filter((l) => !!l.bottom === bottom); }, children: notchLabel }); }
    }), null);
  }
  insert(bar, createComponent(For, {
    get each() { return props.pins; },
    children: (pin) => createComponent(Pin, { pin, subject: props.subject, get title() { return props.title; } })
  }), null);
  let frame = 0;
  createEffect(() => {
    const { notches, links } = props;
    void props.pins;   // the arcs follow the pins' layout
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      drawNotches(canvas, notches);
      drawLinks(linkCanvas, bar, links ?? []);
    }));
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    for (const c of [canvas, linkCanvas]) { c.width = 0; c.height = 0; }
  });
  return bar;
};

export { NOTCH_WIDTH, Timeline };
