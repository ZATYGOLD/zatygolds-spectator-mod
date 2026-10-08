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
 * Zatygold's Spectator - Observer histories (in-game scope).
 *
 * A history records, at the start of every turn, a few numbers for each
 * watched leader (createSampleHistory). One sample per turn is kept in the
 * Observer's own player properties - the store the game's UI catalogs use
 * (utility-serialize.js) - which are saved with the game and carried across
 * Age transitions, so the graphs cover the whole game. The yield history
 * records each leader's per-turn yields (HISTORY_YIELDS: gold, science,
 * culture, happiness, influence, food, production).
 *
 * Sample text: "<age chronology>|<turn>|<playerId>:<v1>,<v2>,...;<playerId>:...".
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { canSave, isObserverSeat, onObserverReady, readSaved, watchedPlayers, writeSaved } from './observer-core.js';

const log = createLogger('observer-history', CONFIG.debug);
const HISTORY_EVENT = 'zom-yield-history-changed';

/**
 * Recorded yields in display order; `slot` is the value's position in a
 * sample (new yields take the next slot, so older samples stay readable).
 */
const HISTORY_YIELDS = [
  { id: 'gold', slot: 2, yieldType: 'YIELD_GOLD', label: 'LOC_ZOM_GRAPH_GOLD' },
  { id: 'science', slot: 0, yieldType: 'YIELD_SCIENCE', label: 'LOC_ZOM_GRAPH_SCIENCE' },
  { id: 'culture', slot: 1, yieldType: 'YIELD_CULTURE', label: 'LOC_ZOM_GRAPH_CULTURE' },
  { id: 'happiness', slot: 6, yieldType: 'YIELD_HAPPINESS', label: 'LOC_ZOM_GRAPH_HAPPINESS' },
  { id: 'influence', slot: 5, yieldType: 'YIELD_DIPLOMACY', label: 'LOC_ZOM_GRAPH_INFLUENCE' },
  { id: 'food', slot: 3, yieldType: 'YIELD_FOOD', label: 'LOC_ZOM_GRAPH_FOOD' },
  { id: 'production', slot: 4, yieldType: 'YIELD_PRODUCTION', label: 'LOC_ZOM_GRAPH_PRODUCTION' }
];

const round = (value) => Math.round((Number(value) || 0) * 10) / 10;

function encode({ age, turn, values }) {
  const players = [...values].map(([id, list]) => `${id}:${list.join(',')}`).join(';');
  return `${age}|${turn}|${players}`;
}

function decode(text) {
  const [age, turn, players = ''] = text.split('|');
  const values = new Map();
  for (const entry of players.split(';')) {
    const [id, list] = entry.split(':');
    if (list !== undefined) values.set(Number(id), list.split(',').map(Number));
  }
  return { age: Number(age), turn: Number(turn), values };
}

/**
 * A history saved under `keyPrefix`: measure(player) gives a leader's numbers
 * (by slot) at the start of each turn, `changeEvent` announces each new
 * sample. Returns the reader of every sample:
 * [{ age, turn, values: Map<playerId, number[]> }], oldest first.
 */
function createSampleHistory({ keyPrefix, changeEvent, measure }) {
  const countKey = `${keyPrefix}COUNT`;
  let samples = null;
  let nextIndex = 0;   // property index of the next new sample

  /** Every recorded sample (read from the save once per session). */
  function read() {
    if (samples) return samples;
    if (!canSave()) return [];   // not cached: the save is read once it is available
    samples = [];
    try {
      nextIndex = Number(readSaved(countKey)) || 0;
      for (let i = 0; i < nextIndex; i++) {
        const text = readSaved(keyPrefix + i);
        if (typeof text === 'string' && text) samples.push(decode(text));
      }
    } catch (e) { log(`${keyPrefix} read failed: ${e}`); }
    return samples;
  }

  /** Records this turn's sample; a turn already recorded (e.g. after a reload) is replaced. */
  function recordTurn() {
    if (!isObserverSeat() || !canSave()) return;
    const history = read();
    const sample = { age: currentAgeChronology(), turn: Game.turn, values: new Map() };
    for (const player of watchedPlayers()) sample.values.set(player.id, measure(player).map(round));
    if (sample.values.size === 0) return;
    const last = history[history.length - 1];
    const replace = last?.age === sample.age && last?.turn === sample.turn;
    const index = replace ? nextIndex - 1 : nextIndex;
    try {
      writeSaved(keyPrefix + index, encode(sample));
      if (!replace) writeSaved(countKey, index + 1);
    } catch (e) { log(`${keyPrefix} write failed: ${e}`); return; }
    if (replace) history[history.length - 1] = sample;
    else { history.push(sample); nextIndex = index + 1; }
    window.dispatchEvent(new CustomEvent(changeEvent));
  }

  const scheduleRecord = () => setTimeout(recordTurn, CONFIG.historyRecordDelayMs);
  onObserverReady(() => {
    engine.on('TurnBegin', scheduleRecord);
    scheduleRecord();
  });
  return read;
}

const YIELD_SLOTS = [...HISTORY_YIELDS].sort((a, b) => a.slot - b.slot);

const yieldHistory = createSampleHistory({
  keyPrefix: 'ZOM_YIELD_HISTORY_',
  changeEvent: HISTORY_EVENT,
  measure: (player) => YIELD_SLOTS.map((y) => player.Stats?.getNetYield?.(YieldTypes[y.yieldType]))
});

export { createSampleHistory, HISTORY_EVENT, HISTORY_YIELDS, yieldHistory };
