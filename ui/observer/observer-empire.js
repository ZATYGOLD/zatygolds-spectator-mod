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
 * Zatygold's Spectator - Observer empire record (in-game scope).
 *
 * At the start of every turn, and soon after a settlement grows, builds or
 * changes hands, each watched leader's settlements and population:
 *  - the details (cities, towns, urban and rural population, specialists) go
 *    into the current Age's breakdown, replaced each time, for the cards;
 *  - each settlement's growth since the last record goes into the population
 *    log, an event log (observer-event-log.js) with the fields
 *    "<code>,<type>,<how>" (POPULATION_KINDS: u urban, r rural, s
 *    specialist; how produced or purchased), one entry per citizen. A
 *    settlement new to its owner counts from its current population
 *    (captured) or from none (founded); the first record of a game only notes
 *    where each settlement stands.
 *
 * Each urban citizen is put to a building the settlement completed this turn
 * (produced or purchased, the latest first, each building once), each rural
 * one to an improvement made on its land and each specialist to the
 * buildings of the tile it was placed on ("<type>+<type>"); a building that
 * adds no citizen (an overbuild) is not counted, and a citizen without one
 * keeps no type.
 *
 * Breakdown text, one per Age: "<playerId>:<key>=<count>,...;...".
 * Settlement text: "<plot>:<owner>:<urban>:<rural>:<specialists>;...".
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { canSave, isObserverSeat, onObserverReady, readSaved, watchedPlayers, writeSaved } from './observer-core.js';
import { createEventLog } from './observer-event-log.js';

const log = createLogger('observer-empire', CONFIG.debug);
const DETAILS_PREFIX = 'ZOM_EMPIRE_DETAILS_';
const SETTLEMENTS_KEY = 'ZOM_EMPIRE_SETTLEMENTS';
const EMPIRE_EVENT = 'zom-empire-changed';

/** Kinds of citizens, as the city details show them: dot (and specialist pin) colour, glow, icon. */
const POPULATION_KINDS = [
  { id: 'urban', code: 'u', label: 'LOC_ATTR_URBAN_POPULATION', color: '#f0c040', icon: 'url(blp:fi_city_urban_64)', of: (city) => city.urbanPopulation },
  { id: 'rural', code: 'r', label: 'LOC_ATTR_RURAL_POPULATION', color: '#c9ccd6', icon: 'url(blp:fi_city_rural_64)', of: (city) => city.ruralPopulation },
  { id: 'specialist', code: 's', label: 'LOC_PLOT_TOOLTIP_SPECIALISTS', color: '#e3b341', glow: 'rgba(255, 200, 50, 0.85)', icon: 'url(blp:fi_specialist_64)', of: (city) => city.Workers?.getNumWorkers?.(false) }
];
const KIND_OF_CODE = new Map(POPULATION_KINDS.map((k, i) => [k.code, i]));
const [URBAN, RURAL] = [0, 1];
const PURCHASE_MS = 1000;   // a purchased building's own production event, if any

/** Breakdown keys: a leader's cities and towns, and each kind of citizen. */
const EMPIRE_KEYS = {
  cities: 'cities',
  towns: 'towns',
  ...Object.fromEntries(POPULATION_KINDS.map((k) => [k.id, k.id]))
};

const citizens = (city) => POPULATION_KINDS.map((k) => Number(k.of(city)) || 0);

// ============================ Breakdown ============================

const add = (map, key, count = 1) => map.set(key, (map.get(key) ?? 0) + count);

/** A leader's settlements and citizens now: Map<EMPIRE_KEYS value, count>. */
function liveDetails(player) {
  const own = new Map(Object.values(EMPIRE_KEYS).map((key) => [key, 0]));
  for (const city of player?.Cities?.getCities?.() ?? []) {
    add(own, city.isTown ? EMPIRE_KEYS.towns : EMPIRE_KEYS.cities);
    citizens(city).forEach((count, i) => add(own, POPULATION_KINDS[i].id, count));
  }
  return own;
}

const encodeDetails = (byPlayer) => [...byPlayer].map(([id, own]) => `${id}:${[...own].map(([k, n]) => `${k}=${n}`).join(',')}`).join(';');

function decodeDetails(text) {
  const byPlayer = new Map();
  for (const entry of (text ?? '').split(';')) {
    const [id, list] = entry.split(':');
    if (list === undefined) continue;
    byPlayer.set(Number(id), new Map(list.split(',').filter(Boolean).map((pair) => { const [k, n] = pair.split('='); return [k, Number(n) || 0]; })));
  }
  return byPlayer;
}

const breakdowns = new Map();   // age chronology -> Map<playerId, Map<key, count>>

function ageDetails(age) {
  if (!breakdowns.has(age) && canSave()) {
    try { breakdowns.set(age, decodeDetails(readSaved(DETAILS_PREFIX + age))); } catch (e) { log(`breakdown read failed: ${e}`); }
  }
  return breakdowns.get(age) ?? new Map();
}

/** A leader's details at the end of an Age, as they are now in the current one. */
function leaderDetails(playerId, age) {
  if (age === currentAgeChronology()) {
    try { return liveDetails(Players.get(playerId)); } catch (e) { /* the saved details below */ }
  }
  return ageDetails(age).get(playerId) ?? new Map();
}

// ============================ Population log

const events = createEventLog({ keyPrefix: 'ZOM_GROWTH_EVENTS_', fieldCount: 3, changeEvent: EMPIRE_EVENT, log });

/** Every logged citizen: [{ age, turn, progress, playerId, kind, category, type, how, count }] (type '' when unknown). */
function populationLog() {
  return events.read().flatMap(({ fields: [code, type, how], ...entry }) => {
    const category = KIND_OF_CODE.get(code);
    return category == null ? [] : [{ ...entry, kind: 'population', category, type, how }];
  });
}

const plotOf = (location) => GameplayMap.getIndexFromLocation(location);

// Constructions during the turn, by settlement plot: Map<plot, [[{ type, how, at }], [{ type }]]> (urban, rural)
const made = new Map();

function remember(plot, kind, entry) {
  const lists = made.get(plot) ?? [[], []];
  lists[kind].push(entry);
  made.set(plot, lists);
}

const isBuilding = (def) => def?.ConstructibleClass === 'BUILDING' && !def.DistrictDefense;

/** A building completed in a settlement, produced or purchased (a purchase's own production event is skipped). */
function onBuilding(cityID, type, how) {
  const def = GameInfo.Constructibles.lookup(type);
  const city = cityID && Cities.get(cityID);
  if (!isBuilding(def) || !city) return;
  const plot = plotOf(city.location);
  const now = Date.now();
  const urban = made.get(plot)?.[URBAN] ?? [];
  if (how === 'produced' && urban.some((b) => b.type === def.ConstructibleType && b.how === 'purchased' && now - b.at < PURCHASE_MS)) return;
  remember(plot, URBAN, { type: def.ConstructibleType, how, at: now });
}

/** An improvement made on a settlement's land. */
function onConstructible(data) {
  const def = GameInfo.Constructibles.lookup(data?.constructibleType);
  if (def?.ConstructibleClass !== 'IMPROVEMENT' || !data.location) return;
  const city = Cities.get(GameplayMap.getOwningCityFromXY(data.location.x, data.location.y));
  if (city) remember(plotOf(city.location), RURAL, { type: def.ConstructibleType });
}

const tileWorkers = new Map();   // settlement plot -> Map<tile plot, specialists>, at the last record (this session)

const placements = (city) => new Map((city.Workers?.GetAllPlacementInfo?.() ?? []).map((info) => [info.PlotIndex, info.NumWorkers ?? 0]));

/** The buildings on a tile: "<type>+<type>". */
function buildingsAt(tile) {
  const { x, y } = GameplayMap.getLocationFromIndex(tile);
  return (MapConstructibles.getConstructibles(x, y) ?? []).map((id) => GameInfo.Constructibles.lookup(Constructibles.getByComponentID(id)?.type))
    .filter(isBuilding).map((def) => def.ConstructibleType).join('+');
}

/** The leader's settlements with specialists now: [{ name, tiles: [{ buildings ("<type>+<type>"), count }] }], most first. */
function specialistTiles(playerId) {
  const settlements = [];
  for (const city of Players.get(playerId)?.Cities?.getCities?.() ?? []) {
    const tiles = [...placements(city)].filter(([, count]) => count > 0).map(([tile, count]) => ({ buildings: buildingsAt(tile), count }));
    if (tiles.length) settlements.push({ name: Locale.compose(city.name), tiles: tiles.sort((a, b) => b.count - a.count) });
  }
  const total = (s) => s.tiles.reduce((sum, t) => sum + t.count, 0);
  return settlements.sort((a, b) => total(b) - total(a));
}

/** Each specialist placed in a settlement since the last record: [{ type }] (the tile's buildings). */
function newSpecialists(plot, city) {
  const now = placements(city);
  const last = tileWorkers.get(plot);
  tileWorkers.set(plot, now);
  if (!last) return [];
  return [...now].flatMap(([tile, count]) => Array.from({ length: Math.max(0, count - (last.get(tile) ?? 0)) }, () => ({ type: buildingsAt(tile) })));
}

let known = null;   // Map<plot, { owner, citizens }>: every settlement at the last record, null before the first

function knownSettlements() {
  if (known) return known;
  const text = readSaved(SETTLEMENTS_KEY);
  if (typeof text !== 'string') return null;
  known = new Map();
  try {
    for (const entry of text.split(';')) {
      const [plot, owner, ...counts] = entry.split(':');
      if (counts.length === POPULATION_KINDS.length) known.set(Number(plot), { owner: Number(owner), citizens: counts.map(Number) });
    }
  } catch (e) { log(`settlements read failed: ${e}`); }
  return known;
}

const encodeSettlements = (all) => [...all].map(([plot, s]) => [plot, s.owner, ...s.citizens].join(':')).join(';');

/** `count` citizens of a kind for a leader: each put to (and taking) the latest construction of its kind, then untyped. */
function recordCitizens(playerId, kind, count, constructions = []) {
  const typed = constructions.splice(Math.max(0, constructions.length - count));
  for (const c of typed) events.record(playerId, [POPULATION_KINDS[kind].code, c.type, c.how ?? '']);
  events.record(playerId, [POPULATION_KINDS[kind].code, '', ''], count - typed.length);
}

/** Each watched leader's settlements' growth since the last record, by kind of citizen (every settlement is kept). */
function recordGrowth(watched) {
  const before = knownSettlements();
  const ids = new Set(watched.map((player) => player.id));
  const now = new Map();
  for (const player of Players.getAlive()) {
    for (const city of player.Cities?.getCities?.() ?? []) {
      const plot = plotOf(city.location);
      const counts = citizens(city);
      const specialists = newSpecialists(plot, city);
      now.set(plot, { owner: player.id, citizens: counts });
      if (!before || !ids.has(player.id)) continue;
      const last = before.get(plot);
      const from = !last ? counts.map(() => 0) : last.owner === player.id ? last.citizens : counts;
      const typed = [made.get(plot)?.[URBAN], made.get(plot)?.[RURAL], specialists];
      counts.forEach((count, i) => { if (count > from[i]) recordCitizens(player.id, i, count - from[i], typed[i]); });
    }
  }
  known = now;
  writeSaved(SETTLEMENTS_KEY, encodeSettlements(now));
}

// ============================ Recording ============================

/** The details and growth now (a new turn drops constructions that added no citizen); the screen refreshes on EMPIRE_EVENT. */
function recordEmpire(newTurn = false) {
  if (!isObserverSeat() || !canSave()) return;
  const players = watchedPlayers();
  const age = currentAgeChronology();
  try {
    const details = new Map(players.map((player) => [player.id, liveDetails(player)]));
    breakdowns.set(age, details);
    writeSaved(DETAILS_PREFIX + age, encodeDetails(details));
    recordGrowth(players);
    if (newTurn) made.clear();
  } catch (e) { log(`empire record failed: ${e}`); }
  window.dispatchEvent(new CustomEvent(EMPIRE_EVENT));
}

let recordTimer = 0;
let turnPending = false;
/** A record shortly after a change (later changes in the meantime join it). */
function scheduleRecord(newTurn = false) {
  turnPending ||= newTurn;
  if (recordTimer) return;
  recordTimer = setTimeout(() => {
    recordTimer = 0;
    const turn = turnPending;
    turnPending = false;
    recordEmpire(turn);
  }, CONFIG.historyRecordDelayMs);
}

/** Runs `handle(data)` and schedules a record. */
const recording = (handle) => (data) => { handle(data); scheduleRecord(); };

onObserverReady(() => {
  engine.on('TurnBegin', () => scheduleRecord(true));
  for (const name of ['CityPopulationChanged', 'CityInitialized', 'CityTransfered', 'CityRemovedFromMap']) engine.on(name, () => scheduleRecord());
  engine.on('CityProductionCompleted', recording((data) => { if (data?.productionKind === ProductionKind.CONSTRUCTIBLE) onBuilding(data.cityID, data.productionItem, 'produced'); }));
  engine.on('CityMadePurchase', recording((data) => { if (data?.purchaseType === ProductionKind.CONSTRUCTIBLE) onBuilding(data.cityID, data.constructibleType, 'purchased'); }));
  engine.on('ConstructibleAddedToMap', recording(onConstructible));
  scheduleRecord(true);
});

export { EMPIRE_EVENT, EMPIRE_KEYS, leaderDetails, POPULATION_KINDS, populationLog, specialistTiles };
