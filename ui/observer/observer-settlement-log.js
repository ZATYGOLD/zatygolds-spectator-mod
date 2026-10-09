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
 * Records, per leader, Age, turn and Age progress, the settlements each
 * leader founded (or incorporated), captured, lost and upgraded from a town
 * to a city - each a city or a town at the time - with the other player
 * involved and the settlement's plot (linking a town's pins to its upgrade).
 *
 * A settlement changing hands (CityTransfered) is lost by its last owner and
 * captured by its new one - in combat or by treaty. Owners are kept by the
 * settlement's plot, as the event names only the new owner, and every
 * settlement already on the map is known, so a loaded game logs nothing new.
 * A town becoming a city is noticed when its government changes and at the
 * start of every turn. The log is an event log (observer-event-log.js) with
 * the fields "<code>,<kind>,<name>,<otherPlayerId>,<plot>" (CODES: f founded,
 * i incorporated, c captured, l lost, r razed, u upgraded; the kind city or
 * town). A settlement gone from the map is razed, for its last owner and for
 * the player it was taken from (the other player each other's).
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { createEventLog, payloadLogger } from './observer-event-log.js';
import { cityAt } from './observer-settlement-info.js';

const log = createLogger('observer-settlement-log', CONFIG.debug);
const KEY_PREFIX = 'ZOM_SETTLEMENT_LOG_';
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

/** The saved letter of each event: its category and how it came about (shown in the pin tooltips). */
const CATEGORY = Object.fromEntries(SETTLEMENT_CATEGORIES.map((c, i) => [c.id, i]));
const CODES = {
  f: { category: CATEGORY.founded, how: null },
  i: { category: CATEGORY.founded, how: 'LOC_ZOM_GRAPH_INCORPORATED' },
  c: { category: CATEGORY.captured, how: null },
  l: { category: CATEGORY.lost, how: null },
  r: { category: CATEGORY.razed, how: null },
  u: { category: CATEGORY.upgraded, how: null }
};

const events = createEventLog({ keyPrefix: KEY_PREFIX, fieldCount: 5, changeEvent: SETTLEMENT_LOG_EVENT, log });

/**
 * Every logged event: [{ age, turn, progress, playerId, kind, category, how, settlement, type, other, plot, count }]
 * (a razing shows the settlement as the leader last had it: a town lost stays a town).
 */
function settlementLog() {
  const all = events.read().flatMap(({ fields: [code, settlement, type, other, plot], ...entry }) => (!CODES[code] || !SETTLEMENT_KINDS[settlement] ? []
    : [{ ...entry, kind: 'settlements', ...CODES[code], settlement, type, other: Number(other), plot: Number(plot) }]))
    .sort((a, b) => a.age - b.age || a.turn - b.turn);
  for (const [i, e] of all.entries()) {
    if (e.category !== CATEGORY.razed) continue;
    const had = all.slice(0, i).filter((p) => p.playerId === e.playerId && p.plot === e.plot).pop();
    if (had) e.settlement = had.settlement;
  }
  return all;
}

/** A field without the log's separators (a settlement may carry a player's own name). */
const field = (text) => String(text ?? '').replace(/[,;|]/g, ' ');

const plotOf = (city) => GameplayMap.getIndexFromLocation(city.location);
/** What is logged of a settlement, kept while it is on the map. */
const snapshot = (city) => ({ owner: city.owner, town: city.isTown, name: city.name, plot: plotOf(city), from: city.originalOwner !== city.owner ? city.originalOwner : null });

function record(playerId, code, settlement, other = -1) {
  events.record(playerId, [code, settlement.town ? 'town' : 'city', field(settlement.name), other ?? -1, settlement.plot]);
}

// ============================ Recording ============================

const settlements = new Map();   // plot index -> snapshot (from: who it was taken from), for every settlement on the map
/** A settlement noted as it is now, keeping who it was taken from; one changing hands is left to onTransfered. */
const note = (city) => {
  const last = settlements.get(plotOf(city));
  if (last && last.owner !== city.owner) return;
  settlements.set(plotOf(city), { ...snapshot(city), from: last?.from ?? snapshot(city).from });
};


const showPayload = payloadLogger(log);

/** A new settlement on the map is founded by its owner. */
function onInitialized(data) {
  showPayload('CityInitialized', data);
  const city = data?.cityID && Cities.get(data.cityID);
  if (!city) return;
  if (settlements.has(plotOf(city))) return;
  note(city);
  record(city.owner, 'f', snapshot(city));
}

/** The plot of a settlement a player just lost: one of its own no longer held by it. */
function plotLostBy(owner) {
  return [...settlements].find(([plot, last]) => last.owner === owner && cityAt(plot)?.owner !== owner)?.[0];
}

/**
 * A settlement changing hands (fromPlayer to the new owner): lost by its last
 * owner, captured (or incorporated) by its new one - noted even when it is
 * gone at once, from what was known of it.
 */
function onTransfered(data) {
  showPayload('CityTransfered', data);
  const from = data?.fromPlayer;
  const to = data?.cityID?.owner;
  const city = data?.cityID && Cities.get(data.cityID);
  const plot = city ? plotOf(city) : plotLostBy(from);
  const known = plot == null ? null : (settlements.get(plot) ?? (city && snapshot(city)));
  log(`transfer: ${known?.name ?? '?'} ${from} -> ${to}`);
  if (known && from != null && to != null && from !== to) {
    settlements.set(plot, { ...known, owner: to, from });
    if (data.transferType === CityTransferTypes.BY_INCORPORATE_CITY_STATE) record(to, 'i', known, from);
    else {
      record(to, 'c', known, from);
      if (Players.get(from)?.isMajor) record(from, 'l', known, to);
    }
  }
  setTimeout(sweep, 0);   // once the map has settled
}

/** Settlements gone from the map: razed, for their last owner and the player they were taken from. */
function sweep() {
  for (const [plot, last] of settlements) {
    if (cityAt(plot)) continue;
    settlements.delete(plot);
    const razer = last.from != null ? last.owner : -1;
    const from = last.from ?? last.owner;
    if (Players.get(razer)?.isMajor) record(razer, 'r', last, from);
    if (from !== razer && Players.get(from)?.isMajor) record(from, 'r', last, razer);
  }
}

const allSettlements = () => Players.getAlive().flatMap((player) => player.Cities?.getCities?.() ?? []);

/** Towns that became cities since last seen are upgraded by their owner (a city becoming a town is only noted). */
function checkUpgrades() {
  for (const city of allSettlements()) {
    const last = settlements.get(plotOf(city));
    if (last?.owner === city.owner && last.town && !city.isTown) record(city.owner, 'u', snapshot(city));
    if (last) note(city);
  }
}

onObserverReady(() => {
  try { allSettlements().forEach(note); } catch (e) { log(`settlements not seeded: ${e}`); }
  engine.on('CityInitialized', onInitialized);
  engine.on('CityTransfered', onTransfered);
  engine.on('CityRemovedFromMap', () => setTimeout(sweep, 0));
  engine.on('CityGovernmentLevelChanged', (data) => { showPayload('CityGovernmentLevelChanged', data); checkUpgrades(); });
  engine.on('TurnBegin', () => { sweep(); checkUpgrades(); });
});

export { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS, SETTLEMENT_LOG_EVENT, settlementLog };
