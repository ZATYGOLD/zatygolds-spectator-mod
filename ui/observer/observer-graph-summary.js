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
 * Zatygold's Spectator - Summary tabs (in-game scope).
 *
 * A view's Summary tab, laid out like the Victories screen's: a card per
 * chosen tab (art, its own title colour, an icon and a description), then
 * its value line (the tab's info and the world's total or average) and the
 * leaders ranked by that tab's value in the chosen Age, the first three set apart;
 * the leader with the best value is shown in full (the others dimmed, as the
 * Victories cards dim all but the winner). The tab's info explains it; a
 * card opens its tab. A tab:
 *
 *   { id, label, description, columns: [{ tab (id), art (civArt), icon (blp name),
 *     color (else the tab's), card (its card's first cell), average (the value line averages, percent: as a %),
 *     label, description (else the tab's) }] }
 *
 * Art is a base-game civilization's loading scene (no DLC needed; its 720
 * size, softer and lighter on the graphics card), dimmed and washed in the
 * card's colour as the Victories cards' art is. No CSS filters: each is a
 * render layer of its own.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createRenderEffect } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { Activatable } from 'fs://game/core/ui-next/components/activatable.js';
import { PortraitIcon } from 'fs://game/core/ui-next/components/portrait-icon.js';
import { ScrollArea } from 'fs://game/core/ui-next/components/scroll-area.js';
import { useTabContext } from 'fs://game/core/ui-next/components/tab.js';
import { fillPanel, formatValue, InfoTooltip, insertFilters, leaderName, LeaderRows, panelDescription, viewLabel } from './observer-graph-parts.js';
import { lineTotals } from './observer-graph-lines.js';
import { timelineTotals } from './observer-graph-timelines.js';

const TOP_PLACES = 3;   // set apart from the rest, as on the Victories summary

/** A card's art: a civilization's loading scene (civ: 'rome'), cropped to the card. */
const civArt = (civ) => ({ image: `lsbg_${civ}_720`, size: 'cover', position: 'center' });
const WASH_DEPTH = 0.6;   // the wash is the card's colour darkened to this share

/** The card's colour wash over its art: strongest at the top, fading to dark under the leaders. */
function colorWash(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * WASH_DEPTH));
  const shade = (alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;
  return `linear-gradient(to bottom, ${shade(0.45)} 0%, ${shade(0.3)} 45%, rgba(8, 8, 10, 0.85) 100%)`;
}

const T = {
  panel: template(`<div class="relative w-full h-full flex flex-col"></div>`),
  filters: template(`<div class="flex flex-row justify-end w-full flex-none mb-2"><div class="flex flex-row"></div></div>`),
  cards: template(`<div class="flex flex-row w-full h-full"></div>`),
  art: template(`<div class="victories-summary-bg pointer-events-auto absolute inset-0 bg-no-repeat opacity-30"></div>`),   // brightened on hover (victories-screen.css)
  wash: template(`<div class="absolute inset-0 pointer-events-none"></div>`),
  top: template(`<div class="relative flex flex-col w-full"><div class="uppercase font-bold mt-6"><div role="heading"></div></div><div class="victories-summary-header-lines promotion-header__lines self-center bg-cover bg-no-repeat pointer-events-none flex-auto"></div><div class="self-center size-8 -mt-6 bg-contain bg-center bg-no-repeat"></div><div class="font-body text-2xs self-center mt-4 mx-6 h-16 opacity-60"><div role="heading"></div></div></div>`),
  // The Victories point goal panel's: each line's content, then its rule (inset).
  list: template(`<div class="relative flex flex-col px-4 w-full"></div>`),
  goal: template(`<div class="flex flex-col"><div class="relative w-full flex flex-row"><div class="mt-1 ml-3 h-7 flex flex-row"></div><div class="self-center flex-1 flex flex-row justify-between mx-2"><div class="font-title-sm opacity-80 uppercase ml-1" role="heading"></div><div class="font-body-sm opacity-80" role="heading"></div></div></div><div class="victories-point-goal-line w-full justify-center mx-4"></div></div>`),
  row: template(`<div class="flex flex-col"><div class="relative w-full flex flex-row"><div class="flex flex-row h-14 my-1 w-full"><div class="mr-2 self-center"></div><div class="flex-1 flex flex-row justify-between"><div class="victories-name-field font-body text-2xs self-center -ml-2 text-left" role="heading"></div><div class="font-body text-2xs self-center mr-2" role="heading"></div></div></div></div><div class="victories-point-goal-line w-full justify-center mx-4"></div></div>`),
  decor: template(`<div class="victories-point-goal-line w-full flex flex-row justify-center mx-4"><div class="img-popup-middle-decor size-16"></div></div>`)
};

const sortKey = (value) => (Number.isFinite(value) ? value : -Infinity);

/** A column's leaders in the chosen Age, best first: [{ id, key, text }]. */
function columnRanking(column, age, crises) {
  const { tab, subject } = column;
  let cells;
  if (column.kind === 'line') {
    cells = lineTotals(tab, column.entries()).map((r) => ({ id: r.id, key: sortKey(r.value), text: formatValue(r.value) }));
  } else {
    cells = timelineTotals(subject, tab, column.entries(), column.leaders(), age, crises).map((entry) => {
      const first = entry.card.cells[0];
      return column.card
        ? { id: entry.id, key: sortKey(first?.core ?? Number(first?.count)), text: `${first?.count ?? '-'}` }
        : { id: entry.id, key: sortKey(entry.value), text: formatValue(entry.value) };
    });
  }
  const dir = tab.lowFirst ? -1 : 1;
  return cells.sort((a, b) => dir * (b.key - a.key) || 0);
}

/** The best key of a ranking, null when the leaders do not differ. */
function bestKey(ranking) {
  const keys = ranking.map((c) => c.key).filter(Number.isFinite);
  return keys.length > 1 && Math.min(...keys) !== Math.max(...keys) ? ranking[0].key : null;
}

/** A column's value line: the world's total (its leaders' values summed), or their average for an `average` column (a % for a `percent` one). */
function worldValue(column, ranking) {
  const keys = ranking.map((c) => c.key).filter(Number.isFinite);
  if (!column.average) return formatValue(keys.reduce((sum, key) => sum + key, 0));
  if (!keys.length) return '-';
  const mean = Math.round(keys.reduce((sum, key) => sum + key, 0) / keys.length);
  return column.percent ? Locale.compose('LOC_ZOM_GRAPH_PERCENT', mean) : formatValue(mean);
}

/**
 * A leader's line, kept while the leader has one (updated, not rebuilt):
 * portrait, place and name, value, dimmed unless the best; the Victories
 * ornament above the first place after the top ones.
 */
function leaderLine(id, cell, index, best) {
  const decor = T.decor();
  const row = T.row();
  const [portrait, rest] = row.firstChild.firstChild.children;
  const [name, value] = rest.children;
  insert(portrait, createComponent(PortraitIcon, { playerId: id, size: 12 }));
  const leader = leaderName(id);
  createRenderEffect(() => {
    name.textContent = `${index() + 1}. ${leader}`;
    value.textContent = cell()?.text ?? '-';
    const dim = cell()?.key !== best();
    for (const el of [name, value]) el.classList[dim ? 'add' : 'remove']('opacity-60');
    decor.style.display = index() === TOP_PLACES ? '' : 'none';
  });
  return [decor, row];
}

/** One tab's card: art, title, emblem and description, then its value line and ranked leaders. */
const ColumnCard = (props) => {
  const { column } = props;
  const color = column.color ?? (column.tab.look ?? column.subject.looks?.[column.tab.id])?.color;
  const title = Locale.compose(column.label ?? column.tab.label);
  const top = T.top();
  const [heading, , icon, description] = top.children;
  heading.classList.add(props.narrow ? 'text-lg' : 'text-2xl');
  heading.style.color = color;
  heading.firstChild.textContent = title;
  icon.style.backgroundImage = `url(blp:${column.icon})`;
  description.firstChild.textContent = Locale.compose(column.description ?? column.tab.description);
  if (props.narrow) description.classList.replace('mx-6', 'mx-3');
  const art = T.art();
  Object.assign(art.style, {
    backgroundImage: `url(blp:${column.art.image})`, backgroundSize: column.art.size, backgroundPosition: column.art.position
  });
  const wash = T.wash();
  wash.style.backgroundImage = colorWash(color);

  const list = T.list();
  const goal = T.goal();
  const [infoSlot, line] = goal.firstChild.children;
  if (column.tab.info) insert(infoSlot, createComponent(InfoTooltip, { size: 6, 'class': 'self-center mr-2', title, subtitle: props.viewLabel, color, text: column.tab.info }));
  line.firstChild.textContent = Locale.compose(column.average ? 'LOC_ZOM_GRAPH_AVERAGE' : column.tab.valueLabel ?? 'LOC_ZOM_GRAPH_TOTAL_COLUMN');
  insert(line.lastChild, () => worldValue(column, props.ranking()));
  list.appendChild(goal);
  const best = createMemo(() => bestKey(props.ranking()));
  insert(list, createComponent(LeaderRows, { rows: props.ranking, row: (id, cell, index) => leaderLine(id, cell, index, best) }), null);

  return createComponent(Activatable, {
    'class': `victories-summary-box pointer-events-auto duration-150 ease-out font-title text-center text-white relative flex flex-col ${props.last ? '' : 'victories-summary-divider'}`,
    style: { 'transition-property': 'opacity', 'width': `${100 / props.count}%` },
    onActivate: props.onActivate,
    get children() { return [art, wash, top, list]; }
  });
};

/** The Chronicle's tab bar, to open a card's tab (none outside it). */
function tabContext() {
  try { return useTabContext(); } catch (e) { return null; }
}

/** A view's Summary tab: { tab, columns: [{ tab, subject, kind, entries, leaders, card, label, description }], ...filters }. */
const SummaryPanel = (props) => {
  const { tab, columns } = props;
  const tabs = tabContext();
  const rankings = createMemo(() => { props.turn(); return columns.map((c) => columnRanking(c, props.age(), props.crises())); });
  const panel = T.panel();
  const filters = T.filters();
  insertFilters(filters.firstChild, props);
  const scroll = T.cards();
  fillPanel(scroll);
  const label = viewLabel(props.views, props.view());
  insert(scroll, createComponent(ScrollArea, {
    'class': 'h-full w-full relative',
    useProxy: true,
    get children() {
      const cards = T.cards();
      columns.forEach((column, i) => insert(cards, createComponent(ColumnCard, {
        column,
        ranking: () => rankings()[i],
        viewLabel: label,
        count: columns.length,
        narrow: columns.length > 4,
        last: i === columns.length - 1,
        onActivate: () => tabs?.activate(column.tab.id)
      }), null));
      return cards;
    }
  }));
  panel.append(panelDescription(Locale.compose(tab.description)), filters, scroll);
  return panel;
};

/** A view's Summary tab (first in the view) of the columns' tabs. */
const summaryTab = (columns) => ({ id: 'summary', label: 'LOC_ZOM_GRAPH_SUMMARY', description: 'LOC_ZOM_GRAPH_SUMMARY_DESC', columns });

export { civArt, SummaryPanel, summaryTab };
