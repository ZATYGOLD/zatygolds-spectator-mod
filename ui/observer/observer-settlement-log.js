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
 * Zatygold's Spectator - Observer settlement log (in-game scope).
 *
 * Records, per leader, each settlement it founded (or incorporated), captured,
 * lost, razed (also for the player it was taken from) and upgraded from a town
 * to a city (observer-settlement-watch.js), each a city or a town at the time.
 * An event log (observer-event-log.js) with the fields
 * "<code>,<kind>,<name>,<otherPlayerId>,<plot>" (CODES; kind city or town).
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { byTime, categoryIndex, createEventLog } from './observer-event-log.js';
import { watchSettlements } from './observer-settlement-watch.js';

const log = createLogger('observer-settlement-log', CONFIG.debug);
const SETTLEMENT_LOG_EVENT = 'zom-settlement-log-changed';

/** Settlement kinds: label, icon and pin colour. */
const SETTLEMENT_KINDS = {
  city: { label: 'LOC_UI_SETTLEMENT_TAB_BAR_CITIES', icon: 'url(blp:Yield_Cities)', color: '#d9a21e' },
  town: { label: 'LOC_UI_SETTLEMENT_TAB_BAR_TOWNS', icon: 'url(blp:Yield_Towns)', color: '#6f9fc8' }
};

/** What happened to a settlement, in display order: dot colour. */
const SETTLEMENT_CATEGORIES = [
  { id: 'founded', label: 'LOC_ZOM_GRAPH_FOUNDED', color: '#5fae4c' },
  { id: 'captured', label: 'LOC_ZOM_GRAPH_CAPTURED', color: '#e0a03a' },
  { id: 'lost', label: 'LOC_ZOM_GRAPH_SETTLEMENTS_LOST', color: '#c0504a' },
  { id: 'razed', label: 'LOC_ZOM_GRAPH_RAZED', color: '#5b2a86' },
  { id: 'upgraded', label: 'LOC_ZOM_GRAPH_UPGRADED', color: '#e8d27a' }
];
const CATEGORY = categoryIndex(SETTLEMENT_CATEGORIES);

/** Each saved letter: its category, and how it came about (shown in the pin tooltips). */
const CODES = {
  f: { category: CATEGORY.founded, how: null },
  i: { category: CATEGORY.founded, how: 'LOC_ZOM_GRAPH_INCORPORATED' },
  c: { category: CATEGORY.captured, how: null },
  l: { category: CATEGORY.lost, how: null },
  r: { category: CATEGORY.razed, how: null },
  u: { category: CATEGORY.upgraded, how: null }
};

const events = createEventLog({ keyPrefix: 'ZOM_SETTLEMENT_LOG_', fieldCount: 5, changeEvent: SETTLEMENT_LOG_EVENT, log });

/**
 * Every logged event: [{ age, turn, progress, playerId, kind, category, how, settlement, type, other, plot, count }]
 * (a razing shows the settlement as the leader last had it: a town lost stays a town).
 */
function settlementLog() {
  const all = events.read().flatMap(({ fields: [code, settlement, type, other, plot], ...entry }) => (!CODES[code] || !SETTLEMENT_KINDS[settlement] ? []
    : [{ ...entry, kind: 'settlements', ...CODES[code], settlement, type, other: Number(other), plot: Number(plot) }]))
    .sort(byTime);
  const last = new Map();   // "player:plot" -> the settlement kind it last had
  for (const e of all) {
    const key = `${e.playerId}:${e.plot}`;
    if (e.category === CATEGORY.razed && last.has(key)) e.settlement = last.get(key);
    last.set(key, e.settlement);
  }
  return all;
}

/** A settlement's event for a leader (and the other player involved). */
function record(playerId, code, settlement, other = -1) {
  if (Players.get(playerId)?.isMajor) events.record(playerId, [code, settlement.town ? 'town' : 'city', settlement.name, other, settlement.plot]);
}

watchSettlements({
  founded: (settlement) => record(settlement.owner, 'f', settlement),
  transferred: (settlement, { from, to, incorporated }) => {
    if (incorporated) return record(to, 'i', settlement, from);
    record(to, 'c', settlement, from);
    record(from, 'l', settlement, to);
  },
  upgraded: (settlement) => record(settlement.owner, 'u', settlement),
  razed: ({ from, owner, ...settlement }) => {   // by its last owner, if it took it, and for the player it was taken from
    const razer = from != null ? owner : -1;
    const victim = from ?? owner;
    record(razer, 'r', settlement, victim);
    if (victim !== razer) record(victim, 'r', settlement, razer);
  }
});

export { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS, SETTLEMENT_LOG_EVENT, settlementLog };
