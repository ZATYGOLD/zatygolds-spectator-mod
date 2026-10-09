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
 * Zatygold's Spectator - Observer war log (in-game scope).
 *
 * Records, per leader, Age, turn and Age progress, each war declared - by the
 * leader or on it - and each peace made, with the other leader. A war already
 * going when the log first sees it (a game saved before the mod) is noted as
 * ongoing. The log is an event log (observer-event-log.js) with the fields
 * "<code>,<otherPlayerId>" (CODES: d declared, a declared on, o ongoing,
 * D/A declared or declared on in an earlier Age and going on, p peace); a war
 * runs from its declaration (or note) to its peace, across Ages.
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { createEventLog, payloadLogger } from './observer-event-log.js';

const log = createLogger('observer-war-log', CONFIG.debug);
const showPayload = payloadLogger(log);
const WAR_LOG_EVENT = 'zom-war-log-changed';

/**
 * What happened, in display order: pin, dot and (for the start of a war) the
 * notches' colour while it lasts; `against` names the enemy ("Declared On Augustus").
 */
const WAR_CATEGORIES = [
  { id: 'declared', label: 'LOC_ZOM_GRAPH_DECLARED_WAR', against: 'LOC_ZOM_GRAPH_ATTACKING_LEADER', color: '#d9534f' },
  { id: 'declaredOn', label: 'LOC_ZOM_GRAPH_DECLARED_ON', against: 'LOC_ZOM_GRAPH_ATTACKED_BY_LEADER', color: '#e8cf3a' },
  { id: 'ongoing', label: 'LOC_ZOM_GRAPH_AT_WAR', against: 'LOC_ZOM_GRAPH_AT_WAR_WITH', color: '#b0507a' },
  { id: 'peace', label: 'LOC_ZOM_GRAPH_PEACE', against: 'LOC_ZOM_GRAPH_PEACE_WITH', color: '#8fd18f' }
];
const PEACE = 3;

const CODES = { d: 0, a: 1, o: 2, p: PEACE, D: 0, A: 1 };   // D, A: a war declared (by, on) in an earlier Age, going on in this one
const CARRIED = ['D', 'A', 'o'];   // by the war's first category

const events = createEventLog({ keyPrefix: 'ZOM_WAR_LOG_', fieldCount: 2, changeEvent: WAR_LOG_EVENT, log });

/** Every logged event: [{ age, turn, progress, playerId, kind, category, type, other, count }] (type the other leader). */
function warLog() {
  return events.read().flatMap(({ fields: [code, other], ...entry }) => (CODES[code] == null ? []
    : [{ ...entry, kind: 'wars', category: CODES[code], type: other, other: Number(other) }]));
}

const isLeader = (id) => !!Players.get(id)?.isMajor;
const record = (playerId, code, other) => { if (isLeader(playerId) && isLeader(other)) events.record(playerId, [code, other]); };

function onDeclareWar(data) {
  showPayload('DiplomacyDeclareWar', data);
  record(data?.actingPlayer, 'd', data?.reactingPlayer);
  record(data?.reactingPlayer, 'a', data?.actingPlayer);
}

function onMakePeace(data) {
  showPayload('DiplomacyMakePeace', data);
  record(data?.actingPlayer, 'p', data?.reactingPlayer);
  record(data?.reactingPlayer, 'p', data?.actingPlayer);
}

/**
 * On load, the log brought up to date with the leaders' wars: a war it has not
 * seen begin is noted as ongoing, one logged in an earlier Age as going on in
 * this one (as it began), and one it holds open that is over as peace (a new
 * Age may end wars).
 */
function noteOngoing() {
  const open = new Map();   // "player:other" -> { start, lastAge }
  const byTime = (a, b) => a.age - b.age || a.turn - b.turn;
  for (const e of warLog().sort(byTime)) {
    const key = `${e.playerId}:${e.other}`;
    if (e.category === PEACE) open.delete(key);
    else open.set(key, { start: open.get(key)?.start ?? e, lastAge: e.age });
  }
  const age = currentAgeChronology();
  const leaders = Players.getAlive().filter((p) => p.isMajor);
  for (const player of leaders) {
    for (const other of leaders) {
      if (other.id === player.id) continue;
      const war = open.get(`${player.id}:${other.id}`);
      if (!player.Diplomacy?.isAtWarWith(other.id)) {
        if (war) record(player.id, 'p', other.id);
      } else if (!war) record(player.id, 'o', other.id);
      else if (war.lastAge < age) record(player.id, CARRIED[war.start.category] ?? 'o', other.id);
    }
  }
}

onObserverReady(() => {
  try { noteOngoing(); } catch (e) { log(`ongoing wars not noted: ${e}`); }
  engine.on('DiplomacyDeclareWar', onDeclareWar);
  engine.on('DiplomacyMakePeace', onMakePeace);
});

export { PEACE, WAR_CATEGORIES, WAR_LOG_EVENT, warLog };
