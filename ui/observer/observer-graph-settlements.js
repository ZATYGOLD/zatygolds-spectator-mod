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
 * Total and its cities and towns on the card (now, or at the end of the Age).
 */
import { EMPIRE_KEYS, leaderDetails } from './observer-empire.js';
import { byTime, categoryIndex } from './observer-event-log.js';
import { detailText, opponentName } from './observer-graph-parts.js';
import { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS } from './observer-settlement-log.js';

const CATEGORY = categoryIndex(SETTLEMENT_CATEGORIES);
const COUNTS = { city: EMPIRE_KEYS.cities, town: EMPIRE_KEYS.towns };

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

/** The leader's cities and towns at the end of the view: { city, town }. */
function settlementCounts(playerId, lastAge) {
  const own = leaderDetails(playerId, lastAge);
  return Object.fromEntries(Object.entries(COUNTS).map(([kind, key]) => [kind, own.get(key) ?? 0]));
}

/** What happened, with how or the other player involved: "Captured · Augustus". */
function settlementDetail(source) {
  const how = source.how ? Locale.compose(source.how) : (source.other >= 0 ? opponentName(source.other) : '');
  return detailText(Locale.compose(SETTLEMENT_CATEGORIES[source.category]?.label ?? ''), how);
}

const SETTLEMENTS_SUBJECT = {
  looks: { settlements: { color: '#d8c38a', background: 'bg_victory_economic3' } },
  categories: SETTLEMENT_CATEGORIES,
  priority: [CATEGORY.upgraded],
  pinIcon: iconOf,
  pinColor: (source) => SETTLEMENT_KINDS[source.settlement]?.color,
  icon: iconOf,
  name: (source) => Locale.compose(source.type),
  detail: settlementDetail,
  sourceOf: (event) => ({ settlement: event.settlement, other: event.other, how: event.how }),
  links: settlementLinks,
  value: (playerId, { lastAge }) => { const counts = settlementCounts(playerId, lastAge); return counts.city + counts.town; },
  card: (playerId, { lastAge }) => {
    const counts = settlementCounts(playerId, lastAge);
    return { cities: counts.city, cells: Object.keys(COUNTS).map((kind) => ({ icon: SETTLEMENT_KINDS[kind].icon, count: counts[kind] })) };
  },
  cardHover: false,
  tieBreak: (entry) => entry.card.cities
};

export { SETTLEMENTS_SUBJECT };
