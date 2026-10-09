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
 * Zatygold's Spectator - Observer battle log (in-game scope).
 *
 * Records, per leader, each conflict with another player: engagements (attacks
 * and pillage between two sides, see engagementEvents), sieges, settlements
 * captured, lost or razed, and tiles pillaged by an enemy unit or on its land.
 * An event log (observer-event-log.js) with the fields
 * "<code>,<type>,<otherPlayerId>" (CODES, ENGAGEMENT_CODES).
 */
import { createLogger, deferOnce } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { areEnemies, onObserverReady } from './observer-core.js';
import { byTime, categoryIndex, createEventLog, payloadLogger } from './observer-event-log.js';
import { watchSettlements } from './observer-settlement-watch.js';
import { typeOfUnit } from './observer-unit-log.js';

const log = createLogger('observer-battle-log', CONFIG.debug);
const showPayload = payloadLogger(log);
const BATTLE_LOG_EVENT = 'zom-battle-log-changed';
const ENGAGEMENT_RANGE = 3;   // tiles from anywhere an engagement was fought
const CONFLICT_GAP = 5;       // turns within which fighting or a siege taken up again between the same sides is the same one
const BATTLE = { attacks: 3, pillage: 4, escalation: 3, turns: 5 };   // a battle: attacks or pillage on its first turn or from its escalation turn on, or turns fought
const PILLAGE = { building: 2, rural: 1 };   // an engagement's pillage per tile

/**
 * What happened, by priority: pin and dot colour; `counted` toward the Total,
 * else an `outcome` (what a conflict led to).
 */
const BATTLE_CATEGORIES = [
  { id: 'razed', label: 'LOC_ZOM_GRAPH_RAZED', color: '#5b2a86', outcome: true },
  { id: 'captured', label: 'LOC_ZOM_GRAPH_CAPTURED', color: '#4f9d69', outcome: true },
  { id: 'lost', label: 'LOC_ZOM_GRAPH_SETTLEMENTS_LOST', color: '#a33b3b', outcome: true },
  { id: 'siege', label: 'LOC_ZOM_GRAPH_SIEGE', color: '#e0a03a', counted: true },
  { id: 'battle', label: 'LOC_ZOM_GRAPH_BATTLE', color: '#d9534f', counted: true },
  { id: 'skirmish', label: 'LOC_ZOM_GRAPH_SKIRMISH', color: '#5fa8d3', counted: true },
  { id: 'escalated', label: 'LOC_ZOM_GRAPH_SKIRMISH', color: '#5fa8d3' },   // a skirmish that became a battle (counted as that)
  { id: 'pillaged', label: 'LOC_ZOM_GRAPH_PILLAGED', color: '#9b6a3a', counted: true },
  { id: 'raided', label: 'LOC_ZOM_GRAPH_RAIDED', color: '#8a8a94', counted: true }
];
const CATEGORY = categoryIndex(BATTLE_CATEGORIES);

/**
 * Each saved letter of an event with a settlement or constructible as its
 * type: its category and the leader's side. X pillaged, R was pillaged; S
 * besieged, B besieging; C captured, L lost; Y razed it, W its settlement razed.
 */
const CODES = {
  S: { category: CATEGORY.siege, settlement: true, side: 'besieged' },
  B: { category: CATEGORY.siege, settlement: true, side: 'besieging' },
  X: { category: CATEGORY.pillaged },
  R: { category: CATEGORY.raided },
  C: { category: CATEGORY.captured, settlement: true, side: 'taking' },
  L: { category: CATEGORY.lost, settlement: true, side: 'taken' },
  Y: { category: CATEGORY.razed, settlement: true, side: 'razing' },
  W: { category: CATEGORY.razed, settlement: true, side: 'razed' }
};
/** Each saved letter of an engagement step (its type the plot the engagement began on): what it adds, and who struck. */
const ENGAGEMENT_CODES = {
  A: { measure: 'attacks', by: ['self'] },
  D: { measure: 'attacks', by: ['other'] },
  P: { measure: 'pillage', by: [] }
};

const events = createEventLog({ keyPrefix: 'ZOM_CONFLICT_LOG_', fieldCount: 3, changeEvent: BATTLE_LOG_EVENT, log });

/**
 * Every logged event: [{ id, after, age, turn, progress, playerId, kind, category, settlement, side, type, other, attacks, pillage, turns, lastTurn, until, count, link }]
 * (an engagement counts once; `link` pairs a skirmish with the battle it became; `until` is the last step
 * of a skirmish, battle or siege ({ age, turn, progress }); `after` is the id of the event it follows from, see chain).
 */
function battleLog() {
  const entries = events.read().sort(byTime);
  const logged = entries.flatMap(({ fields: [code, type, other], ...entry }) => {
    const known = CODES[code];
    return known ? [{ ...entry, kind: 'battles', category: known.category, settlement: !!known.settlement, side: known.side, type, other: Number(other), attacks: 0, pillage: 0, turns: 0 }] : [];
  });
  const kept = joinSieges(logged);
  const sieges = kept.filter((e) => e.category === CATEGORY.siege && e.other >= 0);
  return chain([...kept, ...joinEngagements(entries).flatMap((engagement) => engagementEvents(engagement, sieges))]);
}

/**
 * Sieges of the same settlement by the same enemy, each within CONFLICT_GAP
 * turns of the last, joined into one (from the first; `lastTurn` and `until`,
 * the latest).
 */
function joinSieges(logged) {
  const open = new Map();   // "player:settlement:other" -> its siege going on
  return logged.filter((e) => {
    if (e.category !== CATEGORY.siege) return true;
    const key = `${e.playerId}:${e.type}:${e.other}`;
    const siege = open.get(key);
    if (siege && siege.age === e.age && e.turn - siege.lastTurn <= CONFLICT_GAP) {
      siege.lastTurn = e.turn;
      siege.until = e;
      return false;
    }
    e.lastTurn = e.turn;
    e.until = e;
    open.set(key, e);
    return true;
  });
}

const ENGAGED = [CATEGORY.battle, CATEGORY.skirmish, CATEGORY.escalated];
const HANDS = [CATEGORY.captured, CATEGORY.lost];

/**
 * Each event linked (`after`) to the one it follows from, for the leader: a
 * battle to the skirmish it became; a siege to the engagement with the
 * besieger going on then; an engagement begun during a siege to the siege; a
 * capture or loss to the siege of that settlement before it (else the
 * engagement going on); a razing to the settlement's capture or loss (else
 * its siege).
 */
function chain(all) {
  all.sort(byTime).forEach((e, i) => { e.id = `${e.playerId}:${i}`; });
  const byPlayer = new Map();
  for (const e of all) {
    if (!byPlayer.has(e.playerId)) byPlayer.set(e.playerId, []);
    byPlayer.get(e.playerId).push(e);
  }
  const fighting = (e) => (p) => ENGAGED.includes(p.category) && p.other === e.other && p.age === e.age && p.lastTurn >= e.turn - CONFLICT_GAP;
  const at = (e, categories) => (p) => p.settlement && p.type === e.type && categories.includes(p.category);
  const besieging = (e) => (p) => p.category === CATEGORY.siege && p.other === e.other && p.age === e.age && p.lastTurn + 1 >= e.turn;
  for (const own of byPlayer.values()) {
    const latest = (e, match) => own.filter((p) => p !== e && byTime(p, e) <= 0 && match(p)).pop();
    for (const e of own) {
      const from = e.category === CATEGORY.battle && e.link ? latest(e, (p) => p.link === e.link && p.category === CATEGORY.escalated)
        : ENGAGED.includes(e.category) ? latest(e, besieging(e))
          : e.category === CATEGORY.siege ? latest(e, (p) => fighting(e)(p) && byTime(p, e) < 0)   // begun before it (else it follows the siege)
            : HANDS.includes(e.category) ? latest(e, at(e, [CATEGORY.siege])) ?? latest(e, fighting(e))
              : e.category === CATEGORY.razed ? latest(e, at(e, HANDS)) ?? latest(e, at(e, [CATEGORY.siege])) : null;
      if (from) e.after = from.id;
    }
  }
  return all;
}

/**
 * Engagement steps (attacks and pillage) of the same two sides joined into
 * one engagement while they go on: within CONFLICT_GAP turns of its last, and
 * within ENGAGEMENT_RANGE of any tile it has been fought at:
 * [{ key, playerId, other, steps: [entry + attacks, pillage, by] }].
 */
function joinEngagements(entries) {
  const open = new Map();   // "player:other" -> its engagements going on
  const joined = [];
  for (const entry of entries) {
    const code = ENGAGEMENT_CODES[entry.fields[0]];
    if (!code) continue;
    const pair = `${entry.playerId}:${entry.fields[2]}`;
    const at = GameplayMap.getLocationFromIndex(Number(entry.fields[1]));
    const going = (open.get(pair) ?? []).filter((e) => e.age === entry.age && entry.turn - e.lastTurn <= CONFLICT_GAP);
    let engagement = going.find((e) => e.tiles.some((t) => GameplayMap.getPlotDistance(t.x, t.y, at.x, at.y) <= ENGAGEMENT_RANGE));
    if (!engagement) {
      engagement = { key: `${pair}:${entry.fields[1]}:${entry.turn}`, playerId: entry.playerId, other: Number(entry.fields[2]), age: entry.age, tiles: [], steps: [] };
      going.push(engagement);
      joined.push(engagement);
    }
    if (!engagement.tiles.some((t) => t.x === at.x && t.y === at.y)) engagement.tiles.push(at);
    engagement.lastTurn = entry.turn;
    engagement.steps.push({ ...entry, attacks: 0, pillage: 0, [code.measure]: entry.count, by: code.by });
    open.set(pair, going);
  }
  return joined;
}

/** An engagement's attacks and pillage over its steps, the turns it has lasted and those it was fought on. */
function tally(steps) {
  return {
    attacks: steps.reduce((sum, s) => sum + s.attacks, 0),
    pillage: steps.reduce((sum, s) => sum + s.pillage, 0),
    turns: steps.length ? steps[steps.length - 1].turn - steps[0].turn + 1 : 0,
    fought: new Set(steps.map((s) => s.turn)).size
  };
}

/** The first step by which both sides have attacked each other; -1 for none. */
function mutualStep(steps) {
  const by = new Set();
  return steps.findIndex((s) => { s.by.forEach((side) => by.add(side)); return by.has('self') && by.has('other'); });
}

/**
 * An engagement's events, once both sides have attacked each other (one-sided
 * fighting is none), each with its tally. It is a battle with BATTLE.attacks
 * attacks or BATTLE.pillage pillage (PILLAGE per tile) on its first turn or
 * once it has lasted BATTLE.escalation turns, once fought on BATTLE.turns
 * turns, or with a siege between the two sides while it goes on (or the turn
 * after); else a skirmish. One that became a battle on a later turn is both:
 * a skirmish (escalated, not counted) until then, linked to the battle.
 */
function engagementEvents({ key, playerId, other, steps }, sieges) {
  const start = mutualStep(steps);
  if (start < 0) return [];
  const firstTurn = steps[0].turn;
  const lastTurn = steps[steps.length - 1].turn;
  const besiegers = sieges.filter((s) => s.playerId === playerId && s.other === other && s.lastTurn + 1 >= firstTurn);
  const event = (step, category, upTo) => ({ age: step.age, turn: step.turn, progress: step.progress, playerId, kind: 'battles', category, settlement: false, type: String(other), other, ...tally(upTo), lastTurn, until: upTo[upTo.length - 1], count: 1 });
  const skirmish = steps[start];
  const sofar = { attacks: 0, pillage: 0, fought: new Set() };
  for (const [i, step] of steps.entries()) {
    sofar.attacks += step.attacks;
    sofar.pillage += step.pillage;
    sofar.fought.add(step.turn);
    if (i < start) continue;
    const enough = sofar.attacks >= BATTLE.attacks || sofar.pillage >= BATTLE.pillage;
    const escalating = step.turn === firstTurn || step.turn - firstTurn + 1 >= BATTLE.escalation;
    const besieged = besiegers.some((s) => s.age === step.age && s.turn <= step.turn + 1);
    if (!besieged && !(enough && escalating) && sofar.fought.size < BATTLE.turns) continue;
    if (skirmish.turn >= step.turn) return [event(skirmish, CATEGORY.battle, steps)];
    const link = `e:${key}:${skirmish.age}:${skirmish.turn}`;
    const earlier = steps.filter((s) => s.turn < step.turn);
    return [{ ...event(skirmish, CATEGORY.escalated, earlier), link }, { ...event(step, CATEGORY.battle, steps), link }];
  }
  return [event(skirmish, CATEGORY.skirmish, steps)];
}

/** An event of a leader (and the other player involved). */
const record = (playerId, code, type, other = -1, count = 1) => { if (Players.get(playerId)?.isMajor) events.record(playerId, [code, type, other], count); };

// ============================ Engagements ============================

const engagements = new Map();   // "sideA:sideB" -> [{ plot, tiles, lastTurn }]: where each engagement began, every tile fought at, and its last turn

const locationOf = (id) => Units.get(id)?.location ?? Districts.get(id)?.location;

/**
 * The engagement of two sides at a location: one going on between them
 * (within CONFLICT_GAP turns) within ENGAGEMENT_RANGE of any tile it was
 * fought at, else a new one there; -1 for none.
 */
function engagementOf(a, b, location) {
  const key = [Math.min(a, b), Math.max(a, b)].join(':');
  const going = (engagements.get(key) ?? []).filter((e) => e.lastTurn >= Game.turn - CONFLICT_GAP);
  engagements.set(key, going);
  const near = location ? going.find((e) => e.tiles.some((t) => GameplayMap.getPlotDistance(t.x, t.y, location.x, location.y) <= ENGAGEMENT_RANGE)) : going[0];
  if (near) {
    near.lastTurn = Game.turn;
    if (location && !near.tiles.some((t) => t.x === location.x && t.y === location.y)) near.tiles.push({ x: location.x, y: location.y });
    return near.plot;
  }
  if (!location) return -1;
  const plot = GameplayMap.getIndexFromLocation(location);
  going.push({ plot, tiles: [{ x: location.x, y: location.y }], lastTurn: Game.turn });
  return plot;
}

/** `weight` more in the engagement of two sides at a location, for each with its code: an attack (A by a, D on b), or pillage (P). */
function engage(a, b, location, [codeA, codeB] = ['A', 'D'], weight = 1) {
  const plot = engagementOf(a, b, location);
  if (plot < 0) return;
  record(a, codeA, plot, b, weight);
  record(b, codeB, plot, a, weight);
}

/**
 * Whether a side can fight: a unit with combat strength (a settler or scout
 * cannot; one no longer in this Age's database is given the benefit), or a
 * settlement's district.
 */
function canFight(id) {
  const type = typeOfUnit(id);
  if (!type || !GameInfo.Units.lookup(type)) return true;
  const stats = GameInfo.Unit_Stats?.lookup(type);
  return (stats?.Combat ?? 0) > 0 || (stats?.RangedCombat ?? 0) > 0;
}

const struck = new Map();   // plot -> { owner, turn }: the last attacker there

/** An attack: the attacker noted where it struck, and one more in its engagement when both sides can fight. */
function onCombat(data) {
  const attacker = data?.attacker;
  const defender = data?.defender ?? data?.target;
  if (attacker?.owner == null || defender?.owner == null || attacker.owner < 0 || defender.owner < 0 || attacker.owner === defender.owner) return;
  const location = locationOf(defender) ?? locationOf(attacker);
  if (location) struck.set(GameplayMap.getIndexFromLocation(location), { owner: attacker.owner, turn: Game.turn });
  if (canFight(attacker) && canFight(defender)) engage(attacker.owner, defender.owner, location);
}

// ============================ Sieges and settlements ============================

const SIEGE_REACH = 2;          // tiles from a settlement its besiegers stand within (ranged units included)
const besieged = new Set();     // settlement plots under siege

/**
 * A settlement's besieger: the enemy with the most units nearest it (within
 * SIEGE_REACH), else the enemy that last struck it or beside it lately; -1 for none.
 */
function besiegerOf(location, owner) {
  const plots = (radius) => (GameplayMap.getPlotIndicesInRadius(location.x, location.y, radius) ?? []);
  for (let radius = 1; radius <= SIEGE_REACH; radius++) {
    const counts = new Map();
    for (const index of plots(radius)) {
      const at = GameplayMap.getLocationFromIndex(index);
      for (const unit of MapUnits.getUnits(at.x, at.y) ?? []) if (areEnemies(unit.owner, owner)) counts.set(unit.owner, (counts.get(unit.owner) ?? 0) + 1);
    }
    if (counts.size) return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }
  const recent = plots(1).map((index) => struck.get(index)).filter((s) => s && s.turn >= Game.turn - 1 && areEnemies(s.owner, owner));
  return recent.sort((a, b) => b.turn - a.turn)[0]?.owner ?? -1;
}

/** Settlements newly under siege, for both sides (the first check, on load, only notes them). */
function checkSieges(seed = false) {
  for (const player of Players.getAlive()) {
    const districts = Players.Districts.get(player.id);
    for (const city of player.Cities?.getCities?.() ?? []) {
      const plot = GameplayMap.getIndexFromLocation(city.location);
      const now = !!districts?.getDistrictIsBesieged?.(city.location);
      if (!now) {
        besieged.delete(plot);
        continue;
      }
      if (besieged.has(plot)) continue;
      besieged.add(plot);
      if (seed) continue;
      const besieger = besiegerOf(city.location, player.id);
      record(player.id, 'S', city.name, besieger);
      record(besieger, 'B', city.name, player.id);
    }
  }
}
const checkSiegesSoon = deferOnce(() => checkSieges());   // district damage comes in bursts

watchSettlements({
  transferred: ({ name }, { from, to, incorporated }) => {   // not when a city-state is incorporated
    if (incorporated) return;
    record(to, 'C', name, from);
    record(from, 'L', name, to);
  },
  razed: ({ plot, owner, name, from }) => {   // by its last owner, if it took it, and for the player it was taken from
    besieged.delete(plot);
    if (from == null) return;
    record(owner, 'Y', name, from);
    record(from, 'W', name, owner);
  }
});

// ============================ Pillage ============================

const damaged = new Set();   // "owner:id" of constructibles seen damaged
const PILLAGE_REACH = 1;     // tiles from its unit a pillage order may target
const PILLAGE_WAIT = 250;    // ms a damage waits for its order, which may be told just after it
let orders = [];             // this turn's pillage orders: [{ owner, location, turn }]

/** A unit ordered to pillage: its owner and where it stands, for this turn. */
function onOperationStarted(data) {
  showPayload('UnitOperationStarted', data);
  const operation = data?.operationType ?? data?.operation;
  if (operation !== Database.makeHash('UNITOPERATION_PILLAGE') && operation !== 'UNITOPERATION_PILLAGE') return;
  const location = data.unit && locationOf(data.unit);
  if (!location) return;
  orders = orders.filter((o) => o.turn === Game.turn);
  orders.push({ owner: data.unit.owner, location, turn: Game.turn });
}

/** The enemy whose pillage order this turn reached a location, nearest first; else null. */
function pillagerOf(location, owner) {
  const reach = orders.filter((o) => o.turn === Game.turn && areEnemies(o.owner, owner))
    .map((o) => ({ owner: o.owner, distance: GameplayMap.getPlotDistance(o.location.x, o.location.y, location.x, location.y) }))
    .filter((o) => o.distance <= PILLAGE_REACH)
    .sort((a, b) => a.distance - b.distance);
  return reach[0]?.owner ?? null;
}

/**
 * A constructible newly damaged: pillaged by an enemy unit ordered to pillage
 * it this turn, raided for its owner; any other damage (a flood, an eruption,
 * a storm) is not counted.
 */
function onConstructibleChanged(data) {
  showPayload('ConstructibleChanged', data);
  const id = data?.constructible ?? data?.constructibleID;
  const constructible = id && Constructibles.getByComponentID(id);
  if (!constructible) return;
  const key = `${id.owner}:${id.id}`;
  if (!constructible.damaged) {
    damaged.delete(key);
    return;
  }
  if (damaged.has(key)) return;
  damaged.add(key);
  const def = GameInfo.Constructibles.lookup(constructible.type);
  const location = data.location ?? constructible.location;
  const owner = constructible.owner ?? id.owner;
  if (location) setTimeout(() => notePillage(def, location, owner), PILLAGE_WAIT);
}

/** A damage pillaged, if an enemy's order this turn reached it: logged for both sides and their engagement. */
function notePillage(def, location, owner) {
  const pillager = pillagerOf(location, owner);
  if (pillager == null) return;
  record(owner, 'R', def?.ConstructibleType, pillager);
  record(pillager, 'X', def?.ConstructibleType, owner);
  engage(pillager, owner, location, ['P', 'P'], def?.ConstructibleClass === 'IMPROVEMENT' ? PILLAGE.rural : PILLAGE.building);
}

onObserverReady(() => {
  try { checkSieges(true); } catch (e) { log(`sieges not checked: ${e}`); }
  engine.on('Combat', onCombat);
  engine.on('ConstructibleChanged', onConstructibleChanged);
  engine.on('UnitOperationStarted', onOperationStarted);
  engine.on('DistrictDamageChanged', (data) => { showPayload('DistrictDamageChanged', data); checkSiegesSoon(); });
  engine.on('CityTransfered', checkSiegesSoon);
  engine.on('TurnBegin', () => checkSieges());
});

export { BATTLE_CATEGORIES, BATTLE_LOG_EVENT, battleLog };
