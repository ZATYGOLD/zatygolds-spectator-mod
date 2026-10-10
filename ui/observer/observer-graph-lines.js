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
 * Zatygold's Spectator - line graphs (in-game scope).
 *
 * The Chronicle views of a history (observer-history.js), laid out like the
 * Victories screen's Economic tab (views { id, label, kind: 'line', read,
 * changeEvents, tabs }): a tab per recorded number, leader rows on the left
 * (click to hide a line) and a line graph of each leader's number per turn
 * (observer-line-graph.js), each Age's turns counted from 1, with a divider at
 * each Age's start (Overall) and a flag where each crisis stage began. A tab:
 *
 *   { id, slot, label, look: { color, background }, description, info, valueLabel, axisLabel, share, totalGroups }
 *
 * The value column shows each leader's latest value in the view, and on hover
 * totalGroups({ id, value, values }) (BreakdownCard's, `values` the latest sample's); a `share`
 * tab graphs each leader's % of all leaders' value per turn (as the Economic
 * tab graphs the share of world GDP).
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ScrollArea } from 'fs://game/core/ui-next/components/scroll-area.js';
import { ageName, BreakdownCard, crisisStages, emptyText, fillPanel, GraphPanel, leaderColor, LeaderRow, LeaderRows, OVERALL, rowHeight } from './observer-graph-parts.js';
import { TurnLineGraph } from './observer-line-graph.js';

const LINE_WIDTH = 6;   // the Economic tab's
const TICK_STEPS = [[40, 5], [100, 10], [Infinity, 20]];   // [up to this many turns, tick every]
const GRAPH_COLORS = { grid: 'rgb(255 255 255 / 30%)', number: '#b5b5b6', label: '#848486' };

const T = {
  body: template(`<div class="victories-scrollarea shrink mb-2 flex flex-row w-full flex-auto"><div class="victories-econ-col-3 victories-economic-graph relative"><div class="h-full absolute inset-2"></div></div></div>`)
};

const leaderIds = (samples) => [...new Set(samples.flatMap((s) => [...s.values.keys()]))];

/** A leader's latest values with one in `slot`, or null. */
function latestValues(samples, id, slot) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const values = samples[i].values.get(id);
    if (values?.[slot] != null) return values;
  }
  return null;
}

/** Leaders by their latest value, highest first: [{ id, value, values }]. */
const ranking = (samples, slot) => leaderIds(samples).map((id) => {
  const values = latestValues(samples, id, slot);
  return { id, value: values?.[slot] ?? null, values };
}).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

/**
 * The graph's x axis. x is a sample's place in the view (1..n), shown as its
 * turn counted from 1 in its Age, with ticks every few turns of each Age, a
 * divider at each Age's start (Overall) and a flag where each crisis stage
 * began.
 */
function turnAxis(samples, crises, overall) {
  const firstTurn = new Map();
  for (const s of samples) if (!firstTurn.has(s.age)) firstTurn.set(s.age, s.turn);
  const ageTurn = (s) => s.turn - firstTurn.get(s.age) + 1;
  const step = TICK_STEPS.find(([most]) => samples.length <= most)[1];
  const ticks = [];
  const dividers = [];
  const flags = [];
  samples.forEach((s, i) => {
    const x = i + 1;
    const ageStart = i === 0 || samples[i - 1].age !== s.age;
    if (ageStart || (ageTurn(s) % step === 0 && ageTurn(s) > step / 2)) ticks.push(x);
    if (ageStart && overall) dividers.push({ x, label: ageName(s.age) });
    for (const stage of crisisStages(crises, s.age)) if (stage.turn === s.turn) flags.push({ x, color: stage.color });
  });
  if (samples.length - ticks[ticks.length - 1] > step / 2) ticks.push(samples.length);
  return { ticks, dividers, flags, label: (x) => (samples[x - 1] ? `${ageTurn(samples[x - 1])}` : '') };
}

/** Graph lines (x = place in the view, 1..n), hidden leaders left out. */
const graphLines = (samples, slot, hidden) => leaderIds(samples).filter((id) => !hidden.has(id)).map((id) => ({
  color: leaderColor(id),
  points: samples.map((s, i) => ({ x: i + 1, y: s.values.get(id)?.[slot] })).filter((p) => p.y != null)
}));

/** The samples with each leader's value in `slot` as a % of the sample's total. */
const shareSamples = (samples, slot) => samples.map((s) => {
  const total = [...s.values.values()].reduce((sum, v) => sum + (v[slot] ?? 0), 0);
  const share = (value) => (value == null ? value : total > 0 ? Math.round((value / total) * 1000) / 10 : 0);
  return { ...s, values: new Map([...s.values].map(([id, v]) => [id, Object.assign([...v], { [slot]: share(v[slot]) })])) };
});

/** Each leader's latest value in a tab and, for a `share` tab, its % of all leaders': [{ id, value, values, share }], highest first. */
function lineTotals(tab, samples) {
  const shares = tab.share ? new Map(ranking(shareSamples(samples, tab.slot), tab.slot).map((r) => [r.id, r.value])) : null;
  return ranking(samples, tab.slot).map((r) => ({ ...r, share: shares?.get(r.id) ?? null }));
}

const yieldValues = (samples, slot) => samples.flatMap((s) => [...s.values.values()].map((v) => v[slot] ?? 0));

/** A round axis bound beyond the value (1, 2 or 5 times a power of ten), 0 when there is none. */
function roundBound(value) {
  if (value === 0) return 0;
  const size = Math.abs(value);
  const step = 10 ** Math.floor(Math.log10(size));
  return Math.sign(value) * ([1, 2, 5, 10].map((m) => m * step).find((bound) => bound >= size * 1.05) ?? 10 * step);
}

/** Leader rows on the left (click to hide a line), the line graph on the right. */
const LineBody = (props) => {
  const body = T.body();
  const graph = body.firstChild.firstChild;
  body.firstChild.style.marginBottom = '0';   // the Economic tab keeps room below for its legend
  const height = rowHeight(fillPanel(body));
  const axis = createMemo(() => turnAxis(props.samples(), props.crises(), props.age() === OVERALL));
  const plotted = createMemo(() => (props.tab.share ? shareSamples(props.samples(), props.slot) : props.samples()));
  const values = createMemo(() => yieldValues(plotted(), props.slot));
  const maxY = () => roundBound(Math.max(0, ...values())) || 10;
  insert(body, createComponent(ScrollArea, {
    'class': 'victories-scroll-base w-full victories-econ-cols-1-and-2-and-4',
    useProxy: true,
    get children() {
      return createComponent(LeaderRows, {
        rows: props.rows,
        row: (id, entry, index) => createComponent(LeaderRow, {
          id,
          rank: () => index() + 1,
          value: () => entry()?.value,
          valueTooltip: props.tab.totalGroups && (() => createComponent(BreakdownCard, { groups: props.tab.totalGroups(entry()) })),
          hideText: 'LOC_ZOM_GRAPH_HIDE_LINE',
          showText: 'LOC_ZOM_GRAPH_SHOW_LINE',
          hidden: () => props.hidden().has(id),
          onToggle: props.toggle,
          height
        })
      });
    }
  }), body.firstChild);
  insert(graph, createComponent(Show, {
    get when() { return props.samples().length > 0; },
    get fallback() { return emptyText(Locale.compose('LOC_ZOM_GRAPH_NO_DATA')); },
    get children() {
      return createComponent(TurnLineGraph, {
        'class': 'opacity-100',
        width: LINE_WIDTH,
        get lines() { return graphLines(plotted(), props.slot, props.hidden()); },
        get maxX() { return Math.max(props.samples().length, 2); },
        get maxY() { return props.tab.share ? Math.min(100, maxY()) : maxY(); },
        get minY() { return roundBound(Math.min(0, ...values())); },
        get ticks() { return axis().ticks; },
        get tickLabel() { return axis().label; },
        get dividers() { return axis().dividers; },
        get flags() { return axis().flags; },
        gridColor: GRAPH_COLORS.grid,
        axisLabelX: Locale.compose('LOC_GENERIC_TURN'),
        axisLabelY: props.tab.axisLabel,
        axisNumberColor: GRAPH_COLORS.number,
        axisLabelColor: GRAPH_COLORS.label
      });
    }
  }));
  return body;
};

/** One tab of a line view: { tab, samples (the view's, in the chosen Age), ...filters }. */
const LinePanel = (props) => {
  const { tab } = props;
  const rows = createMemo(() => ranking(props.samples(), tab.slot));
  return createComponent(GraphPanel, {
    ...props,
    look: tab.look,
    title: Locale.compose(tab.label),
    description: tab.description,
    info: tab.info,
    valueLabel: tab.valueLabel,
    body: () => createComponent(LineBody, { ...props, slot: tab.slot, rows })
  });
};

export { LinePanel, lineTotals };
