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
 * Zatygold's Spectator - Settlements timeline (in-game scope).
 *
 * The Empire view's Settlements tab (observer-graph-empire.js) of the
 * settlement log (observer-settlement-log.js): each leader's settlements
 * founded, captured, lost, razed and upgraded, a pin showing a city or a town
 * and a dashed arc from what each followed from; the settlements held as the
 * Total (cities and towns on hover) and its urbanization (urban share of its
 * developed tiles) on the card, its most urban and most rural settlement on hover.
 */
import { currentAgeChronology } from '../shared/zom-util.js';
import { EMPIRE_KEYS, leaderDetails, POPULATION_KINDS, settlementDevelopment } from './observer-empire.js';
import { byTime, categoryIndex } from './observer-event-log.js';
import { detailText, opponentName } from './observer-graph-parts.js';
import { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS } from './observer-settlement-log.js';

const CATEGORY = categoryIndex(SETTLEMENT_CATEGORIES);
const COUNTS = { city: EMPIRE_KEYS.cities, town: EMPIRE_KEYS.towns };
const URBAN_ICON = POPULATION_KINDS.find((k) => k.id === 'urban').icon;

const iconOf = (source) => SETTLEMENT_KINDS[source.settlement]?.icon ?? '';

/** What each later event of a settlement links back to: an upgrade to its founding or capture, else its latest event before. */
const notRazed = (e) => e.category !== CATEGORY.razed;
const LINKED_FROM = {
  [CATEGORY.upgraded]: (e) => ![CATEGORY.upgraded, CATEGORY.lost, CATEGORY.razed].includes(e.category),
  [CATEGORY.captured]: notRazed,
  [CATEGORY.lost]: notRazed,
  [CATEGORY.razed]: notRazed
};

/** Each upgrade, capture, loss and razing, linked to the latest event of the same settlement before it that it follows from. */
function settlementLinks(events) {
  const byPlot = new Map();
  for (const e of [...events].sort(byTime)) {
    if (!byPlot.has(e.plot)) byPlot.set(e.plot, []);
    byPlot.get(e.plot).push(e);
  }
  return [...byPlot.values()].flatMap((own) => own.flatMap((later) => {
    const follows = LINKED_FROM[later.category];
    const start = follows && own.filter((e) => e !== later && follows(e) && byTime(e, later) <= 0).pop();
    return start ? [[start, later]] : [];
  }));
}

/** The % of developed tiles ({ urban, rural }) that are urban; null with none. */
const urbanization = ({ urban, rural }) => (urban + rural > 0 ? Math.round((urban / (urban + rural)) * 100) : null);
const percentText = (value) => (value == null ? '-' : Locale.compose('LOC_ZOM_GRAPH_PERCENT', value));

/** The leader's settlements at the end of the view: { city, town, urbanization }. */
function settlementState(playerId, lastAge) {
  const own = leaderDetails(playerId, lastAge);
  return {
    ...Object.fromEntries(Object.entries(COUNTS).map(([kind, key]) => [kind, own.get(key) ?? 0])),
    urbanization: urbanization({ urban: own.get(EMPIRE_KEYS.urbanTiles) ?? 0, rural: own.get(EMPIRE_KEYS.ruralTiles) ?? 0 })
  };
}

/** A settlement's row: its urbanization, its urban and rural tiles under it. */
const settlementRow = (s) => ({
  icon: SETTLEMENT_KINDS[s.town ? 'town' : 'city'].icon,
  label: Locale.compose(s.name),
  detail: detailText(Locale.compose('LOC_ZOM_GRAPH_URBAN_TILES', s.urban), Locale.compose('LOC_ZOM_GRAPH_RURAL_TILES', s.rural)),
  value: percentText(s.share)
});

/** The card's hover: the most urbanized and the most rural settlement now (ties: the larger), else the leader's urbanization. */
function urbanizationGroups(playerId, percent) {
  const ranked = settlementDevelopment(playerId).map((s) => ({ ...s, share: urbanization(s) })).filter((s) => s.share != null);
  const size = (s) => s.urban + s.rural;
  const most = [...ranked].sort((a, b) => b.share - a.share || size(b) - size(a))[0];
  const least = [...ranked].sort((a, b) => a.share - b.share || size(b) - size(a))[0];
  if (!most) return [[{ icon: URBAN_ICON, label: Locale.compose('LOC_ZOM_GRAPH_URBANIZATION'), value: percent }]];
  return [
    { title: Locale.compose('LOC_ZOM_GRAPH_MOST_URBAN'), rows: [settlementRow(most)] },
    { title: Locale.compose('LOC_ZOM_GRAPH_MOST_RURAL'), rows: least !== most ? [settlementRow(least)] : [] }
  ];
}

/** What happened, with how or the other player involved: "Captured · Augustus". */
function settlementDetail(source) {
  const how = source.how ? Locale.compose(source.how) : (source.other >= 0 ? opponentName(source.other) : '');
  return detailText(Locale.compose(SETTLEMENT_CATEGORIES[source.category]?.label ?? ''), how);
}

const SETTLEMENTS_SUBJECT = {
  looks: { settlements: { color: '#d8c38a', background: 'bg_victory_economic3' } },
  categories: SETTLEMENT_CATEGORIES,
  priority: [CATEGORY.razed, CATEGORY.lost, CATEGORY.captured, CATEGORY.upgraded],   // an outcome outranks a founding
  pinIcon: iconOf,
  pinColor: (source) => (SETTLEMENT_CATEGORIES[source.category]?.pin ? SETTLEMENT_CATEGORIES[source.category].color : SETTLEMENT_KINDS[source.settlement]?.color),   // an outcome's colour, else city or town
  icon: iconOf,
  name: (source) => Locale.compose(source.type),
  detail: settlementDetail,
  sourceOf: (event) => ({ settlement: event.settlement, other: event.other, how: event.how }),
  links: settlementLinks,
  value: (playerId, { lastAge }) => { const state = settlementState(playerId, lastAge); return state.city + state.town; },
  totalGroups: (entry) => [Object.keys(COUNTS).map((kind) => ({ icon: SETTLEMENT_KINDS[kind].icon, label: Locale.compose(SETTLEMENT_KINDS[kind].label), value: entry?.card.state[kind] ?? 0 }))],
  card: (playerId, { lastAge }) => {
    const state = settlementState(playerId, lastAge);
    const percent = percentText(state.urbanization);
    const groups = lastAge === currentAgeChronology()
      ? urbanizationGroups(playerId, percent)
      : [[{ icon: URBAN_ICON, label: Locale.compose('LOC_ZOM_GRAPH_URBANIZATION'), value: percent }]];   // settlements are not kept per Age
    return { state, cells: [{ icon: URBAN_ICON, count: percent, core: state.urbanization }], groups };
  },
  tieBreak: (entry) => entry.card.state.city
};

export { SETTLEMENTS_SUBJECT };
