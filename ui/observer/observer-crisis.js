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
 * Zatygold's Spectator - Observer crisis log (in-game scope).
 *
 * Each Age's crisis stages for the graphs (CRISIS_STAGES: begins, intensifies,
 * culminates): the Age progress (%) at which each stage starts and, once it
 * has, the turn it started (unknown for a stage already begun when the Age was
 * first recorded). Recorded each turn and kept in the Observer's own player
 * properties, like the yield history (observer-history.js), so past Ages keep their marks.
 *
 * Property text, one per Age: "<stage>:<progress %>:<turn, -1 not yet, -2 begun before recorded>,...".
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { canSave, isObserverSeat, onObserverReady, writeSaved } from './observer-core.js';
import { savedPerAge } from './observer-history.js';

const log = createLogger('observer-crisis', CONFIG.debug);
const KEY_PREFIX = 'ZOM_CRISIS_STAGES_';
const CRISIS_EVENT = 'zom-crisis-changed';
const [NOT_YET, BEFORE] = [-1, -2];
/** Each stage's colour, and a darker, richer one for its notch on the timelines (visible over the Wars tab's colours). */
const CRISIS_STAGES = [
  { label: 'LOC_UI_POLICIES_CRISIS_BEGINS', color: '#e8a33c', notch: '#9a5a08' },
  { label: 'LOC_UI_POLICIES_CRISIS_INTENSIFIES', color: '#e2702e', notch: '#8f3a0c' },
  { label: 'LOC_UI_POLICIES_CRISIS_CULMINATES', color: '#d8402e', notch: '#6e1010' }
];

/** A stage: { stage, progress, turn (null unknown), begun (before the Age was first recorded) }. */
const decode = (text) => text.split(',').map((entry) => {
  const [stage, progress, turn] = entry.split(':').map(Number);
  return { stage, progress, turn: turn >= 0 ? turn : null, begun: turn === BEFORE };
}).filter((s) => CRISIS_STAGES[s.stage] && s.progress >= 0);

const encode = (stages) => stages.map((s) => `${s.stage}:${s.progress}:${s.turn ?? (s.begun ? BEFORE : NOT_YET)}`).join(',');

/** Every Age's crisis stages: Map<age chronology, [{ stage, progress, turn, begun }]> (read from the save once per session). */
const ageCrises = savedPerAge(KEY_PREFIX, decode);

/** The current Age's stages: where each starts (under 100%), and the turn it started once it has. */
function recordCrisis() {
  if (!isObserverSeat() || !canSave()) return;
  let current;
  let progress;
  try {
    if (!Game.CrisisManager.isCrisisEnabled(0)) return;
    current = Game.CrisisManager.getCurrentCrisisStage(0);
    progress = CRISIS_STAGES.map((s, i) => Game.CrisisManager.getCrisisStageTriggerPercent(0, i));
  } catch (e) { log(`crisis unavailable: ${e}`); return; }
  const age = currentAgeChronology();
  const known = ageCrises().get(age) ?? [];
  const stages = progress.map((p, stage) => {
    const before = known.find((s) => s.stage === stage);
    const started = current >= stage && before?.turn == null && !before?.begun;
    return { stage, progress: p, turn: before?.turn ?? (started && known.length ? Game.turn : null), begun: !!before?.begun || (started && !known.length) };
  }).filter((s) => s.progress >= 0 && s.progress < 100);
  const text = encode(stages);
  if (text === encode(known)) return;
  ageCrises().set(age, stages);
  try { writeSaved(KEY_PREFIX + age, text); } catch (e) { log(`crisis write failed: ${e}`); }
  window.dispatchEvent(new CustomEvent(CRISIS_EVENT));
}

const scheduleRecord = () => setTimeout(recordCrisis, CONFIG.historyRecordDelayMs);

onObserverReady(() => {
  engine.on('TurnBegin', scheduleRecord);
  scheduleRecord();
});

export { ageCrises, CRISIS_EVENT, CRISIS_STAGES };
