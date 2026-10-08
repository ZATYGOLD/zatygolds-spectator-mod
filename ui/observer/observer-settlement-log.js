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
 * i incorporated, c captured, l lost, u upgraded; the kind city or town).
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { createEventLog } from './observer-event-log.js';

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
  { id: 'upgraded', label: 'LOC_ZOM_GRAPH_UPGRADED', color: '#e8d27a' }
];

/** The saved letter of each event: its category and how it came about (shown in the pin tooltips). */
const CODES = {
  f: { category: 0, how: null },
  i: { category: 0, how: 'LOC_ZOM_GRAPH_INCORPORATED' },
  c: { category: 1, how: null },
  l: { category: 2, how: null },
  u: { category: 3, how: null }
};

const events = createEventLog({ keyPrefix: KEY_PREFIX, fieldCount: 5, changeEvent: SETTLEMENT_LOG_EVENT, log });

/** Every logged event: [{ age, turn, progress, playerId, kind, category, how, settlement, type, other, plot, count }]. */
function settlementLog() {
  return events.read().flatMap(({ fields: [code, settlement, type, other, plot], ...entry }) => (!CODES[code] || !SETTLEMENT_KINDS[settlement] ? []
    : [{ ...entry, kind: 'settlements', ...CODES[code], settlement, type, other: Number(other), plot: Number(plot) }]));
}

/** A field without the log's separators (a settlement may carry a player's own name). */
const field = (text) => String(text ?? '').replace(/[,;|]/g, ' ');

const plotOf = (city) => GameplayMap.getIndexFromLocation(city.location);

function record(playerId, code, city, other = -1) {
  events.record(playerId, [code, city.isTown ? 'town' : 'city', field(city.name), other ?? -1, plotOf(city)]);
}

// ============================ Recording ============================

const settlements = new Map();   // plot index -> { owner, town }, for every settlement on the map
const note = (city) => settlements.set(plotOf(city), { owner: city.owner, town: city.isTown });

/** The first payload of each event, to confirm its fields in UI.log. */
const shown = new Set();
function showPayload(name, data) {
  if (shown.has(name)) return;
  shown.add(name);
  try { log(`${name} payload: ${JSON.stringify(data)}`); } catch (e) { /* ignore */ }
}

/** A new settlement on the map is founded by its owner. */
function onInitialized(data) {
  showPayload('CityInitialized', data);
  const city = data?.cityID && Cities.get(data.cityID);
  if (!city) return;
  if (settlements.has(plotOf(city))) return;
  note(city);
  record(city.owner, 'f', city);
}

/** A settlement changing hands: lost by its last owner, captured (or incorporated) by its new one. */
function onTransfered(data) {
  showPayload('CityTransfered', data);
  const city = data?.cityID && Cities.get(data.cityID);
  if (!city) return;
  const from = settlements.get(plotOf(city))?.owner ?? city.originalOwner;
  note(city);
  if (from === city.owner) return;
  if (data.transferType === CityTransferTypes.BY_INCORPORATE_CITY_STATE) {
    record(city.owner, 'i', city, from);
    return;
  }
  record(city.owner, 'c', city, from);
  if (Players.get(from)?.isMajor) record(from, 'l', city, city.owner);
}

function onRemoved(data) {
  const city = data?.cityID && Cities.get(data.cityID);
  if (city) settlements.delete(plotOf(city));
}

const allSettlements = () => Players.getAlive().flatMap((player) => player.Cities?.getCities?.() ?? []);

/** Towns that became cities since last seen are upgraded by their owner (a city becoming a town is only noted). */
function checkUpgrades() {
  for (const city of allSettlements()) {
    const last = settlements.get(plotOf(city));
    if (last?.owner === city.owner && last.town && !city.isTown) record(city.owner, 'u', city);
    if (last) note(city);
  }
}

onObserverReady(() => {
  try { allSettlements().forEach(note); } catch (e) { log(`settlements not seeded: ${e}`); }
  engine.on('CityInitialized', onInitialized);
  engine.on('CityTransfered', onTransfered);
  engine.on('CityRemovedFromMap', onRemoved);
  engine.on('CityGovernmentLevelChanged', (data) => { showPayload('CityGovernmentLevelChanged', data); checkUpgrades(); });
  engine.on('TurnBegin', checkUpgrades);
});

export { SETTLEMENT_CATEGORIES, SETTLEMENT_KINDS, SETTLEMENT_LOG_EVENT, settlementLog };
