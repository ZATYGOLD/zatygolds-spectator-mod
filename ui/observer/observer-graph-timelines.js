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
 * Zatygold's Spectator - timeline graphs (in-game scope).
 *
 * The Chronicle views of logged things (Empire, Units), laid out like
 * the Victories screen's Culture tab: a tab per kind logged, each leader's
 * total, a notched timeline of Age progress (observer-timeline.js) with a pin
 * where things were logged, and a card after it (where the Culture tab counts
 * Great Works). A view reads what it logs (read(), changeEvents) for its tabs
 * ([{ id, label, description, lowFirst, subject }]); a tab's subject (its
 * own, else the view) describes what is logged there:
 *
 *   { looks: { [tab]: { color, background } }, categories: [{ color, glow, label }],
 *     featured (a category a pin shows first),
 *     pinIcon(source), pinColor(source) (optional), icon(source), name(source), detail(source), sourceOf(event) (extra source fields),
 *     card(id, { viewEvents, events, totals, current, lastAge }) -> { cells: [{ icon, count }], rows },
 *     cardHover (false: the card has no hover),
 *     value(id, { lastAge }) (the Total, else the things logged; optional), tieBreak(entry),
 *     links(events) ([[from, to]] events joined by a line, optional),
 *     totalRows(entry) (the Total's hover, optional) }
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createRenderEffect } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { Activatable } from 'fs://game/core/ui-next/components/activatable.js';
import { CardFrame } from 'fs://game/core/ui-next/components/card-frame.js';
import { ScrollArea } from 'fs://game/core/ui-next/components/scroll-area.js';
import { currentAgeChronology } from '../shared/zom-util.js';
import { ageProgress } from './observer-event-log.js';
import { ageName, BreakdownCard, crisisStages, fillPanel, GraphPanel, HoverTooltip, LeaderRow, LeaderRows, rowHeight, viewAges } from './observer-graph-parts.js';
import { NOTCH_WIDTH, Timeline } from './observer-timeline.js';

const MAX_PINS = 24;   // per bar: nearby things share a pin
/**
 * Card cells by how many it shows: one large, two side by side, three as a
 * list (icon then count, a row each), then two per line (smaller).
 */
const CARD_LOOK = [
  { width: '100%', icon: 'size-14', gap: '-mb-1', text: 'text-xl' },
  { width: '50%', icon: 'size-9', gap: 'mb-1', text: 'text-lg' },
  { width: '3.5rem', icon: 'size-6', gap: 'mr-3', text: 'text-lg', list: true },
  { width: '50%', icon: 'size-7', gap: 'mb-1', text: 'text-sm' }
];

const T = {
  body: template(`<div class="victories-scrollarea shrink mb-2 flex flex-col w-full flex-auto relative"></div>`),
  timeline: template(`<div class="relative flex-auto min-w-0"></div>`),
  cardContent: template(`<div class="flex flex-row flex-wrap items-center justify-center w-full"></div>`),
  cardCell: template(`<div class="flex flex-col items-center"><div class="bg-center bg-contain bg-no-repeat"></div><div class="text-title leading-none"></div></div>`)
};

/**
 * The bar's scale: each Age an equal segment of Age progress (0-99), with
 * about a notch per percent of the bar, evenly spaced inside the segment so
 * the divider between Ages sits in the middle of the gap. The current
 * progress is brighter (its percentage over the first bar) and each crisis
 * stage in its colour; in Overall a divider where each Age starts and its
 * name under the last bar.
 */
function timelineScale(spanned, crises) {
  const overall = spanned.length > 1;
  const width = 100 / spanned.length;
  const count = Math.floor(width);
  const start = (age) => spanned.indexOf(age) * width;
  const position = (age, progress) => start(age) + (progress / 100) * width;
  const notchOf = (progress) => Math.min(count - 1, Math.floor((progress / 100) * count));
  const notchLeft = (age, i) => start(age) + ((i + 0.5) * width) / count - NOTCH_WIDTH / 2;
  const age = currentAgeChronology();
  const current = spanned.includes(age) ? ageProgress() : null;
  const notches = spanned.flatMap((a, segment) => {
    const stages = crisisStages(crises, a);
    return [
      ...(segment > 0 ? [{ position: start(a), divider: true }] : []),
      ...Array.from({ length: count }, (_, i) => ({
        position: notchLeft(a, i),
        highlight: a === age && current != null && i === notchOf(current),
        color: stages.find((s) => notchOf(s.progress) === i)?.color
      }))
    ];
  });
  const labels = overall ? spanned.map((a) => ({ position: start(a), text: ageName(a), start: true, bottom: true })) : [];
  if (current != null) labels.push({ position: notchLeft(age, notchOf(current)), text: `${current}%` });
  return { position, notches, labels, current: current != null, lastAge: spanned[spanned.length - 1] };
}

const sumBy = (events, keyOf) => {
  const sums = new Map();
  for (const e of events) sums.set(keyOf(e), (sums.get(keyOf(e)) ?? 0) + e.count);
  return sums;
};

/**
 * One leader's pins: the bar split into MAX_PINS slices, one pin per slice
 * with logged things, shown as its most frequent category (the view's
 * featured category whenever the pin holds one, listed first).
 */
const sliceOf = (at) => Math.min(MAX_PINS - 1, Math.floor((at / 100) * MAX_PINS));

function leaderPins(events, position, view) {
  const slices = new Map();
  for (const event of events) {
    const at = position(event.age, event.progress);
    const index = sliceOf(at);
    const slice = slices.get(index) ?? { weighted: 0, count: 0, turns: [event.turn, event.turn], sources: new Map() };
    slice.weighted += at * event.count;
    slice.count += event.count;
    slice.turns = [Math.min(slice.turns[0], event.turn), Math.max(slice.turns[1], event.turn)];
    const extra = view.sourceOf?.(event) ?? {};
    const key = [event.category, event.type, ...Object.values(extra)].join(':');
    const source = slice.sources.get(key) ?? { type: event.type, category: event.category, ...extra, count: 0 };
    source.count += event.count;
    slice.sources.set(key, source);
    slices.set(index, slice);
  }
  const featured = view.featured;
  return [...slices].map(([index, slice]) => {
    const sources = [...slice.sources.values()].sort((a, b) => (b.category === featured) - (a.category === featured) || b.count - a.count);
    const byCategory = sumBy(sources, (s) => s.category);
    const category = byCategory.has(featured) ? featured : [...byCategory].sort((a, b) => b[1] - a[1])[0][0];
    return {
      position: slice.weighted / slice.count,
      count: slice.count,
      turns: slice.turns,
      sources,
      lead: sources.find((s) => s.category === category),
      category,
      slice: index
    };
  }).sort((a, b) => a.position - b.position);
}

/** The subject's linked things as [from, to] pin positions, between different pins. */
function pinLinks(pins, events, position, view) {
  const pinAt = (event) => pins.find((pin) => pin.slice === sliceOf(position(event.age, event.progress)));
  return (view.links?.(events) ?? []).map(([from, to]) => [pinAt(from), pinAt(to)])
    .filter(([from, to]) => from && to && from !== to).map(([from, to]) => [from.position, to.position]);
}

/** Highest Total first (lowest for a tab ranked low-first), ties broken by the view's tie-break the same way. */
const rank = (view, lowFirst) => {
  const dir = lowFirst ? -1 : 1;
  return (a, b) => dir * (b.value - a.value) || dir * (view.tieBreak(b) - view.tieBreak(a));
};

/** Leaders by their Total in the tab: [{ id, value, totals, pins, links, card }]. */
function timelineRows(view, tab, viewEvents, events, leaders, { position, current, lastAge }) {
  return leaders.map((id) => {
    const own = events.filter((e) => e.playerId === id);
    const byCategory = sumBy(own, (e) => e.category);
    const totals = view.categories.map((c, i) => byCategory.get(i) ?? 0);
    const value = view.value ? view.value(id, { lastAge }) : totals.reduce((a, b) => a + b, 0);
    const pins = leaderPins(own, position, view);
    const entry = { id, totals, value, pins, links: pinLinks(pins, own, position, view) };
    entry.card = view.card(id, { viewEvents: viewEvents.filter((e) => e.playerId === id), events: own, totals, current, lastAge });
    return entry;
  }).sort(rank(view, tab.lowFirst));
}

/**
 * The card after each bar: an icon and count per cell, laid out by CARD_LOOK
 * at a fixed card size, its rows on hover when it has them.
 */
const SummaryCard = (props) => {
  const content = T.cardContent();
  createRenderEffect(() => {
    const cells = props.entry()?.card.cells ?? [];
    const look = CARD_LOOK[Math.min(Math.max(cells.length, 1), CARD_LOOK.length) - 1];
    while (content.firstChild) content.firstChild.remove();
    content.style.flexDirection = look.list ? 'column' : '';
    for (const { icon, count } of cells) {
      const cell = T.cardCell();
      const image = cell.firstChild;
      cell.style.width = look.width;
      if (look.list) {
        cell.style.flexDirection = 'row';
        cell.style.margin = '0.125rem 0';
      }
      image.classList.add(look.icon, look.gap);
      image.style.backgroundImage = icon;
      image.nextSibling.classList.add(look.text);
      image.nextSibling.textContent = `${count}`;
      content.appendChild(cell);
    }
  });
  const card = createComponent(Activatable, {
    'class': 'victories-focusable-ticket w-24 flex-none mr-2 mt-4',
    get children() { return createComponent(CardFrame, { 'class': 'size-24 flex flex-col items-center justify-center self-center opacity-100', children: content }); }
  });
  if (!props.hover) return card;
  return createComponent(HoverTooltip, {
    trigger: card,
    content: () => createComponent(BreakdownCard, { groups: [props.entry()?.card.rows ?? []] })
  });
};

/** One leader's row: the total (its breakdown on hover, if the view has one), the timeline and the card. */
function timelineRow(id, entry, index, { view, scale, title, height, count }) {
  const timeline = T.timeline();
  insert(timeline, createComponent(Timeline, {
    subject: view,
    title,
    get pins() { return entry()?.pins ?? []; },
    get links() { return entry()?.links ?? []; },
    get notches() { return scale().notches; },
    get labels() { return scale().labels; },
    get showTopLabels() { return index() === 0; },
    get showBottomLabels() { return index() === count() - 1; }
  }));
  return createComponent(LeaderRow, {
    id,
    rank: () => index() + 1,
    value: () => entry()?.value,
    valueTooltip: view.totalRows && (() => createComponent(BreakdownCard, { groups: [view.totalRows(entry())] })),
    height,
    extra: [timeline, createComponent(SummaryCard, { entry, hover: view.cardHover !== false })]
  });
}

/** One tab of a timeline view: { subject (the tab's), tab, events (the view's, in the chosen Age), leaders, ...filters }. */
const TimelinePanel = (props) => {
  const { subject: view, tab } = props;
  const events = createMemo(() => props.events().filter((e) => e.kind === tab.id));
  const scale = createMemo(() => { props.turn(); return timelineScale(viewAges(props.age()), props.crises()); });
  const rows = createMemo(() => timelineRows(view, tab, props.events(), events(), props.leaders(), scale()));
  const title = Locale.compose(tab.label);
  return createComponent(GraphPanel, {
    ...props,
    look: view.looks[tab.id],
    title,
    description: Locale.compose(tab.description),
    valueLabel: Locale.compose('LOC_ZOM_GRAPH_TOTAL_COLUMN'),
    body: () => {
      const body = T.body();
      const height = rowHeight(fillPanel(body));
      insert(body, createComponent(ScrollArea, {
        'class': 'victories-scroll-base w-full flex-auto',
        useProxy: true,
        get children() {
          return createComponent(LeaderRows, { rows, row: (id, entry, index) => timelineRow(id, entry, index, { view, scale, title, height, count: () => rows().length }) });
        }
      }));
      return body;
    }
  });
};

export { sumBy, TimelinePanel };
