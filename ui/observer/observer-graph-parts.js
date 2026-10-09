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
 * Zatygold's Spectator - graph parts (in-game scope).
 *
 * What every Graphs view (observer-graphs.js) is built from, taken from the
 * Victories screen's own markup and classes (victories-screen.js,
 * victories-alt-base.js, victory-tab-base.js): the panel shell with its
 * header and filters, Rank / Leader / value rows with each leader's banner,
 * portrait and colour, tooltips and breakdown cards, fitting the rows and
 * graphs to the panel's height, and the Age and crisis data they share.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createRenderEffect, createSignal, For, onCleanup, onMount } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { Activatable } from 'fs://game/core/ui-next/components/activatable.js';
import { CardFrame } from 'fs://game/core/ui-next/components/card-frame.js';
import { Dropdown, DropdownItem } from 'fs://game/core/ui-next/components/dropdown.js';
import { L10n } from 'fs://game/core/ui-next/components/l10n.js';
import { Tooltip, TooltipHorizontalPosition, TooltipVerticalPosition } from 'fs://game/core/ui-next/components/tooltip.js';
import { LeaderWithRibbon } from 'fs://game/base-standard/ui-next/components/leader-with-ribbon.js';
import { createLogger, currentAgeChronology, findAncestor, isObserverPlayer, leaderTypeOf } from '../shared/zom-util.js';
import { watchedPlayers } from './observer-core.js';
import { CRISIS_STAGES } from './observer-crisis.js';
import { cityStateType } from './observer-settlement-info.js';

const log = createLogger('observer-graphs');
// Age dropdown values are non-empty strings: the dropdown treats a falsy value (Antiquity's 0) as nothing selected.
const OVERALL = 'overall';
const ageOption = (chronology) => `age-${chronology}`;
const optionChronology = (option) => Number(option.slice(4));
const FILTER_WIDTH = 'min-w-60';   // the header dropdowns (the game's default is min-w-76)
const ROW_SLOTS = 8;               // the panel is shared by this many leader rows (fewer leave space below)
const ROW_MIN_REM = 7;             // below this the list scrolls
const PANEL_GAP_REM = 1.5;         // left below the rows and graphs
const DEFAULT_BANNER = 'bn_deluxe';

const T = {
  panel: template(`<div class="relative w-full h-full"><div class="absolute inset-0 bg-cover bg-no-repeat opacity-30 pointer-events-none"></div><div class="relative h-full flex flex-col items-center w-full"></div></div>`),
  description: template(`<div class="absolute -top-14 victories-header"><div class="font-body text-body text-xs self-center text-center"></div></div>`),
  title: template(`<div class="flex flex-row absolute -mt-6 ml-2 w-full victories-point-goal-line"><div class="victories-military-cols-1-and-2 font-title uppercase font-bold text-lg"><div role="heading"></div></div><div class="flex-1"></div><div class="flex flex-row"><div class="self-center"></div></div></div>`),
  infoTitle: template(`<div class="items-center"><div class="font-title text-xs uppercase self-center"></div><div class="font-title text-xs text-secondary uppercase self-center mb-2"></div></div>`),
  spacer: template(`<div class="w-full h-4"></div>`),
  header: template(`<div class="flex flex-row victories-military-bottom-line h-14 w-full"><div class="victories-military-col-1 font-title text-sm fxs-header uppercase self-center text-center"></div><div class="victories-military-col-2 font-title text-sm fxs-header uppercase self-center pl-4"></div><div class="victories-military-col-4 flex flex-row victories-military-left-line-header"><div class="w-full font-title text-sm fxs-header uppercase flex flex-row"><div class="self-center w-full text-center font-fit-shrink"></div></div></div><div class="victories-military-col-3 font-title text-sm"><div class="w-full h-full relative flex flex-row justify-end victories-military-left-line-header"><div class="relative ml-2 mt-2 mr-2 uppercase fxs-header self-center flex flex-row items-center"></div></div></div></div>`),
  row: template(`<div class="flex flex-row pointer-events-auto min-h-28 duration-150 ease-out"><div class="flex flex-row victories-econ-col-4"><div class="h-full w-2"></div><div class="self-center flex-1"><div class="font-title bold text-xl text-center text-white"></div></div></div></div>`),
  rowLeader: template(`<div class="absolute inset-0 flex flex-row"><div class="flex flex-row victories-econ-col-1 justify-center"><div class="self-center"></div></div><div class="relative victories-econ-col-2 victories-military-left-line"><div class="flex flex-row"><div class="mx-2"></div><div class="victories-military-player-vslot mt-7 flex-1"><div class="text-white"></div></div></div></div></div>`),
  rowBanner: template(`<div class="absolute inset-0 bg-cover bg-no-repeat duration-150 ease-out opacity-30"></div>`),
  selected: template(`<div class="pl-3"></div>`),
  empty: template(`<div class="absolute inset-0 flex items-center justify-center font-body text-sm text-accent-3"></div>`),
  ticketRow: template(`<div class="flex flex-row items-center w-full px-1 py-1"><div class="ml-2 flex-none size-7 flex items-center justify-center bg-contain bg-center bg-no-repeat"><div></div></div><div class="flex flex-col justify-center flex-auto py-1 ml-3"><div class="uppercase text-title"></div></div><div class="flex-none ml-6 mr-2"></div></div>`),
  breakdownGroup: template(`<div class="flex flex-col"></div>`),
  breakdownTitle: template(`<div class="font-title text-xs uppercase text-secondary ml-2 mt-1"></div>`),
  breakdownDetail: template(`<div class="text-xs"></div>`)
};

// ============================ Data ============================

const ages = () => [...GameInfo.Ages].sort((a, b) => a.ChronologyIndex - b.ChronologyIndex);
const ageName = (chronology) => Locale.compose(ages().find((a) => a.ChronologyIndex === chronology)?.Name ?? '');

function ageLabel(option) {
  if (option === OVERALL) return Locale.compose('LOC_ZOM_GRAPH_OVERALL');
  const age = ages().find((a) => a.ChronologyIndex === optionChronology(option));
  return age ? Locale.compose('LOC_VICTORY_AGE_NAME', age.Name) : '';
}

/** The Age filter's options: Overall, then every Age so far. */
const ageOptions = () => [OVERALL, ...ages().map((a) => a.ChronologyIndex).filter((c) => c <= currentAgeChronology()).map(ageOption)];

/** The Ages a view spans: the chosen Age, or every Age so far. */
const viewAges = (option) => (option === OVERALL
  ? ages().map((a) => a.ChronologyIndex).filter((c) => c <= currentAgeChronology())
  : [optionChronology(option)]);

/** Entries ({ age }) of the chosen Age, or all of them in Overall. */
const inAge = (entries, option) => (option === OVERALL ? entries : entries.filter((e) => e.age === optionChronology(option)));

/** Each crisis stage of the Age with its colour (and its timeline notch's). */
const crisisStages = (crises, age) => (crises.get(age) ?? []).map((s) => ({ ...s, color: CRISIS_STAGES[s.stage].color, notch: CRISIS_STAGES[s.stage].notch }));

/** Leaders with a row in a logged view: every living major and any major already logged, Spectators excluded. */
function loggedLeaders(events) {
  const ids = new Set(watchedPlayers().map((p) => p.id));
  for (const { playerId } of events) if (Players.get(playerId)?.isMajor && !isObserverPlayer(playerId)) ids.add(playerId);
  return [...ids];
}

function leaderColor(playerId) {
  try { return UI.Player.getPrimaryColorValueAsString(playerId); } catch (e) { return '#ffffff'; }
}

/**
 * A leader's portrait in a circle, a city-state's type icon or the
 * independent power icon, the last two tinted in the player's own colour
 * (leaderTint: a city-state's type colour, an independent power's own) to tell them apart.
 */
function leaderIcon(playerId) {
  const player = Players.get(playerId);
  if (player?.isMajor) return UI.getIconCSS(GameInfo.Leaders.lookup(player.leaderType)?.LeaderType ?? 'UNKNOWN_LEADER', 'CIRCLE_MASK');
  const type = player?.isMinor ? cityStateType(player) : null;
  return type ? `url("${type.icon}")` : UI.getIconCSS('INDEPENDENT_POWER');
}
function leaderTint(playerId) {
  const player = Players.get(playerId);
  if (player?.isMajor) return null;
  return (player?.isMinor ? cityStateType(player)?.color : null) ?? leaderColor(playerId);
}
/**
 * A player's name as the map's banners show it: a leader's name, a
 * City-State's settlement, an Independent Power's full name ("Retenu").
 */
function leaderName(playerId) {
  const player = Players.get(playerId);
  if (!player) return '';
  if (player.isMajor) return Locale.compose(player.name);
  const settlement = player.isMinor ? player.Cities?.getCities?.()?.[0]?.name : null;
  return Locale.compose(settlement ?? player.civilizationFullName ?? player.name ?? '');
}
/**
 * A unit type's name, also for one of an earlier Age (no longer in the
 * database): its usual text key, else '' when that is not loaded either.
 */
function unitTypeName(type) {
  const row = GameInfo.Units.lookup(type);
  if (row) return Locale.compose(row.Name);
  const key = `LOC_${type}_NAME`;
  const text = Locale.compose(key);
  return text && text !== key ? text : '';
}

/** A player's breakdown row: its icon (tinted), name and value. */
const leaderRow = (playerId, value) => ({ icon: leaderIcon(playerId), tint: leaderTint(playerId), label: opponentName(playerId), value });

/** Leaders first, then city-states, then independent powers. */
function playerKind(playerId) {
  const player = Players.get(playerId);
  if (player?.isMajor) return 0;
  return player?.isMinor ? 1 : 2;
}

/**
 * What a non-leader is, as the diplomacy screen names it: "City-State" (its
 * type shown by its icon), "Independent Power · Cultural" (the type it would
 * become); '' for a leader.
 */
function playerKindLabel(playerId) {
  const player = Players.get(playerId);
  if (!player || player.isMajor) return '';
  if (player.isMinor) return Locale.compose('LOC_CIVILIZATION_CITY_STATE_NAME');
  const type = cityStateType(player);
  const independent = Locale.compose('LOC_PLOT_TOOLTIP_INDEPENDENT_CONQUEROR');
  return type ? `${independent} · ${Locale.compose(type.name)}` : independent;
}

/** Any other player's name: its name as the map shows it, else what it is ("City-State", "Independent Power"). */
const opponentName = (playerId) => leaderName(playerId) || playerKindLabel(playerId) || Locale.compose('LOC_PLOT_TOOLTIP_INDEPENDENT_CONQUEROR');

/** A dot colour per kind of player (playerKind): leader, city-state, independent power. */
const PLAYER_KIND_COLORS = ['#e3b341', '#4d9be0', '#b5b5b6'];
const playerKindColor = (playerId) => PLAYER_KIND_COLORS[playerKind(playerId)];
/** [playerId, count] entries by kind (playerKind), then most counted first. */
const byKindThenCount = (a, b) => playerKind(a[0]) - playerKind(b[0]) || b[1] - a[1];

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

/** A row of a breakdown card: a colour dot or an icon (tinted, if given), the label (a detail under it, if given) and the count. */
function breakdownRow({ color, icon, tint, label, detail, value }) {
  const row = T.ticketRow();
  const swatch = row.firstChild;
  if (icon) swatch.style.backgroundImage = icon;
  if (tint) swatch.style.setProperty('fxs-background-image-tint', tint);
  else {
    swatch.firstChild.classList.add('size-3', 'rounded-full');
    swatch.firstChild.style.backgroundColor = color;
  }
  swatch.nextSibling.firstChild.textContent = label;
  if (detail) {
    const line = T.breakdownDetail();
    line.textContent = detail;
    swatch.nextSibling.appendChild(line);
  }
  swatch.nextSibling.nextSibling.textContent = `${value}`;
  return row;
}

const BREAKDOWN_MIN_REM = 14;   // a card's least width; wider only as its rows need

/**
 * The Culture tab's tooltip card: groups of rows ({ color | icon, label, detail, value }),
 * each a list or { title, rows }, each in its own panel (as the pin tooltip's sections).
 */
const BreakdownCard = (props) => createComponent(Tooltip.Frame, {
  'class': 'relative flex flex-col p-2 items-center justify-center',
  get children() {
    const groups = props.groups.map((g) => (Array.isArray(g) ? { rows: g } : g)).filter((g) => g.rows.length);
    return groups.map(({ title, rows }, i) => {
      const group = T.breakdownGroup();
      group.style.minWidth = `${BREAKDOWN_MIN_REM}rem`;
      if (title) {
        const heading = T.breakdownTitle();
        heading.textContent = title;
        group.appendChild(heading);
      }
      for (const row of rows.map(breakdownRow)) group.appendChild(row);
      return createComponent(CardFrame, { 'class': i < groups.length - 1 ? 'mb-2' : 'mb-3', children: group });
    });
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
 * activates to hide or show its line; with valueTooltip the value column
 * shows that content on hover; `extra` elements (a timeline and card) follow
 * the value.
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

// ============================ Panel ============================

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
 * filters (props.views: [{ id, label }]), then the tab's body.
 */
/** The Victories screen's info icon at the end of a tab's title line: the tab and its view as the heading, what it shows and how, on hover. */
const InfoTooltip = (props) => createComponent(Tooltip, {
  initialHPosition: TooltipHorizontalPosition.LEFT,
  initialVPosition: TooltipVerticalPosition.TOP,
  get children() {
    return [
      createComponent(Tooltip.Trigger, {
        get children() { return createComponent(Activatable, { 'class': 'size-8 bg-no-repeat bg-cover', style: { 'background-image': 'url(blp:icon_info)' } }); }
      }),
      createComponent(Tooltip.Content, {
        get children() {
          return createComponent(Tooltip.Frame, {
            get children() {
              const box = T.infoTitle();
              box.firstChild.textContent = props.title;
              box.firstChild.style.color = props.color;
              box.children[1].textContent = props.subtitle;
              insert(box, createComponent(CardFrame, {
                'class': 'mb-4 max-w-192',
                get children() { return createComponent(L10n.Stylize, { 'class': 'mx-4 my-4', text: props.text }); }
              }), null);
              return box;
            }
          });
        }
      })
    ];
  }
});

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
  const viewLabel = (id) => Locale.compose(props.views.find((v) => v.id === id)?.label ?? '');
  if (props.info) insert(title.lastChild.firstChild, createComponent(InfoTooltip, { title: props.title, subtitle: viewLabel(props.view()), color: props.look.color, text: props.info }));
  insert(filters, createComponent(FilterDropdown, { 'class': FILTER_WIDTH, value: props.view, options: () => props.views.map((v) => v.id), label: viewLabel, onSelect: props.setView }));
  insert(filters, createComponent(FilterDropdown, { 'class': `${FILTER_WIDTH} ml-3`, value: props.age, options: ageOptions, label: ageLabel, onSelect: props.setAge, hotkey: 'shell-action-2' }));

  content.append(description, title, T.spacer(), header, props.body());
  return panel;
};

const emptyText = (text) => { const empty = T.empty(); empty.textContent = text; return empty; };

export {
  ageName, BreakdownCard, byKindThenCount, crisisStages, emptyText, fillPanel, GraphPanel, HoverTooltip, inAge, leaderColor, leaderIcon, leaderName, leaderRow, leaderTint,
  LeaderRow, opponentName, playerKind, playerKindColor, playerKindLabel, unitTypeName, LeaderRows, loggedLeaders, OVERALL, rowHeight, viewAges
};
