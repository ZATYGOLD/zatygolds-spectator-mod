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
 * Zatygold's Spectator - Observer unit log (in-game scope).
 *
 * Records, per leader, Age, turn and Age progress, the units each leader
 * defeated (killed in combat or captured), lost the same way, and trained,
 * by unit type, with the other player involved (the defeated unit's owner,
 * or who defeated it) or how the unit was trained (TRAIN_METHODS).
 *
 * Commanders are counted as they appear on and leave the map: they are often
 * granted rather than produced, and a defeated commander leaves the map to
 * respawn rather than being killed. Who defeated it comes from the kill event,
 * else its last combat, else an enemy on its plot. A commander away to
 * respawn is remembered (saved with the game), so its return is not counted
 * as trained.
 *
 * Each type falls in one of UNIT_CATEGORIES by its formation class. A unit's
 * type is cached while it is on the map, as a killed unit may already be gone
 * when the event arrives. The log is an event log (observer-event-log.js)
 * with the fields "<code>,<UnitType>,<otherPlayerId>" (CODES: d defeated,
 * l lost, t produced, p purchased, g granted).
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { canSave, onObserverReady, readSaved, writeSaved } from './observer-core.js';
import { createEventLog } from './observer-event-log.js';

const log = createLogger('observer-unit-log', CONFIG.debug);
const KEY_PREFIX = 'ZOM_UNIT_EVENTS_';
const AWAY_KEY = 'ZOM_COMMANDERS_AWAY';
const UNIT_LOG_EVENT = 'zom-unit-log-changed';
const COMMANDER_REMOVAL_MS = 500;   // a combat event for the same commander wins over its removal
const CITY_UNIT_MS = 500;           // a commander's production or purchase event, either side of its arrival

/** Unit categories in display order: pin and dot colour, and a glow for commanders. */
const UNIT_CATEGORIES = [
  { id: 'land', label: 'LOC_PEDIA_PAGEGROUP_LAND_COMBAT_UNITS_NAME', color: '#5fae4c' },
  { id: 'naval', label: 'LOC_PEDIA_PAGEGROUP_NAVAL_COMBAT_UNITS_NAME', color: '#4f8fd8' },
  { id: 'civilian', label: 'LOC_PEDIA_PAGEGROUP_CIVILIAN_UNITS_NAME', color: '#ecd94a' },
  { id: 'commander', label: 'LOC_ZOM_GRAPH_COMMANDERS', color: '#d9a21e', glow: 'rgba(255, 200, 50, 0.85)' }
];
const COMMANDER = UNIT_CATEGORIES.findIndex((c) => c.id === 'commander');

/** The logged event kinds (a tab each); lowFirst ranks the fewest first. */
const UNIT_LOGS = [
  { id: 'trained', label: 'LOC_ZOM_GRAPH_UNITS_TRAINED', description: 'LOC_ZOM_GRAPH_UNITS_TRAINED_DESC' },
  { id: 'lost', label: 'LOC_ZOM_GRAPH_UNITS_LOST', description: 'LOC_ZOM_GRAPH_UNITS_LOST_DESC', lowFirst: true },
  { id: 'defeated', label: 'LOC_ZOM_GRAPH_UNITS_DEFEATED', description: 'LOC_ZOM_GRAPH_UNITS_DEFEATED_DESC' }
];

/** How a unit was trained (shown in the pin tooltips). */
const TRAIN_METHODS = [
  { id: 'produced', label: 'LOC_ZOM_GRAPH_PRODUCED' },
  { id: 'purchased', label: 'LOC_ZOM_GRAPH_PURCHASED' },
  { id: 'granted', label: 'LOC_ZOM_GRAPH_GRANTED' }
];

/** The saved letter of each kind and training method. */
const CODES = {
  d: { kind: 'defeated', how: null },
  l: { kind: 'lost', how: null },
  t: { kind: 'trained', how: 'produced' },
  p: { kind: 'trained', how: 'purchased' },
  g: { kind: 'trained', how: 'granted' }
};
const codeOf = (kind, how) => Object.keys(CODES).find((c) => CODES[c].kind === kind && CODES[c].how === how);

/** Category index per formation class; air units count as land combat. */
const FORMATION_CATEGORY = {
  FORMATION_CLASS_LAND_COMBAT: 0,
  FORMATION_CLASS_AIR: 0,
  FORMATION_CLASS_NAVAL: 1,
  FORMATION_CLASS_CIVILIAN: 2,
  FORMATION_CLASS_SUPPORT: 2,
  FORMATION_CLASS_COMMAND: COMMANDER
};

function unitCategory(unitType) {
  const def = GameInfo.Units.lookup(unitType);
  return def ? (FORMATION_CATEGORY[def.FormationClass] ?? (def.Domain === 'DOMAIN_SEA' ? 1 : 0)) : null;
}

const typeName = (type) => GameInfo.Units.lookup(type)?.UnitType ?? null;
const isCommander = (type) => unitCategory(type) === COMMANDER;

// ============================ Storage ============================

const events = createEventLog({ keyPrefix: KEY_PREFIX, fieldCount: 3, changeEvent: UNIT_LOG_EVENT, log });

/** Every logged event: [{ age, turn, progress, playerId, kind, how, type, other, category, count }]. */
function unitLog() {
  return events.read().flatMap(({ fields: [code, type, other], ...entry }) => {
    const category = unitCategory(type);
    return category == null || !CODES[code] ? [] : [{ ...entry, ...CODES[code], type, other: Number(other), category }];
  });
}

let away = null;   // Map<"owner:id", UnitType>: commanders away to respawn, this Age

function awayCommanders() {
  if (away) return away;
  if (!canSave()) return new Map();
  away = new Map();
  try {
    for (const entry of String(readSaved(AWAY_KEY) ?? '').split(';')) {
      const [age, owner, id, type] = entry.split(':');
      if (type && Number(age) === currentAgeChronology()) away.set(`${owner}:${id}`, type);
    }
  } catch (e) { log(`away commanders read failed: ${e}`); }
  return away;
}

function saveAway() {
  const age = currentAgeChronology();
  try { writeSaved(AWAY_KEY, [...awayCommanders()].map(([key, type]) => `${age}:${key}:${type}`).join(';')); } catch (e) { log(`away commanders write failed: ${e}`); }
}

// ============================ Recording ============================

function record(playerId, kind, unitType, { other = -1, how = null } = {}) {
  if (unitType) events.record(playerId, [codeOf(kind, how), unitType, other ?? -1]);
}

const unitTypes = new Map();      // "owner:id" -> UnitType, for units on the map
const knownUnits = new Set();     // every unit seen this session, so a returning unit is not new
const defeatedUnits = new Set();  // commanders already counted by a combat event
const lastCombat = new Map();     // commander "owner:id" -> { by: opponent, turn }
const cityUnits = new Map();      // "owner:UnitType" -> { how, at }: a commander's production or purchase
const unitKey = (id) => `${id.owner}:${id.id}`;

function remember(id) {
  const unit = id && Units.get(id);
  const type = unit && typeName(unit.type);
  if (type) unitTypes.set(unitKey(id), type);
  if (id) knownUnits.add(unitKey(id));
}

function typeOfUnit(id) {
  const unit = Units.get(id);
  return (unit && typeName(unit.type)) ?? unitTypes.get(unitKey(id)) ?? null;
}

function sendAway(id, type) {
  awayCommanders().set(unitKey(id), type);
  saveAway();
}

/** A commander coming back from respawn: the same unit, or (for a new unit) one of its owner's away of that type. */
function returning(id, type, isNew) {
  const all = awayCommanders();
  let key = all.has(unitKey(id)) ? unitKey(id) : null;
  if (!key && isNew) key = [...all].find(([k, t]) => t === type && k.startsWith(`${id.owner}:`))?.[0];
  if (!key) return false;
  all.delete(key);
  saveAway();
  return true;
}

/** A unit removed by another player: defeated by that player, lost by its owner. */
function defeated(victim, winner, type = typeOfUnit(victim)) {
  if (!victim) return;
  if (isCommander(type)) {
    defeatedUnits.add(unitKey(victim));
    sendAway(victim, type);
  }
  if (winner === victim.owner) return;
  record(winner, 'defeated', type, { other: victim.owner });
  record(victim.owner, 'lost', type, { other: winner });
}

/** The first payload of each event, to confirm its fields in UI.log. */
const shown = new Set();
function showPayload(name, data) {
  if (shown.has(name)) return;
  shown.add(name);
  try { log(`${name} payload: ${JSON.stringify(data)}`); } catch (e) { /* ignore */ }
}

function onKilled(data) {
  showPayload('UnitKilledInCombat', data);
  const killer = data?.unitKiller ?? data?.killer;
  defeated(data?.unitKilled ?? data?.unit, killer?.owner ?? data?.killerPlayer);
}

function onCaptured(data) {
  showPayload('UnitCaptured', data);
  defeated(data?.unit, data?.capturingPlayer);
}

/** Each commander's last opponent, for a commander that leaves the map without a kill event. */
function onCombat(data) {
  showPayload('Combat', data);
  const sides = [data?.attacker, data?.defender ?? data?.target];
  if (sides.some((side) => side?.owner == null)) return;
  sides.forEach((side, i) => {
    if (isCommander(typeOfUnit(side))) lastCombat.set(unitKey(side), { by: sides[1 - i].owner, turn: Game.turn });
  });
}

/** A unit produced or bought in a city is trained by the city's owner; a commander counts on arrival. */
function onCityUnit(name, kind, item, how, data) {
  showPayload(name, data);
  const type = typeName(item);
  const owner = data?.cityID?.owner;
  if (kind !== ProductionKind.UNIT || !type) return;
  if (isCommander(type)) cityUnits.set(`${owner}:${type}`, { how, at: Date.now() });
  else record(owner, 'trained', type, { how });
}

function takeCityUnit(owner, type) {
  const key = `${owner}:${type}`;
  const city = cityUnits.get(key);
  cityUnits.delete(key);
  return city && Date.now() - city.at < CITY_UNIT_MS * 4 ? city.how : null;
}

/** A commander new to the map is trained (produced, purchased or granted), unless it returns from respawn. */
function onAdded(data) {
  const id = data?.unit;
  if (!id) return;
  const isNew = !knownUnits.has(unitKey(id));
  remember(id);
  const type = unitTypes.get(unitKey(id));
  if (!isCommander(type) || returning(id, type, isNew) || !isNew) return;
  setTimeout(() => {
    const how = takeCityUnit(id.owner, type) ?? 'granted';
    log(`commander trained: ${type} of ${id.owner} (${how})`);
    record(id.owner, 'trained', type, { how });
  }, CITY_UNIT_MS);
}

/** Another player's unit on the plot, for a commander defeated without combat. */
function enemyOn(location, owner) {
  if (!location || location.x < 0) return null;
  return (MapUnits.getUnits(location.x, location.y) ?? []).find((id) => id.owner !== owner)?.owner ?? null;
}

/** A commander leaving the map without a kill event: defeated by its last opponent, else lost to an unknown one. */
function onRemoved(data) {
  const id = data?.unit;
  const type = id && typeOfUnit(id);
  if (!isCommander(type)) return;
  const key = unitKey(id);
  const location = Units.get(id)?.location;
  setTimeout(() => {
    const combat = lastCombat.get(key);
    lastCombat.delete(key);
    if (defeatedUnits.delete(key) || !Players.get(id.owner)?.isAlive) return;
    const winner = combat && combat.turn >= Game.turn - 1 ? combat.by : enemyOn(location, id.owner);
    log(`commander removed: ${type} of ${id.owner}, defeated by ${winner}`);
    if (winner != null) {
      defeated(id, winner, type);
      defeatedUnits.delete(key);
    } else {
      sendAway(id, type);
      record(id.owner, 'lost', type);
    }
  }, COMMANDER_REMOVAL_MS);
}

function seedTypes() {
  for (const player of Players.getAlive()) {
    for (const unit of player.Units?.getUnits?.() ?? []) remember(unit.id);
  }
}

onObserverReady(() => {
  try { seedTypes(); } catch (e) { log(`unit types not seeded: ${e}`); }
  engine.on('UnitAddedToMap', onAdded);
  engine.on('UnitRemovedFromMap', onRemoved);
  engine.on('Combat', onCombat);
  engine.on('UnitKilledInCombat', onKilled);
  engine.on('UnitCaptured', onCaptured);
  engine.on('CityProductionCompleted', (data) => onCityUnit('CityProductionCompleted', data?.productionKind, data?.productionItem, 'produced', data));
  engine.on('CityMadePurchase', (data) => onCityUnit('CityMadePurchase', data?.purchaseType, data?.unitType, 'purchased', data));
});

export { TRAIN_METHODS, UNIT_CATEGORIES, UNIT_LOG_EVENT, UNIT_LOGS, unitCategory, unitLog };
