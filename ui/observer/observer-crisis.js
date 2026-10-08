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
 * has, the turn it started. Recorded at the start of every turn and kept in
 * the Observer's own player properties, like the yield history
 * (observer-history.js), so past Ages keep their marks.
 *
 * Property text, one per Age: "<stage>:<progress %>:<turn or -1>,...".
 */
import { createLogger, currentAgeChronology } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { canSave, isObserverSeat, onObserverReady, readSaved, writeSaved } from './observer-core.js';

const log = createLogger('observer-crisis', CONFIG.debug);
const KEY_PREFIX = 'ZOM_CRISIS_STAGES_';
const CRISIS_EVENT = 'zom-crisis-changed';
const CRISIS_STAGES = [
  { label: 'LOC_UI_POLICIES_CRISIS_BEGINS', color: '#e8a33c' },
  { label: 'LOC_UI_POLICIES_CRISIS_INTENSIFIES', color: '#e2702e' },
  { label: 'LOC_UI_POLICIES_CRISIS_CULMINATES', color: '#d8402e' }
];

let crises = null;   // Map<age chronology, [{ stage, progress, turn | null }]>

const decode = (text) => text.split(',').map((entry) => {
  const [stage, progress, turn] = entry.split(':').map(Number);
  return { stage, progress, turn: turn >= 0 ? turn : null };
}).filter((s) => CRISIS_STAGES[s.stage] && s.progress >= 0);

const encode = (stages) => stages.map((s) => `${s.stage}:${s.progress}:${s.turn ?? -1}`).join(',');

/** Every Age's crisis stages (read from the save once per session). */
function ageCrises() {
  if (crises) return crises;
  if (!canSave()) return new Map();   // not cached: the save is read once it is available
  crises = new Map();
  try {
    for (const age of GameInfo.Ages) {
      const text = readSaved(KEY_PREFIX + age.ChronologyIndex);
      if (typeof text === 'string' && text) crises.set(age.ChronologyIndex, decode(text));
    }
  } catch (e) { log(`crisis read failed: ${e}`); }
  return crises;
}

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
  const stages = progress.map((p, stage) => ({
    stage,
    progress: p,
    turn: known.find((s) => s.stage === stage)?.turn ?? (current >= stage ? Game.turn : null)
  })).filter((s) => s.progress >= 0 && s.progress < 100);
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
