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
 * One leader's notched bar in the style of the Victories screen's Culture tab
 * (culture-victory-tab.js): a notch per percent of Age progress, and a pin per
 * group of logged things with a tooltip listing them. Props: subject (see
 * observer-graph-timelines.js), title (the tooltip heading), pins ([{ position,
 * category, lead, count, turns: [first, last], sources }]), notches ([{ position,
 * highlight, crisis, divider }]), labels ([{ position, text, color, start, bottom }]),
 * showTopLabels / showBottomLabels, links ([[from, to]] pin positions) and bands.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createEffect, createMemo, For, onCleanup, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { CardFrame } from 'fs://game/core/ui-next/components/card-frame.js';
import { Divider } from 'fs://game/core/ui-next/components/divider.js';
import { Tooltip, TooltipHorizontalPosition, TooltipVerticalPosition } from 'fs://game/core/ui-next/components/tooltip.js';
import { drawDashedQuadraticBezier } from 'fs://game/core/ui-next/utilities/canvas-utilities.js';
import { drawCrisisMark } from './observer-crisis.js';

// The Culture tab's notch colours.
const NOTCH = { color: 'rgba(97, 98, 102, 0.6)', highlight: 'rgba(120, 139, 179, 0.9)', divider: 'rgba(225, 214, 180, 0.6)' };
const BAND_SHADE = 0.6;               // a band's notches darker than its colour, apart from the pins in it
const BAND_PARTS = 4;                 // a shared notch's default division (quarters), else a band's `parts`
const DIVIDER_PX = 2;
const AGE_LABEL_GAP = '0.75rem';      // between an Age's divider and its name
const BOTTOM_LABEL_GAP = '0.15rem';   // between the notches and a label under them
const NOTCH_BOTTOM = 90;              // where the notches end, in % of the bar's height (drawNotches)
const NOTCH_WIDTH = 0.8;              // a notch's width in % of the bar (drawNotches)
const CRISIS_MARK_SIZE = 0.6;         // a crisis marker's half width, in notch widths
const PIN_BRIGHTNESS = 1.3;           // pin art is darker than its tint: the tint is brightened instead
const PIN_ICON_BACKING = 'rgba(0, 0, 0, 0.45)';   // a dark disc behind a pin's icon, readable on any pin colour
// Pins use no CSS filters: each filtered element is a render layer of its own, and a long view has hundreds of pins.
// The Culture tab's arc between pins: colour, width, dash and gap, end inset, and height by distance.
const ARC = { color: '#616266', width: 2, dash: 6, gap: 4, inset: 6, min: 1, max: 64, linear: 0.38, root: 0.06 };
const DOT_CLASS = 'zom-pin-dot';

const T = {
  bar: template(`<div class="absolute top-0 bottom-0"><div class="absolute inset-0 pointer-events-none"><canvas class="size-full"></canvas></div><div class="absolute inset-0 pointer-events-none"><canvas class="size-full"></canvas></div></div>`),
  label: template(`<div class="absolute text-xs whitespace-nowrap pointer-events-none"></div>`),
  pin: template(`<div class="flex flex-col absolute items-center justify-center h-full pointer-events-auto -translate-x-1\\/2"><div class="size-3 mb-1"></div></div>`),
  pinFace: template(`<div class="relative size-14 mb-1 mt-1"><div class="absolute inset-0 bg-contain bg-center bg-no-repeat pointer-events-none"></div><div class="absolute inset-0 bg-contain bg-center bg-no-repeat"></div><div class="absolute size-7 top-1\\.5 left-3\\.5 rounded-full pointer-events-none"></div><div class="absolute size-7 top-1\\.5 left-3\\.5 bg-no-repeat bg-center bg-contain"></div></div>`),
  plus: template(`<div class="absolute size-5 bottom-4 right-3 bg-contain bg-center bg-no-repeat pointer-events-none"></div>`),
  count: template(`<div></div>`),
  heading: template(`<div class="text-title uppercase text-secondary mb-1"></div>`),
  turns: template(`<div class="mb-3"></div>`),
  sectionTitle: template(`<div class="font-title text-xs uppercase text-secondary ml-3 mt-1"></div>`),
  source: template(`<div class="flex flex-row items-center victories-culture-tooltip-body p-1 my-1 w-96 relative"><div class="size-9 bg-contain bg-no-repeat bg-center ml-2"></div><div class="flex flex-col justify-center min-h-11 w-64"><div class="uppercase text-title"></div><div class="text-xs"></div></div><div class="absolute right-2"></div></div>`)
};

/** "Turn 12", or "Turns 12–15" for a span. */
const turnText = ([first, last]) => (first === last
  ? Locale.compose('LOC_VICTORIES_ITEM_TOOLTIP_TURN', first)
  : Locale.compose('LOC_ZOM_GRAPH_TURNS', first, last));

/**
 * The pin's sources in sections ({ title, sources, compact }): the subject's
 * (each holding its categories, in order, those without sources left out),
 * else one untitled section of them all; each shown in its own panel.
 */
function pinSections(pin, subject) {
  if (!subject.sections) return [{ sources: pin.sources }];
  return subject.sections.map((section) => ({ ...section, sources: pin.sources.filter((s) => section.categories.includes(s.category)) }))
    .filter((section) => section.sources.length);
}

/** A source's row: icon, name, detail and count. */
function sourceRow(subject, source) {
  const row = T.source();
  const icon = row.firstChild;
  const text = icon.nextSibling;
  icon.style.backgroundImage = subject.icon(source);
  tint(icon, subject.iconTint?.(source));
  text.firstChild.textContent = subject.name(source);
  text.lastChild.textContent = subject.detail(source);
  text.nextSibling.textContent = `${source.count}`;
  insert(row, createComponent(Divider.Vertical, { margin: 2, length: '13' }), text);
  return row;
}

/** The things' names, each once with its count past one: "Farm ×2, Mine". */
function namesOf(subject, sources) {
  const counts = new Map();
  for (const s of sources) counts.set(subject.name(s), (counts.get(subject.name(s)) ?? 0) + s.count);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ');
}

/**
 * A compact section's rows: one per group (section.by(source); one in all
 * without it), headed by section.head(sources) ({ icon, tint, name }; else the
 * first thing's), its things' names under it and their total.
 */
function compactRows(subject, section) {
  const groups = new Map();
  for (const s of section.sources) {
    const key = section.by?.(s) ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.values()].map((sources) => {
    const head = section.head?.(sources) ?? { icon: subject.icon(sources[0]), tint: subject.iconTint?.(sources[0]), name: subject.name(sources[0]) };
    const shown = { ...subject, icon: () => head.icon, iconTint: () => head.tint, name: () => head.name, detail: () => namesOf(subject, sources) };
    return sourceRow(shown, { ...sources[0], count: sources.reduce((sum, s) => sum + s.count, 0) });
  });
}

const rowDivider = () => createComponent(Divider.Horizontal, { 'class': 'my-1 ml-2', length: '84' });

const PinTooltip = (props) => createComponent(Tooltip.Frame, {
  'class': 'relative flex flex-col p-2 items-center justify-center',
  get children() {
    const heading = T.heading();
    heading.textContent = props.title;
    const turns = T.turns();
    turns.textContent = turnText(props.pin.turns);
    const sections = pinSections(props.pin, props.subject);
    const panels = sections.map((section, i) => {
      const rows = section.compact ? compactRows(props.subject, section) : section.sources.map((source) => sourceRow(props.subject, source));
      const title = section.title ? [Object.assign(T.sectionTitle(), { textContent: Locale.compose(section.title) })] : [];
      const children = [...title, ...rows.flatMap((row, n) => (n ? [rowDivider(), row] : [row]))];
      return createComponent(CardFrame, { 'class': i < sections.length - 1 ? 'mb-2' : 'mb-3', children });
    });
    return [heading, turns, ...panels];
  }
});

const PIN_ART = 'url(blp:culture_pin_minor)';

/** Tints an image element's art (the game's own image tint), when given a colour. */
const tint = (element, color) => { if (color) element.style.setProperty('fxs-background-image-tint', color); };
const GLOW = { scale: 1.3, origin: '50% 45%', opacity: '0.7' };   // a larger copy of the pin behind it, in the glow colour

/** A CSS colour ('#rrggbb' or 'rgb(a)(...)') with its channels scaled by `factor` (capped), else as it is. */
function brighten(color, factor) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  const channels = hex ? [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) : /^rgba?\(([^)]+)\)$/.exec(color)?.[1].split(',').slice(0, 3).map(Number);
  if (!channels || channels.some(Number.isNaN)) return color;
  return `rgb(${channels.map((c) => Math.min(255, Math.round(c * factor))).join(', ')})`;
}

/** The pin itself: tinted pin art, the thing's icon (on a dark disc, never tinted), the "+" when grouped and a glow if the category has one. */
function pinFace(pin, subject) {
  const category = subject.categories[pin.category] ?? {};
  const face = T.pinFace();
  const [glow, art, backing, icon] = Array.from(face.children);
  art.style.backgroundImage = PIN_ART;
  if (category.glow) {
    glow.style.backgroundImage = PIN_ART;
    glow.style.setProperty('fxs-background-image-tint', category.glow);
    glow.style.transform = `scale(${GLOW.scale})`;
    glow.style.transformOrigin = GLOW.origin;
    glow.style.opacity = GLOW.opacity;
  }
  art.style.setProperty('fxs-background-image-tint', brighten(subject.pinColor?.(pin.lead) ?? category.color ?? '#ffffff', PIN_BRIGHTNESS));
  backing.style.backgroundColor = PIN_ICON_BACKING;
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
  dot.style.backgroundColor = props.subject.dotColor?.(props.pin.lead) ?? props.subject.categories[props.pin.category]?.color ?? '#ffffff';
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
  if (props.subject.pinCount !== false) {
    const count = T.count();
    count.textContent = `${props.pin.count}`;
    root.appendChild(count);
  }
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

/** A '#rrggbb' colour darkened by `factor` (0-1). */
function shade(color, factor) {
  const n = parseInt(color.slice(1), 16);
  return `rgb(${[16, 8, 0].map((bit) => Math.round(((n >> bit) & 255) * factor)).join(', ')})`;
}

/** Parts of a notch for each of `count` colours: one each, the first (by layer) the rest ("3, 1" of quarters). */
const sharesOf = (count, parts) => (count > 1 && count <= parts ? [parts - count + 1, ...Array(count - 1).fill(1)] : Array(count).fill(1));

/**
 * The colours of the bands the notch's slot (its share of the bar, `spacing`
 * wide) overlaps - the first of each layer (bands without one share a layer),
 * by layer - each with its share of the notch: [{ layer, color, share, smooth }].
 * A solo band takes the whole notch.
 */
function notchMix(bands, position, spacing) {
  const centre = position + NOTCH_WIDTH / 2;
  const layers = new Map();
  let parts = BAND_PARTS;
  for (const b of bands) {
    const layer = b.layer ?? 0;
    if (!(centre - spacing / 2 <= b.to && centre + spacing / 2 > b.from) || layers.has(layer)) continue;   // a span ending on a slot's start (whole progress) fills it
    if (b.solo) return [{ layer, color: shade(b.color, BAND_SHADE), share: 1, smooth: false }];
    layers.set(layer, { layer, color: shade(b.color, BAND_SHADE), smooth: !!b.smooth });
    parts = b.parts ?? parts;
  }
  const mix = [...layers.values()].sort((x, y) => x.layer - y.layer);
  const shares = sharesOf(mix.length, parts);
  const total = shares.reduce((x, y) => x + y, 0);
  return mix.map((m, i) => ({ ...m, share: shares[i] / total }));
}

/** Each notch's mix eased toward its neighbours' (smooth bands only, not into a bare notch), so the colours blend from notch to notch. */
function smoothMixes(mixes) {
  const smooth = (mix) => mix.length && mix.every((m) => m.smooth);
  return mixes.map((mix, i) => {
    const near = [mixes[i - 1], mixes[i + 1]].filter((m) => m && smooth(m));
    if (!smooth(mix) || !near.length) return mix;
    const byLayer = new Map();
    const add = (m, weight) => m.forEach((part) => {
      const sum = byLayer.get(part.layer) ?? { ...part, share: 0 };
      sum.share += part.share * weight;
      byLayer.set(part.layer, sum);
    });
    add(mix, 2);
    near.forEach((m) => add(m, 1));
    return [...byLayer.values()].map((part) => ({ ...part, share: part.share / (2 + near.length) })).sort((x, y) => x.layer - y.layer);
  });
}

/** Sizes the canvas to its box (only when that changed, so its texture is kept), or null while it has no size. */
function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const [width, height] = [Math.round(rect.width), Math.round(rect.height)];
  if (!width || !height) return null;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return rect;
}

/** The Culture tab's notches: thin bars over 80% of the height, highlighted ones brighter, band ones in their (darkened) colours, crisis ones marked; dividers full height. */
function drawNotches(canvas, notches, bands) {
  const rect = fitCanvas(canvas);
  const ctx = rect && canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const top = canvas.height * (1 - NOTCH_BOTTOM / 100);
  const height = canvas.height * (2 * NOTCH_BOTTOM / 100 - 1);
  const width = Math.max(canvas.width * NOTCH_WIDTH / 100, 1);
  const slots = notches.filter((n) => !n.divider);
  const spacing = slots.length > 1 ? slots[1].position - slots[0].position : NOTCH_WIDTH;
  const mixes = new Map(smoothMixes(slots.map((n) => notchMix(bands, n.position, spacing))).map((mix, i) => [slots[i], mix]));
  for (const notch of notches) {
    const x = (notch.position / 100) * canvas.width;
    if (notch.divider) {   // on the boundary between two Ages
      ctx.fillStyle = NOTCH.divider;
      ctx.fillRect(Math.round(x - DIVIDER_PX / 2), 0, DIVIDER_PX, canvas.height);
      continue;
    }
    const mix = notch.highlight ? [{ color: NOTCH.highlight, share: 1 }] : mixes.get(notch);
    let y = top;
    for (const { color, share } of mix.length ? mix : [{ color: NOTCH.color, share: 1 }]) {   // top to bottom, each its share
      ctx.fillStyle = color;
      ctx.fillRect(x, y, width, height * share);
      y += height * share;
    }
    if (notch.crisis) for (const [base, direction] of [[top, 1], [top + height, -1]]) drawCrisisMark(ctx, x + width / 2, base, direction, notch.crisis, width * CRISIS_MARK_SIZE);
  }
}

/** Over the notches: the Culture tab's dashed arcs between linked pins, from dot to dot. */
function drawOverlay(canvas, bar, links) {
  const rect = fitCanvas(canvas);
  const ctx = rect && canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const dot = bar.querySelector('.' + DOT_CLASS);
  if (!dot || !links.length) return;
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

/** What a pin shows: an updated pin with the same keeps its element (and an open tooltip) instead of being rebuilt. */
const pinKey = (pin, subject) => [
  pin.position, pin.category, pin.count, pin.turns.join('-'), subject.pinIcon(pin.lead), subject.pinColor?.(pin.lead),
  pin.sources.map((s) => `${s.category}:${s.count}:${subject.name(s)}`).join(',')
].join('|');

const Timeline = (props) => {
  const bar = T.bar();
  const canvas = bar.firstChild.firstChild;
  const overlay = bar.children[1].firstChild;
  bar.style.left = '1.5%';
  bar.style.right = '2%';
  for (const bottom of [false, true]) {
    insert(bar, createComponent(Show, {
      get when() { return bottom ? props.showBottomLabels : props.showTopLabels; },
      get children() { return createComponent(For, { get each() { return props.labels.filter((l) => !!l.bottom === bottom); }, children: notchLabel }); }
    }), null);
  }
  let kept = new Map();
  const pins = createMemo(() => {
    const next = new Map();
    const list = props.pins.map((pin) => {
      const key = pinKey(pin, props.subject);
      const same = kept.get(key) ?? pin;
      next.set(key, same);
      return same;
    });
    kept = next;
    return list;
  }, [], { equals: (a, b) => a.length === b.length && a.every((pin, i) => pin === b[i]) });
  insert(bar, createComponent(For, {
    get each() { return pins(); },
    children: (pin) => createComponent(Pin, { pin, subject: props.subject, get title() { return props.title; } })
  }), null);
  let frame = 0;
  createEffect(() => {
    const { notches, links, bands } = props;
    void pins();   // the arcs follow the pins' layout
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      drawNotches(canvas, notches, bands ?? []);
      drawOverlay(overlay, bar, links ?? []);
    }));
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    for (const c of [canvas, overlay]) { c.width = 1; c.height = 1; }   // frees the texture (a zero-size one is an error)
  });
  return bar;
};

export { NOTCH_WIDTH, Timeline, turnText };
