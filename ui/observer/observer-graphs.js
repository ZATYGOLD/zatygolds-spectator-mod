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
 * Zatygold's Spectator - Observer graphs (in-game scope).
 *
 * Built from the Victories screen's own parts and stylesheet, laid out like
 * its Economic tab: the same ornate screen frame and tab bar, Rank / Leader /
 * value rows with each leader's banner, portrait and colour, and two filters:
 * the view and the Age (Overall or one Age).
 *  - Yields: a tab per recorded yield (observer-history.js), a line graph
 *    of each leader's yield per turn (observer-line-graph.js), each Age's
 *    turns counted from 1.
 *  - Units: Units Trained, Units Lost and Units Defeated tabs
 *    (observer-unit-log.js), a timeline of Age progress per leader like the
 *    Culture tab's, with a pin where units were logged (tinted by land
 *    combat, naval combat, civilian or commander), the categories on the
 *    Total's hover and a Commanders card with each commander type.
 * Both mark each crisis stage (observer-crisis.js) and, in Overall, where
 * each Age starts; rows and graph are fitted to the panel's height.
 * The screen opens from a button in the HUD's sub-system dock.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createRenderEffect, createSignal, For, onCleanup, onMount, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { Activatable } from 'fs://game/core/ui-next/components/activatable.js';
import { CardFrame } from 'fs://game/core/ui-next/components/card-frame.js';
import { Divider } from 'fs://game/core/ui-next/components/divider.js';
import { Dropdown, DropdownItem } from 'fs://game/core/ui-next/components/dropdown.js';
import { defineLegacyComponent } from 'fs://game/core/ui-next/components/fxs-solid-component.js';
import { L10n } from 'fs://game/core/ui-next/components/l10n.js';
import { ScrollArea } from 'fs://game/core/ui-next/components/scroll-area.js';
import { Tab } from 'fs://game/core/ui-next/components/tab.js';
import { Tooltip, TooltipHorizontalPosition, TooltipVerticalPosition } from 'fs://game/core/ui-next/components/tooltip.js';
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';
import { isMobile } from 'fs://game/core/ui-next/services/view-experience.js';
import { LeaderWithRibbon } from 'fs://game/base-standard/ui-next/components/leader-with-ribbon.js';
import { ScreenFrame } from 'fs://game/base-standard/ui-next/components/screen-frame.js';
import victoriesStyle from 'fs://game/base-standard/ui-next/screens/victories/victories-screen.scss.js';
import { createLogger, currentAgeChronology, findAncestor, isObserverPlayer, leaderTypeOf } from '../shared/zom-util.js';
import { isObserverSeat, onScreenDock, SCREEN_PROPS, watchedPlayers } from './observer-core.js';
import { ageCrises, CRISIS_EVENT, CRISIS_STAGES } from './observer-crisis.js';
import { HISTORY_EVENT, HISTORY_YIELDS, yieldHistory } from './observer-history.js';
import { TurnLineGraph } from './observer-line-graph.js';
import { ageProgress, UNIT_CATEGORIES, UNIT_LOG_EVENT, UNIT_LOGS, unitLog } from './observer-unit-log.js';
import { NOTCH_WIDTH, UnitTimeline } from './observer-unit-timeline.js';

const log = createLogger('observer-graphs');
const GRAPHS_TAG = 'zom-observer-graphs';
const DOCK_BUTTON_CLASS = 'zom-graphs-dock-button';
// Age dropdown values are non-empty strings: the dropdown treats a falsy value (Antiquity's 0) as nothing selected.
const OVERALL = 'overall';
const ageOption = (chronology) => `age-${chronology}`;
const optionChronology = (option) => Number(option.slice(4));
const LINE_WIDTH = 6;   // the Economic tab's
const FILTER_WIDTH = 'min-w-60';         // the header dropdowns (the game's default is min-w-76)
const ROW_SLOTS = 8;                   // the panel is shared by this many leader rows (fewer leave space below)
const ROW_MIN_REM = 7;                 // below this the list scrolls
const PANEL_GAP_REM = 1.5;             // left below the rows and graph
const TICK_STEPS = [[40, 5], [100, 10], [Infinity, 20]];   // [up to this many turns, tick every]
const VIEWS = [
  { id: 'yields', label: 'LOC_ZOM_GRAPH_YIELDS' },
  { id: 'units', label: 'LOC_ZOM_GRAPH_UNITS' }
];
const GRAPH_COLORS = { grid: 'rgb(255 255 255 / 30%)', number: '#b5b5b6', label: '#848486' };
const DEFAULT_BANNER = 'bn_deluxe';
/** Title colour and panel background (the Victories screen's art) per yield. */
const YIELD_LOOK = {
  science: { color: '#6fa6d6', background: 'bg_victory_scientific2' },
  culture: { color: '#b48ee0', background: 'bg_victory_culture' },
  gold: { color: '#ffd553', background: 'bg_victory_economic3' },
  influence: { color: '#8fd1b0', background: 'bg_victory_economic' },
  food: { color: '#9bd06a', background: 'bg_victory_culture' },
  production: { color: '#d99a5b', background: 'bg_victory_military' }
};
const UNIT_LOOK = {
  defeated: { color: '#e0705a', background: 'bg_victory_military' },
  lost: { color: '#a3a3ad', background: 'bg_victory_military' },
  trained: { color: '#d99a5b', background: 'bg_victory_military' }
};
const MAX_PINS = 24;   // per bar: nearby units share a pin
const COMMANDER = UNIT_CATEGORIES.findIndex((c) => c.id === 'commander');

// Markup and classes of the Victories screen (victories-screen.js, victories-alt-base.js, victory-tab-base.js).
const T = {
  container: template(`<div class="mt-8 flex flex-col flex-auto bg-accent-6 items-center mb-5 pl-8 pr-8 pt-8 relative victories-panel-container"><div class="absolute inset-0 bottom-0 filigree-inner-frame-top"></div><div class="absolute inset-0 bottom-0 filigree-inner-frame-bottom"></div></div>`),
  panel: template(`<div class="relative w-full h-full"><div class="absolute inset-0 bg-cover bg-no-repeat opacity-30 pointer-events-none"></div><div class="relative h-full flex flex-col items-center w-full"></div></div>`),
  description: template(`<div class="absolute -top-14 victories-header"><div class="font-body text-body text-xs self-center text-center"></div></div>`),
  title: template(`<div class="flex flex-row absolute -mt-6 ml-2 w-full victories-point-goal-line"><div class="victories-military-cols-1-and-2 font-title uppercase font-bold text-lg"><div role="heading"></div></div></div>`),
  spacer: template(`<div class="w-full h-4"></div>`),
  header: template(`<div class="flex flex-row victories-military-bottom-line h-14 w-full"><div class="victories-military-col-1 font-title text-sm fxs-header uppercase self-center text-center"></div><div class="victories-military-col-2 font-title text-sm fxs-header uppercase self-center pl-4"></div><div class="victories-military-col-4 flex flex-row victories-military-left-line-header"><div class="w-full font-title text-sm fxs-header uppercase flex flex-row"><div class="self-center w-full text-center font-fit-shrink"></div></div></div><div class="victories-military-col-3 font-title text-sm"><div class="w-full h-full relative flex flex-row justify-end victories-military-left-line-header"><div class="relative ml-2 mt-2 mr-2 uppercase fxs-header self-center flex flex-row items-center"></div></div></div></div>`),
  body: template(`<div class="victories-scrollarea shrink mb-2 flex flex-row w-full flex-auto"><div class="victories-econ-col-3 victories-economic-graph relative"><div class="h-full absolute inset-2"></div></div></div>`),
  row: template(`<div class="flex flex-row pointer-events-auto min-h-28 duration-150 ease-out"><div class="flex flex-row victories-econ-col-4"><div class="h-full w-2"></div><div class="self-center flex-1"><div class="font-title bold text-xl text-center text-white"></div></div></div></div>`),
  rowLeader: template(`<div class="absolute inset-0 flex flex-row"><div class="flex flex-row victories-econ-col-1 justify-center"><div class="self-center"></div></div><div class="relative victories-econ-col-2 victories-military-left-line"><div class="flex flex-row"><div class="mx-2"></div><div class="victories-military-player-vslot mt-7 flex-1"><div class="text-white"></div></div></div></div></div>`),
  rowBanner: template(`<div class="absolute inset-0 bg-cover bg-no-repeat duration-150 ease-out opacity-30"></div>`),
  selected: template(`<div class="pl-3"></div>`),
  empty: template(`<div class="absolute inset-0 flex items-center justify-center font-body text-sm text-accent-3"></div>`),
  unitBody: template(`<div class="victories-scrollarea shrink mb-2 flex flex-col w-full flex-auto relative"></div>`),
  timeline: template(`<div class="relative flex-auto min-w-0"></div>`),
  cardContent: template(`<div class="flex flex-row flex-wrap items-center justify-center w-full"></div>`),
  cardCell: template(`<div class="flex flex-col items-center"><div class="bg-center bg-contain bg-no-repeat -mb-1"></div><div class="text-title leading-none"></div></div>`),
  ticketRow: template(`<div class="flex flex-row items-center w-full p-1 my-1 relative"><div class="ml-2 bg-contain bg-center bg-no-repeat"></div><div class="flex flex-col justify-center h-11 ml-3"><div class="uppercase text-title"></div></div><div class="absolute right-2"></div></div>`)
};

// ============================ Data ============================

const ages = () => [...GameInfo.Ages].sort((a, b) => a.ChronologyIndex - b.ChronologyIndex);

const viewLabel = (id) => Locale.compose(VIEWS.find((v) => v.id === id)?.label ?? '');

function ageLabel(option) {
  if (option === OVERALL) return Locale.compose('LOC_ZOM_GRAPH_OVERALL');
  const age = ages().find((a) => a.ChronologyIndex === optionChronology(option));
  return age ? Locale.compose('LOC_VICTORY_AGE_NAME', age.Name) : '';
}

function leaderColor(playerId) {
  try { return UI.Player.getPrimaryColorValueAsString(playerId); } catch (e) { return '#ffffff'; }
}

let banners = null;
/** The leader's banner art from the legend paths, as the Victories screen shows it. */
function leaderBanner(playerId) {
  if (!banners) {
    banners = new Map();
    try {
      for (const item of Online.Metaprogression.getLegendPathsData()) {
        if (!item.legendPathLoc?.includes('LOC_LEADER')) continue;
        const banner = item.rewards?.find((r) => r.gameItemID?.slice(0, 7) === 'BANNER_');
        if (banner) banners.set(item.legendPathLoc.substring(4, item.legendPathLoc.length - 5), banner.reward);
      }
    } catch (e) { log(`banners unavailable: ${e}`); }
  }
  return banners.get(leaderTypeOf(Players.get(playerId)?.leaderType, null)) ?? DEFAULT_BANNER;
}

const formatValue = (value) => (value == null ? '-' : Locale.toNumber(Math.round(value * 10) / 10));
const leaderIds = (samples) => [...new Set(samples.flatMap((s) => [...s.values.keys()]))];

function latestValue(samples, id, slot) {
  for (let i = samples.length - 1; i >= 0; i--) {
    const value = samples[i].values.get(id)?.[slot];
    if (value != null) return value;
  }
  return null;
}

/** Leaders by their latest value, highest first: [{ id, value }]. */
const ranking = (samples, slot) => leaderIds(samples).map((id) => ({ id, value: latestValue(samples, id, slot) }))
  .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));

const ageName = (chronology) => Locale.compose(ages().find((a) => a.ChronologyIndex === chronology)?.Name ?? '');

/** Each crisis stage of the Age: its colour and its Age progress as "70%". */
const crisisStages = (crises, age) => (crises.get(age) ?? []).map((s) => ({ ...s, color: CRISIS_STAGES[s.stage].color }));

/**
 * The yield graph's x axis. x is a sample's place in the view (1..n), shown as
 * its turn counted from 1 in its Age, with ticks every few turns of each Age,
 * a divider at each Age's start (Overall) and a flag where each crisis stage
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
  order: 1,
  points: samples.map((s, i) => ({ x: i + 1, y: s.values.get(id)?.[slot] })).filter((p) => p.y != null)
}));

const yieldValues = (samples, slot) => samples.flatMap((s) => [...s.values.values()].map((v) => v[slot] ?? 0));
const yieldMax = (samples, slot) => Math.max(0, ...yieldValues(samples, slot));
const yieldMin = (samples, slot) => Math.min(0, ...yieldValues(samples, slot));

/** A round axis top above the highest value (1, 2 or 5 times a power of ten). */
function roundTop(max) {
  if (max <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((m) => m * step).find((top) => top >= max * 1.05) ?? 10 * step;
}

// ============================ Tooltips ============================

/** A tooltip above `trigger`, built from `content()` when shown. */
const HoverTooltip = (props) => createComponent(Tooltip, {
  initialVPosition: TooltipVerticalPosition.TOP,
  initialHPosition: TooltipHorizontalPosition.CENTER,
  get children() {
    return [
      createComponent(Tooltip.Trigger, { children: props.trigger }),
      createComponent(Tooltip.Content, { get children() { return props.content(); } })
    ];
  }
});

/** A row of a breakdown card: a colour dot or an icon, the label and the count. */
function breakdownRow({ color, icon, label, value }) {
  const row = T.ticketRow();
  const swatch = row.firstChild;
  if (icon) {
    swatch.classList.add('size-9');
    swatch.style.backgroundImage = icon;
  } else {
    swatch.classList.add('size-3', 'rounded-full');
    swatch.style.backgroundColor = color;
  }
  swatch.nextSibling.firstChild.textContent = label;
  swatch.nextSibling.nextSibling.textContent = `${value}`;
  return row;
}

/** The Culture tab's tooltip card: groups of rows ({ color | icon, label, value }), a divider between groups. */
const BreakdownCard = (props) => createComponent(Tooltip.Frame, {
  'class': 'relative flex flex-col p-2 items-center justify-center',
  get children() {
    const children = props.groups.flatMap((rows, i) => [
      ...(i ? [createComponent(Divider.Horizontal, { 'class': 'my-1 ml-2', length: '76' })] : []),
      ...rows.map(breakdownRow)
    ]);
    return createComponent(CardFrame, { 'class': 'w-84 mb-3', children });
  }
});

// ============================ Fitting ============================

/** One rem in pixels, measured (the UI scales rem with the screen). */
function remPx() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position: absolute; width: 10rem; height: 0; visibility: hidden;';
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width / 10;
  probe.remove();
  return px || 16;
}

/**
 * Stretches `body` to the bottom of the Victories panel (otherwise it stops at
 * the scroll area's minimum height) and returns its height in pixels.
 */
function fillPanel(body) {
  const [height, setHeight] = createSignal(0);
  let frame = 0;
  const measure = () => {
    const panel = findAncestor(body, (node) => node.classList?.contains('victories-panel-container'));
    if (!panel) return;
    const available = Math.floor(panel.getBoundingClientRect().bottom - body.getBoundingClientRect().top - PANEL_GAP_REM * remPx());
    if (available <= 0) return;
    body.style.flex = '0 0 auto';
    body.style.height = `${available}px`;
    setHeight(available);
  };
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => requestAnimationFrame(measure)); };
  onMount(schedule);
  window.addEventListener('resize', schedule);
  onCleanup(() => { cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); });
  return height;
}

/** Each row's share of the height: one of ROW_SLOTS, at least ROW_MIN_REM (more rows scroll). */
const rowHeight = (height) => () => (height() ? Math.floor(Math.max(ROW_MIN_REM * remPx(), height() / ROW_SLOTS)) : 0);

// ============================ Rows ============================

/**
 * A Victories leader row: rank, banner, portrait, name and the value (rank,
 * value and an optional height are accessors). With onToggle the leader
 * activates to hide or show its line; with valueTooltip the value column shows that content on
 * hover; `extra` elements (the Units timeline and card) follow the value.
 */
const LeaderRow = (props) => {
  const row = T.row();
  const valueColumn = row.firstChild;
  const scoreBar = valueColumn.firstChild;
  const scoreText = scoreBar.nextSibling.firstChild;
  const banner = T.rowBanner();
  const leader = T.rowLeader();
  const rank = leader.firstChild.firstChild;
  const portrait = leader.firstChild.nextSibling.firstChild.firstChild;
  const name = portrait.nextSibling.firstChild;
  banner.style.backgroundImage = `url(blp:${leaderBanner(props.id)})`;
  name.textContent = Locale.compose(Players.get(props.id)?.name ?? '');
  scoreBar.style.backgroundColor = leaderColor(props.id);
  createRenderEffect(() => { rank.textContent = `${props.rank()}`; });
  createRenderEffect(() => { scoreText.textContent = formatValue(props.value()); });
  createRenderEffect(() => { const height = props.height?.(); if (height) row.style.height = `${height}px`; });
  insert(portrait, createComponent(LeaderWithRibbon, { leaderId: props.id, size: 28, omitFullRibbon: true, omitRelationshipIcon: true }));
  // Leader columns before the value column, as in the Victories rows.
  insert(row, createComponent(Activatable, {
    'class': 'victories-econ-cols-1-and-2 relative flex flex-row',
    onActivate: () => props.onToggle?.(props.id),
    onMouseEnter: () => banner.classList.replace('opacity-30', 'opacity-60'),
    get children() { return [banner, leader]; }
  }), valueColumn);
  if (props.onToggle) {
    createRenderEffect(() => {
      const hidden = props.hidden();
      row.style.opacity = hidden ? '0.4' : '1';
      row.setAttribute('data-tooltip-content', Locale.compose(hidden ? props.showText : props.hideText));
    });
  }
  if (props.valueTooltip) {
    valueColumn.remove();
    insert(row, createComponent(HoverTooltip, { trigger: valueColumn, content: props.valueTooltip }), null);
  }
  if (props.extra) insert(row, props.extra, null);
  row.addEventListener('mouseleave', () => banner.classList.replace('opacity-60', 'opacity-30'));
  return row;
};

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Rows ([{ id, ... }]) kept per leader, so a row - and a tooltip open on it -
 * survives data updates while the screen is open: row(id, entry, index),
 * entry an accessor of the leader's current row.
 */
const LeaderRows = (props) => {
  const byId = createMemo(() => new Map(props.rows().map((r) => [r.id, r])));
  const ids = createMemo(() => props.rows().map((r) => r.id), [], { equals: sameIds });
  return createComponent(For, {
    get each() { return ids(); },
    children: (id, index) => props.row(id, () => byId().get(id), index)
  });
};

// ============================ Panels ============================

/** One of the header's filter dropdowns. */
const FilterDropdown = (props) => createComponent(Dropdown, {
  'class': props.class,
  get defaultValue() { return props.value(); },
  selectedItemTemplate: (value) => { const text = T.selected(); text.textContent = props.label(value); return text; },
  hotkey: props.hotkey,
  onItemSelected: (value) => props.onSelect(value),
  get children() {
    return createComponent(For, {
      get each() { return props.options(); },
      children: (option) => createComponent(DropdownItem, { value: option, get children() { return createComponent(L10n.Compose, { text: props.label(option) }); } })
    });
  }
});

/**
 * The Victories panel shell shared by every tab: background art, description,
 * coloured title, the Rank / Leader / value header with the view and Age
 * filters, then the tab's body.
 */
const GraphPanel = (props) => {
  const panel = T.panel();
  const background = panel.firstChild;
  const content = background.nextSibling;
  background.style.backgroundImage = `url(${props.look.background})`;

  const description = T.description();
  description.firstChild.textContent = props.description;
  const title = T.title();
  const heading = title.firstChild;
  heading.style.color = props.look.color;
  heading.firstChild.textContent = props.title;

  const header = T.header();
  const [rankHead, leaderHead, valueHead, filterHead] = Array.from(header.children);
  rankHead.textContent = Locale.compose('LOC_GENERIC_RANK');
  leaderHead.textContent = Locale.compose('LOC_GENERIC_LEADER');
  valueHead.firstChild.firstChild.textContent = props.valueLabel;
  const filters = filterHead.firstChild.firstChild;
  insert(filters, createComponent(FilterDropdown, { 'class': FILTER_WIDTH, value: props.view, options: () => VIEWS.map((v) => v.id), label: viewLabel, onSelect: props.setView }));
  insert(filters, createComponent(FilterDropdown, { 'class': `${FILTER_WIDTH} ml-3`, value: props.age, options: props.ageOptions, label: ageLabel, onSelect: props.setAge, hotkey: 'shell-action-2' }));

  content.append(description, title, T.spacer(), header, props.body());
  return panel;
};

const emptyText = (text) => { const empty = T.empty(); empty.textContent = text; return empty; };

// ============================ Yields ============================

/** Leader rows on the left (click to hide a line), the line graph on the right. */
const YieldBody = (props) => {
  const body = T.body();
  const graph = body.firstChild.firstChild;
  body.firstChild.style.marginBottom = '0';   // the Economic tab keeps room below for its legend
  const height = rowHeight(fillPanel(body));
  const axis = createMemo(() => turnAxis(props.samples(), props.crises(), props.age() === OVERALL));
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
        get lines() { return graphLines(props.samples(), props.slot, props.hidden()); },
        get maxX() { return Math.max(props.samples().length, 2); },
        get maxY() { return roundTop(yieldMax(props.samples(), props.slot)); },
        get minY() { const min = yieldMin(props.samples(), props.slot); return min < 0 ? -roundTop(-min) : 0; },
        get ticks() { return axis().ticks; },
        get tickLabel() { return axis().label; },
        get dividers() { return axis().dividers; },
        get flags() { return axis().flags; },
        gridColor: GRAPH_COLORS.grid,
        axisLabelX: Locale.compose('LOC_GENERIC_TURN'),
        axisLabelY: Locale.compose('LOC_ZOM_GRAPH_PER_TURN', props.label),
        axisNumberColor: GRAPH_COLORS.number,
        axisLabelColor: GRAPH_COLORS.label
      });
    }
  }));
  return body;
};

const YieldPanel = (props) => {
  const slot = props.yieldDef.slot;
  const label = Locale.compose(props.yieldDef.label);
  const rows = createMemo(() => ranking(props.samples(), slot));
  return createComponent(GraphPanel, {
    ...props,
    look: YIELD_LOOK[props.yieldDef.id] ?? YIELD_LOOK.gold,
    title: label,
    description: Locale.compose('LOC_ZOM_GRAPH_DESCRIPTION', label),
    valueLabel: Locale.compose('LOC_ZOM_GRAPH_PER_TURN_COLUMN'),
    body: () => createComponent(YieldBody, { ...props, slot, label, rows })
  });
};

// ============================ Units ============================

/** The Ages a Units view spans: the chosen Age, or every Age so far. */
const viewAges = (option) => (option === OVERALL
  ? ages().map((a) => a.ChronologyIndex).filter((c) => c <= currentAgeChronology())
  : [optionChronology(option)]);

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
  return { position, notches, labels, current: current != null };
}

/** One leader's pins: the bar split into MAX_PINS slices, one pin per slice with logged units (shown as its commander when it has one). */
function leaderPins(events, position) {
  const slices = new Map();
  for (const event of events) {
    const at = position(event.age, event.progress);
    const index = Math.min(MAX_PINS - 1, Math.floor((at / 100) * MAX_PINS));
    const slice = slices.get(index) ?? { weighted: 0, count: 0, turns: [event.turn, event.turn], sources: new Map() };
    slice.weighted += at * event.count;
    slice.count += event.count;
    slice.turns = [Math.min(slice.turns[0], event.turn), Math.max(slice.turns[1], event.turn)];
    const key = `${event.unitType}:${event.other}:${event.how}`;
    const source = slice.sources.get(key) ?? { unitType: event.unitType, category: event.category, other: event.other, how: event.how, count: 0 };
    source.count += event.count;
    slice.sources.set(key, source);
    slices.set(index, slice);
  }
  return [...slices.values()].map((slice) => {
    const sources = [...slice.sources.values()].sort((a, b) => b.count - a.count);
    const byCategory = UNIT_CATEGORIES.map((c, i) => sources.filter((s) => s.category === i).reduce((n, s) => n + s.count, 0));
    const category = byCategory[COMMANDER] ? COMMANDER : byCategory.indexOf(Math.max(...byCategory));
    return {
      position: slice.weighted / slice.count,
      count: slice.count,
      turns: slice.turns,
      sources: [...sources.filter((s) => s.category === COMMANDER), ...sources.filter((s) => s.category !== COMMANDER)],
      unitType: sources.find((s) => s.category === category).unitType,
      category
    };
  }).sort((a, b) => a.position - b.position);
}

const sumBy = (events, keyOf) => {
  const sums = new Map();
  for (const e of events) sums.set(keyOf(e), (sums.get(keyOf(e)) ?? 0) + e.count);
  return sums;
};

let commanderOrder = null;
/** Every commander type, in database order. */
const commanderTypes = () => (commanderOrder ??= [...GameInfo.Units].filter((u) => u.FormationClass === 'FORMATION_CLASS_COMMAND').map((u) => u.UnitType));

/** Commander types the leader owns or can train now (the production list's query). */
function currentCommanders(playerId) {
  const types = new Set();
  const player = Players.get(playerId);
  const add = (type) => { const def = GameInfo.Units.lookup(type); if (def?.FormationClass === 'FORMATION_CLASS_COMMAND') types.add(def.UnitType); };
  try {
    for (const unit of player?.Units?.getUnits?.() ?? []) add(unit.type);
    for (const city of player?.Cities?.getCities?.() ?? []) {
      for (const { index, result } of Game.CityOperations.canStartQuery(city.id, CityOperationTypes.BUILD, CityQueryType.Unit) ?? []) {
        if (result.Requirements?.FullFailure || result.Requirements?.Obsolete) continue;
        if (result.Success || result.Requirements?.MeetsRequirements) add(index);
      }
    }
  } catch (e) { log(`commanders of ${playerId} unavailable: ${e}`); }
  return types;
}

/**
 * The leader's commander types for the card: those logged in the view (any
 * tab) and, when the view includes the current Age, those owned or trainable.
 */
function leaderCommanders(playerId, viewEvents, events, current) {
  const types = current ? currentCommanders(playerId) : new Set();
  for (const e of viewEvents) if (e.playerId === playerId && e.category === COMMANDER) types.add(e.unitType);
  const counts = sumBy(events.filter((e) => e.category === COMMANDER), (e) => e.unitType);
  return commanderTypes().filter((type) => types.has(type)).map((unitType) => ({ unitType, count: counts.get(unitType) ?? 0 }));
}

/** Most units first (fewest for a tab ranked low-first), ties broken by commanders the same way. */
const unitRank = (lowFirst) => {
  const dir = lowFirst ? -1 : 1;
  return (a, b) => dir * (b.value - a.value) || dir * (b.totals[COMMANDER] - a.totals[COMMANDER]);
};

/** Leaders by units logged in the tab, ranked by unitRank: [{ id, value, totals, pins, commanders }]. */
function unitRows(viewEvents, events, leaders, position, current, lowFirst) {
  return leaders.map((id) => {
    const own = events.filter((e) => e.playerId === id);
    const byCategory = sumBy(own, (e) => e.category);
    const totals = UNIT_CATEGORIES.map((c, i) => byCategory.get(i) ?? 0);
    return {
      id,
      totals,
      value: totals.reduce((a, b) => a + b, 0),
      pins: leaderPins(own, position),
      commanders: leaderCommanders(id, viewEvents, own, current)
    };
  }).sort(unitRank(lowFirst));
}

const categoryRows = (totals) => UNIT_CATEGORIES.map((c, i) => ({ color: c.color, label: Locale.compose(c.label), value: totals[i] }));

const ARMY_COMMANDER = 'UNIT_ARMY_COMMANDER';
/** Commander card cells by how many types it shows: one large, two side by side, then two per line (smaller). */
const CARD_LOOK = [
  { half: false, icon: 'size-14', text: 'text-xl' },
  { half: true, icon: 'size-9', text: 'text-lg' },
  { half: true, icon: 'size-7', text: 'text-sm' }
];

/** Each commander type of the leader, or the category total when it has none. */
function commanderBreakdown(entry) {
  if (!entry?.commanders.length) {
    const commander = UNIT_CATEGORIES[COMMANDER];
    return [{ color: commander.color, label: Locale.compose(commander.label), value: entry?.totals[COMMANDER] ?? 0 }];
  }
  return entry.commanders.map((c) => ({
    icon: UI.getIconCSS(c.unitType),
    label: Locale.compose(GameInfo.Units.lookup(c.unitType)?.Name ?? ''),
    value: c.count
  }));
}

/** The commander types shown on the card: every unlocked or logged type, else the Army Commander. */
const cardCommanders = (entry) => (entry?.commanders.length ? entry.commanders : [{ unitType: ARMY_COMMANDER, count: entry?.totals[COMMANDER] ?? 0 }]);

/**
 * The card after each bar (where the Culture tab counts Great Works): the
 * leader's commanders, one icon and count per available or logged type (0
 * included, at most two per line at a fixed card size), each type also
 * listed on hover.
 */
const CommanderCard = (props) => {
  const content = T.cardContent();
  createRenderEffect(() => {
    const types = cardCommanders(props.entry());
    const look = CARD_LOOK[Math.min(types.length, CARD_LOOK.length) - 1];
    while (content.firstChild) content.firstChild.remove();
    for (const cell of types.map((c) => {
      const cell = T.cardCell();
      const icon = cell.firstChild;
      if (look.half) cell.style.width = '50%';
      icon.classList.add(look.icon);
      icon.style.backgroundImage = UI.getIconCSS(c.unitType, 'UNIT_FLAG');
      icon.nextSibling.classList.add(look.text);
      icon.nextSibling.textContent = `${c.count}`;
      return cell;
    })) content.appendChild(cell);
  });
  const card = createComponent(Activatable, {
    'class': 'victories-focusable-ticket w-24 flex-none mr-2 mt-4',
    get children() { return createComponent(CardFrame, { 'class': 'size-24 flex flex-col items-center justify-center self-center opacity-100', children: content }); }
  });
  return createComponent(HoverTooltip, {
    trigger: card,
    content: () => createComponent(BreakdownCard, { groups: [commanderBreakdown(props.entry())] })
  });
};

/** One leader's row: total (categories on hover), the timeline and the Commanders card. */
function unitRow(id, entry, index, { scale, title, height, count }) {
  const timeline = T.timeline();
  insert(timeline, createComponent(UnitTimeline, {
    title,
    get pins() { return entry()?.pins ?? []; },
    get notches() { return scale().notches; },
    get labels() { return scale().labels; },
    get showTopLabels() { return index() === 0; },
    get showBottomLabels() { return index() === count() - 1; }
  }));
  return createComponent(LeaderRow, {
    id,
    rank: () => index() + 1,
    value: () => entry()?.value,
    valueTooltip: () => createComponent(BreakdownCard, { groups: [categoryRows(entry()?.totals ?? UNIT_CATEGORIES.map(() => 0))] }),
    height,
    extra: [timeline, createComponent(CommanderCard, { entry })]
  });
}

const UnitPanel = (props) => {
  const events = createMemo(() => props.events().filter((e) => e.kind === props.unitLog.id));
  const scale = createMemo(() => { props.turn(); return timelineScale(viewAges(props.age()), props.crises()); });
  const rows = createMemo(() => unitRows(props.events(), events(), props.leaders(), scale().position, scale().current, props.unitLog.lowFirst));
  const title = Locale.compose(props.unitLog.label);
  return createComponent(GraphPanel, {
    ...props,
    look: UNIT_LOOK[props.unitLog.id],
    title,
    description: Locale.compose(props.unitLog.description),
    valueLabel: Locale.compose('LOC_ZOM_GRAPH_TOTAL_COLUMN'),
    body: () => {
      const body = T.unitBody();
      const height = rowHeight(fillPanel(body));
      insert(body, createComponent(ScrollArea, {
        'class': 'victories-scroll-base w-full flex-auto',
        useProxy: true,
        get children() { return createComponent(LeaderRows, { rows, row: (id, entry, index) => unitRow(id, entry, index, { scale, title, height, count: () => rows().length }) }); }
      }));
      return body;
    }
  });
};

// ============================ Screen ============================

const TOP_ICON_CLASS = 'zom-graphs-top-icon';
const TOP_ICON_ZOOM = 1.5;   // the glyph fills the frame's top medallion

function ornatePanelData() {
  return {
    topIconSrc: 'none',   // the medallion shows the graph glyph (placeTopIcon)
    topIconClass: `size-14 relative ${TOP_ICON_CLASS}`,
    backgroundImageSrc: '',
    name: 'ZOM-Graphs',
    id: GRAPHS_TAG,
    isFullscreen: isMobile()
  };
}

/** Leaders with a row in the Units view: every living major and any major already logged, Spectators excluded. */
function unitLeaders(events) {
  const ids = new Set(watchedPlayers().map((p) => p.id));
  for (const { playerId } of events) if (Players.get(playerId)?.isMajor && !isObserverPlayer(playerId)) ids.add(playerId);
  return [...ids];
}

/** The Victories tab bar and panel area for one view's tabs: [{ name, title, body }]. */
const TabGroup = (props) => createComponent(Tab, {
  'class': 'victories-tab-bar w-full flex flex-col flex-auto pointer-events-auto mx-5',
  defaultTab: props.tabs[0].name,
  get children() {
    const container = T.container();
    insert(container, createComponent(Tab.Output, {}), null);
    return [
      createComponent(Tab.TabList, { 'class': 'victories-tab-width self-center text-base font-base', nextHotkey: 'nav-next', previousHotkey: 'nav-previous' }),
      container,
      ...props.tabs.map((tab) => createComponent(Tab.Item, tab))
    ];
  }
});

const GraphsScreenComponent = () => {
  const [history, setHistory] = createSignal(yieldHistory(), { equals: false });
  const [log, setLog] = createSignal(unitLog(), { equals: false });
  const [view, setView] = createSignal(VIEWS[0].id);
  const [age, setAge] = createSignal(OVERALL);
  const [crises, setCrises] = createSignal(ageCrises(), { equals: false });
  const [turn, setTurn] = createSignal(Game.turn);   // the current progress moves each turn
  const [hidden, setHidden] = createSignal(new Set(), { equals: false });
  const listeners = [
    [HISTORY_EVENT, () => { setHistory(yieldHistory()); setTurn(Game.turn); }],
    [UNIT_LOG_EVENT, () => setLog(unitLog())],
    [CRISIS_EVENT, () => setCrises(ageCrises())]
  ];
  onMount(() => {
    for (const [name, listener] of listeners) window.addEventListener(name, listener);
    placeTopIcon();
  });
  onCleanup(() => { for (const [name, listener] of listeners) window.removeEventListener(name, listener); });

  const samples = createMemo(() => (age() === OVERALL ? history() : history().filter((s) => s.age === optionChronology(age()))));
  const events = createMemo(() => (age() === OVERALL ? log() : log().filter((e) => e.age === optionChronology(age()))));
  const leaders = createMemo(() => unitLeaders(log()));
  const ageOptions = createMemo(() => [OVERALL, ...ages().map((a) => a.ChronologyIndex).filter((c) => c <= currentAgeChronology()).map(ageOption)]);
  const toggle = (id) => {
    const set = hidden();
    if (!set.delete(id)) set.add(id);
    setHidden(set);
  };
  const filters = { view, setView, age, setAge, ageOptions, hidden, toggle, crises, turn };
  const yieldTabs = HISTORY_YIELDS.map((yieldDef) => ({
    name: yieldDef.id,
    title: () => yieldDef.label,
    body: () => createComponent(YieldPanel, { yieldDef, samples, ...filters })
  }));
  const unitTabs = UNIT_LOGS.map((unitLog) => ({
    name: unitLog.id,
    title: () => unitLog.label,
    body: () => createComponent(UnitPanel, { unitLog, events, leaders, ...filters })
  }));

  return createComponent(ScreenFrame, {
    name: 'ZOM-Graphs',
    panelContext: GRAPHS_TAG,
    audioContext: 'VictoryScreen',
    title: 'LOC_ZOM_GRAPHS_TITLE',
    ornatePanelData: ornatePanelData(),
    addYieldBar: false,
    get isFullscreen() { return isMobile(); },
    get children() {
      return [
        createComponent(Show, { get when() { return view() === 'yields'; }, get children() { return createComponent(TabGroup, { tabs: yieldTabs }); } }),
        createComponent(Show, { get when() { return view() === 'units'; }, get children() { return createComponent(TabGroup, { tabs: unitTabs }); } })
      ];
    }
  });
};

/** The graph glyph in the frame's top medallion, where the Victories screen has its trophy. */
function placeTopIcon(attempts = 10) {
  const medallion = document.querySelector(`${GRAPHS_TAG} .${TOP_ICON_CLASS}`);
  if (!medallion) {
    if (attempts > 0) requestAnimationFrame(() => placeTopIcon(attempts - 1));
    return;
  }
  if (!medallion.firstChild) medallion.appendChild(graphGlyph(TOP_ICON_ZOOM));
}

const GraphsScreen = ComponentRegistry.register({
  name: 'ZOMGraphsScreen',
  styles: [victoriesStyle],
  createInstance: GraphsScreenComponent
});

defineLegacyComponent(GRAPHS_TAG, { classNames: ['fullscreen'], attrs: {} }, () => {
  Input.setActiveContext(InputContext.Shell);
  return createComponent(GraphsScreen, {});
});

const openGraphs = () => ContextManager.push(GRAPHS_TAG, SCREEN_PROPS);

// ============================ Dock button ============================

/**
 * The button's icon in the dock icons' look - a light, engraved glyph with a
 * dark edge - drawn on a 128 x 128 canvas centred on the button, and larger
 * in the screen's top medallion (the game has no graph icon): an axis and a
 * rising line.
 */
const GRAPH_GLYPH = {
  light: ['#f1ebdc', '#b9b2a2'],   // top and bottom of the glyph's gradient
  edge: 'rgba(20, 16, 10, 0.75)',
  axis: [[42, 40], [42, 88], [90, 88]],
  line: [[50, 78], [61, 63], [71, 70], [86, 47]]
};

function graphGlyph(zoom = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const light = ctx.createLinearGradient(0, 40, 0, 90);
  light.addColorStop(0, GRAPH_GLYPH.light[0]);
  light.addColorStop(1, GRAPH_GLYPH.light[1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(64, 64);
  ctx.scale(zoom, zoom);
  ctx.translate(-66, -64);   // the glyph's centre
  const stroke = (points, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  for (const [points, width] of [[GRAPH_GLYPH.axis, 5], [GRAPH_GLYPH.line, 6]]) stroke(points, GRAPH_GLYPH.edge, width + 4);
  for (const [points, width] of [[GRAPH_GLYPH.axis, 5], [GRAPH_GLYPH.line, 6]]) stroke(points, light, width);
  return canvas;
}

/** The Graphs button after the dock's own screen buttons, built by the dock itself. */
function placeDockButton(dock) {
  const root = dock?.Root;
  if (!isObserverSeat() || !root || root.querySelector('.' + DOCK_BUTTON_CLASS)) return;
  const button = dock.createButton({
    tooltip: 'LOC_ZOM_GRAPHS_TITLE',
    modifierClass: 'zom-graphs',
    callback: openGraphs,
    class: DOCK_BUTTON_CLASS,
    audio: 'unlocks',
    focusedAudio: 'data-audio-focus-small'
  });
  button.classList.add('ssb__element');
  button.querySelector('.ssb__button-icon')?.appendChild(graphGlyph());
  const slot = root.querySelector('#panel-sub-system-dock-mod-slot');
  if (slot) slot.parentElement.insertBefore(button, slot);
  else root.appendChild(button);
}

onScreenDock({ place: placeDockButton }, log);
