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
 * founded, captured, lost and upgraded on one bar - a pin coloured and
 * showing a city or a town, its dot by what happened, each with the other
 * player involved, and an arc from a town's founding or capture to its
 * upgrade into a city - the leader's
 * settlements as the Total and a card of its cities and towns at the end of
 * the view (now, for the current Age).
 */
import { EMPIRE_KEYS, leaderDetails } from './observer-empire.js';
import { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS } from './observer-settlement-log.js';

const COUNTS = { city: EMPIRE_KEYS.cities, town: EMPIRE_KEYS.towns };

const iconOf = (source) => SETTLEMENT_KINDS[source.settlement]?.icon ?? '';
const UPGRADED = SETTLEMENT_CATEGORIES.findIndex((c) => c.id === 'upgraded');
const LOST = SETTLEMENT_CATEGORIES.findIndex((c) => c.id === 'lost');
const order = (a, b) => a.age - b.age || a.turn - b.turn;

/** Each upgrade, linked to how the leader came to have that town (its latest founding or capture before). */
const upgradeLinks = (events) => events.filter((e) => e.category === UPGRADED).flatMap((upgrade) => {
  const start = events.filter((e) => e.plot === upgrade.plot && e.category !== UPGRADED && e.category !== LOST && order(e, upgrade) <= 0)
    .sort(order).pop();
  return start ? [[start, upgrade]] : [];
});

/** The leader's cities and towns at the end of the view: { city, town }. */
function settlementCounts(playerId, lastAge) {
  const own = leaderDetails(playerId, lastAge);
  return Object.fromEntries(Object.entries(COUNTS).map(([kind, key]) => [kind, own.get(key) ?? 0]));
}

/** What happened, with the other player involved or how: "Captured · <player>". */
function settlementDetail(source) {
  const category = Locale.compose(SETTLEMENT_CATEGORIES[source.category]?.label ?? '');
  const other = source.other >= 0 ? Players.get(source.other)?.name : null;
  const detail = source.how ?? other;
  return detail ? Locale.compose('LOC_ZOM_GRAPH_UNIT_SOURCE', category, Locale.compose(detail)) : category;
}

const SETTLEMENTS_SUBJECT = {
  looks: { settlements: { color: '#d8c38a', background: 'bg_victory_economic3' } },
  categories: SETTLEMENT_CATEGORIES,
  featured: UPGRADED,
  pinIcon: iconOf,
  pinColor: (source) => SETTLEMENT_KINDS[source.settlement]?.color,
  icon: iconOf,
  name: (source) => Locale.compose(source.type),
  detail: settlementDetail,
  sourceOf: (event) => ({ settlement: event.settlement, other: event.other, how: event.how }),
  links: upgradeLinks,
  value: (playerId, { lastAge }) => { const counts = settlementCounts(playerId, lastAge); return counts.city + counts.town; },
  card: (playerId, { lastAge }) => {
    const counts = settlementCounts(playerId, lastAge);
    return { cities: counts.city, cells: Object.keys(COUNTS).map((kind) => ({ icon: SETTLEMENT_KINDS[kind].icon, count: counts[kind] })) };
  },
  cardHover: false,
  tieBreak: (entry) => entry.card.cities
};

export { SETTLEMENTS_SUBJECT };
