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
 * Records, per leader, Age, turn and Age progress, each conflict with
 * another player - an engagement (the attacks and pillaging between the same
 * two sides within ENGAGEMENT_RANGE of anywhere it has been fought, going on
 * while they fight on with no pause longer than CONFLICT_GAP turns), a siege
 * of a settlement, a settlement captured or lost, a settlement razed (once gone from the map,
 * also for the player it was taken from) and a tile pillaged by the leader or
 * on its land - with the other player involved (a besieger the enemy around
 * it or lately striking it, a pillager an enemy unit ordered to pillage it;
 * other damage, such as a flood's, is not counted).
 * An attack counts only between sides that can fight (not on a settler or
 * scout), for both sides; an engagement is one once both have attacked each
 * other. It is a skirmish, and a battle (BATTLE) with enough attacks or
 * pillage (a building PILLAGE.building, a rural tile PILLAGE.rural) on its
 * first turn; a skirmish becomes one with enough of either once it has gone
 * on for BATTLE.escalation turns, or after fighting on BATTLE.turns turns, or
 * with a siege between the two sides while it goes on; a skirmish that
 * becomes a battle on a later turn reads as both, the skirmish not counted
 * again. A settlement besieged again by the same enemy within CONFLICT_GAP
 * turns is the same siege. Each event is linked to the one it follows from
 * (see chain).
 * Settlements are checked when a district takes damage, when a settlement
 * changes hands or leaves the map and at the start of every turn. The log is
 * an event log (observer-event-log.js) with the fields
 * "<code>,<type>,<otherPlayerId>" (CODES; engagements ENGAGEMENT_CODES, their
 * type the plot it began on, their count the attacks or pillage; else the
 * type a settlement's name or a constructible).
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { createEventLog, payloadLogger } from './observer-event-log.js';
import { cityAt } from './observer-settlement-info.js';
import { areEnemies, typeOfUnit } from './observer-unit-log.js';

const log = createLogger('observer-battle-log', CONFIG.debug);
const showPayload = payloadLogger(log);
const BATTLE_LOG_EVENT = 'zom-battle-log-changed';
const ENGAGEMENT_RANGE = 3;   // tiles from anywhere an engagement was fought
const BATTLE = { attacks: 3, pillage: 4, escalation: 3, turns: 5 };   // a battle: attacks or pillage on its first turn or from its escalation turn on, or turns of fighting
const PILLAGE = { building: 2, rural: 1 };             // an engagement's pillage per tile
const CONFLICT_GAP = 5;   // turns within which fighting or a siege taken up again between the same sides is the same one

/**
 * What happened, by priority (a pin shows the first it holds): pin and dot
 * colour; `counted` toward the Total, else `outcome` (what a conflict led to).
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
const CATEGORY = Object.fromEntries(BATTLE_CATEGORIES.map((c, i) => [c.id, i]));
/**
 * Each code's category, and whether the type is a settlement (engagements:
 * ENGAGEMENT_CODES). An attack is A (made) or D (taken); pillage is X, R and P; the x, r and p logged before
 * pillage was told from other damage are not read. A siege is S (besieged)
 * or B (besieging); s, logged before, has no side. A settlement is C
 * (captured) or L (lost) when it changes hands, and Y (razed it) or W (its
 * settlement razed) once gone; z and Z, logged when a razing began, are not read.
 */
const CODES = {
  s: { category: CATEGORY.siege, settlement: true },
  S: { category: CATEGORY.siege, settlement: true, side: 'besieged' },
  B: { category: CATEGORY.siege, settlement: true, side: 'besieging' },
  X: { category: CATEGORY.pillaged },
  R: { category: CATEGORY.raided },
  C: { category: CATEGORY.captured, settlement: true, side: 'taking' },
  L: { category: CATEGORY.lost, settlement: true, side: 'taken' },
  Y: { category: CATEGORY.razed, settlement: true, side: 'razing' },
  W: { category: CATEGORY.razed, settlement: true, side: 'razed' }
};
const ENGAGEMENT_CODES = {   // what each adds and who struck: the leader (self), the other side, or (e, logged before) either
  e: { measure: 'attacks', by: ['self', 'other'] },
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
  const entries = [...events.read()].sort((a, b) => a.age - b.age || a.turn - b.turn);
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

const before = (a, b) => a.age - b.age || a.turn - b.turn;
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
  all.sort(before).forEach((e, i) => { e.id = `${e.playerId}:${i}`; });
  const latest = (e, match) => all.filter((p) => p !== e && p.playerId === e.playerId && before(p, e) <= 0 && match(p)).pop();
  const fighting = (e) => (p) => ENGAGED.includes(p.category) && p.other === e.other && p.age === e.age && p.lastTurn >= e.turn - CONFLICT_GAP;
  const at = (e, categories) => (p) => p.settlement && p.type === e.type && categories.includes(p.category);
  const besieging = (e) => (p) => p.category === CATEGORY.siege && p.other === e.other && p.age === e.age && p.lastTurn + 1 >= e.turn;
  for (const e of all) {
    const from = e.category === CATEGORY.battle && e.link ? latest(e, (p) => p.link === e.link && p.category === CATEGORY.escalated)
      : ENGAGED.includes(e.category) ? latest(e, besieging(e))
        : e.category === CATEGORY.siege ? latest(e, (p) => fighting(e)(p) && before(p, e) < 0)   // begun before it (else it follows the siege)
          : HANDS.includes(e.category) ? latest(e, at(e, [CATEGORY.siege])) ?? latest(e, fighting(e))
            : e.category === CATEGORY.razed ? latest(e, at(e, HANDS)) ?? latest(e, at(e, [CATEGORY.siege])) : null;
    if (from) e.after = from.id;
  }
  return all;
}

/**
 * Engagement entries (attacks and pillage) of the same two sides joined into
 * one engagement while they go on, within CONFLICT_GAP turns of its last, and
 * within ENGAGEMENT_RANGE of any tile the engagement has been fought from
 * (whichever tile each was logged at): [{ key, playerId, other, steps: [entry + attacks, pillage, by] }].
 * Only fighting out of range of it, or after a longer pause, is another.
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
 * An engagement's events, each with its tally, once both sides have attacked
 * each other (one-sided fighting is none): a battle where it became one (a
 * skirmish before it, on an earlier turn, linked to it, with the tally until
 * then), else a skirmish. A siege between the two sides while it goes on (or
 * the turn after) makes it a battle then.
 */
function engagementEvents({ key, playerId, other, steps }, sieges) {
  const lastTurn = steps[steps.length - 1].turn;
  const event = (step, category, upTo) => ({ age: step.age, turn: step.turn, progress: step.progress, playerId, kind: 'battles', category, settlement: false, type: String(other), other, ...tally(upTo), lastTurn, until: upTo[upTo.length - 1], count: 1 });
  const start = mutualStep(steps);
  if (start < 0) return [];
  const skirmish = steps[start];
  for (let i = start; i < steps.length; i++) {
    const sofar = tally(steps.slice(0, i + 1));
    const step = steps[i];
    const firstTurn = step.turn === steps[0].turn;
    const enough = sofar.attacks >= BATTLE.attacks || sofar.pillage >= BATTLE.pillage;
    const besieged = sieges.some((s) => s.playerId === playerId && s.other === other && s.age === step.age && s.turn <= step.turn + 1 && s.lastTurn + 1 >= steps[0].turn);
    if (!besieged && !(enough && (firstTurn || sofar.turns >= BATTLE.escalation)) && sofar.fought < BATTLE.turns) continue;
    if (skirmish.turn >= step.turn) return [event(skirmish, CATEGORY.battle, steps)];
    const link = `e:${key}:${skirmish.age}:${skirmish.turn}`;
    const before = steps.filter((s) => s.turn < step.turn);
    return [{ ...event(skirmish, CATEGORY.escalated, before), link }, { ...event(step, CATEGORY.battle, steps), link }];
  }
  return [event(skirmish, CATEGORY.skirmish, steps)];
}

/** A field without the log's separators (a settlement may carry a player's own name). */
const field = (text) => String(text ?? '').replace(/[,;|]/g, ' ');
const record = (playerId, code, type, other = -1, count = 1) => { if (Players.get(playerId)?.isMajor) events.record(playerId, [code, field(type), other ?? -1], count); };

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

// ============================ Sieges and razing ============================

const besieged = new Set();   // settlement plots under siege
const held = new Map();       // settlement plot -> { owner, name, from (who it was taken from, else null) }, as last checked

/** A settlement newly in `set` by `now`: noted, and recorded unless only seeding. */
function newly(set, plot, now, seed) {
  const fresh = now && !set.has(plot);
  if (now) set.add(plot);
  else set.delete(plot);
  return fresh && !seed;
}

const SIEGE_REACH = 2;   // tiles from a settlement its besiegers stand within (ranged units included)

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

/**
 * Settlements newly under siege (for both sides; the first check, on load,
 * only notes them), and those gone from the map razed.
 */
function checkSettlements(seed = false) {
  for (const player of Players.getAlive()) {
    const districts = Players.Districts.get(player.id);
    for (const city of player.Cities?.getCities?.() ?? []) {
      const plot = GameplayMap.getIndexFromLocation(city.location);
      if (newly(besieged, plot, !!districts?.getDistrictIsBesieged?.(city.location), seed)) {
        const besieger = besiegerOf(city.location, player.id);
        record(player.id, 'S', city.name, besieger);
        record(besieger, 'B', city.name, player.id);
      }
      note(plot, city);
    }
  }
  for (const [plot, last] of held) {
    if (cityAt(plot)) continue;
    held.delete(plot);
    besieged.delete(plot);
    if (!seed) razed(last);
  }
}

/** A settlement noted as it is now, keeping who it was taken from while its owner is the same. */
function note(plot, city) {
  const last = held.get(plot);
  const from = last?.owner === city.owner ? last.from : (last?.owner ?? (city.originalOwner !== city.owner ? city.originalOwner : null));
  held.set(plot, { owner: city.owner, name: city.name, from });
}

/** A settlement gone: razed by its last owner, for it and for the player it was taken from. */
function razed({ owner, name, from }) {
  if (from == null) return;
  record(owner, 'Y', name, from);
  record(from, 'W', name, owner);
}

/** The plot of a settlement a player just lost: one of its own no longer held by it. */
function plotLostBy(owner) {
  return [...held].find(([plot, last]) => last.owner === owner && cityAt(plot)?.owner !== owner)?.[0];
}

/**
 * A settlement changing hands (fromPlayer to the new owner): captured by the
 * new owner and lost by the last (not when a city-state is incorporated),
 * noted even when it is gone at once; then every settlement checked.
 */
function onTransfered(data) {
  const from = data?.fromPlayer;
  const to = data?.cityID?.owner;
  const city = data?.cityID && Cities.get(data.cityID);
  const plot = city ? GameplayMap.getIndexFromLocation(city.location) : plotLostBy(from);
  const name = (plot != null ? held.get(plot)?.name : null) ?? city?.name;
  if (name && from != null && to != null && from !== to) {
    if (plot != null) held.set(plot, { owner: to, name, from });
    if (data.transferType !== CityTransferTypes.BY_INCORPORATE_CITY_STATE) {
      record(to, 'C', name, from);
      record(from, 'L', name, to);
    }
  }
  setTimeout(checkSettlements, 0);   // once the map has settled
}

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
  try { checkSettlements(true); } catch (e) { log(`settlements not checked: ${e}`); }
  engine.on('Combat', onCombat);
  engine.on('ConstructibleChanged', onConstructibleChanged);
  engine.on('UnitOperationStarted', onOperationStarted);
  engine.on('DistrictDamageChanged', (data) => { showPayload('DistrictDamageChanged', data); checkSettlements(); });
  engine.on('CityTransfered', onTransfered);
  engine.on('TurnBegin', () => checkSettlements());
  engine.on('CityRemovedFromMap', () => setTimeout(checkSettlements, 0));
});

export { BATTLE_CATEGORIES, BATTLE_LOG_EVENT, battleLog };
