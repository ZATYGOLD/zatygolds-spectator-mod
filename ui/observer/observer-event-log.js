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
 * Zatygold's Spectator - Observer event logs (in-game scope).
 *
 * A counted log of what each leader did, per Age, turn and Age progress,
 * kept in the Observer's own player properties like the yield history
 * (observer-history.js): saved with the game and carried across Ages. A log
 * has fields of its own (observer-unit-log.js, observer-settlement-log.js,
 * observer-empire.js).
 *
 * Property text, one per Age: "<playerId>,<turn>,<progress %>,<field>,...,<count>;...".
 */
import { currentAgeChronology } from '../shared/zom-util.js';
import { canSave, readSaved, writeSaved } from './observer-core.js';

const SAVE_DELAY_MS = 2000;
const BASE_PARTS = 3;   // playerId, turn, progress

/** The current Age's progress, 0-99 (the Culture tab's notches); 99 once the Age has no limit. */
function ageProgress() {
  const max = Game.AgeProgressManager.getMaxAgeProgressionPoints();
  if (!(max > 0)) return 99;
  return Math.max(0, Math.min(99, Math.floor((Game.AgeProgressManager.getCurrentAgeProgressionPoints() / max) * 100)));
}

/**
 * A log saved under `keyPrefix` + Age, with `fieldCount` fields of its own per
 * entry, announcing each change with the window event `changeEvent`.
 * record(playerId, fields, count) counts `count` more (one by default); read() lists
 * [{ age, playerId, turn, progress, fields, count }].
 */
function createEventLog({ keyPrefix, fieldCount, changeEvent, log }) {
  const partCount = BASE_PARTS + fieldCount;
  let entries = null;   // Map<age chronology, Map<entry key, count>>
  const dirtyAges = new Set();
  let saveTimer = 0;

  function decode(text) {
    const counts = new Map();
    for (const entry of (text ?? '').split(';')) {
      const parts = entry.split(',');
      if (parts.length === partCount + 1) counts.set(parts.slice(0, partCount).join(','), Number(parts[partCount]) || 0);
    }
    return counts;
  }

  const encode = (counts) => [...counts].map(([key, count]) => `${key},${count}`).join(';');

  /** Every Age's entries (read from the save once per session). */
  function allEntries() {
    if (entries) return entries;
    if (!canSave()) return new Map();   // not cached: the save is read once it is available
    entries = new Map();
    try {
      for (const age of GameInfo.Ages) {
        const text = readSaved(keyPrefix + age.ChronologyIndex);
        if (typeof text === 'string' && text) entries.set(age.ChronologyIndex, decode(text));
      }
    } catch (e) { log(`${keyPrefix} read failed: ${e}`); }
    return entries;
  }

  function save() {
    saveTimer = 0;
    for (const age of dirtyAges) {
      try { writeSaved(keyPrefix + age, encode(allEntries().get(age) ?? new Map())); } catch (e) { log(`${keyPrefix} write failed: ${e}`); }
    }
    dirtyAges.clear();
  }

  function record(playerId, fields, count = 1) {
    if (playerId == null || playerId < 0 || !(count > 0) || !canSave()) return;
    const age = currentAgeChronology();
    const all = allEntries();
    const counts = all.get(age) ?? new Map();
    all.set(age, counts);
    const key = [playerId, Game.turn, ageProgress(), ...fields].join(',');
    counts.set(key, (counts.get(key) ?? 0) + count);
    dirtyAges.add(age);
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
    window.dispatchEvent(new CustomEvent(changeEvent));
  }

  function read() {
    const out = [];
    for (const [age, counts] of allEntries()) {
      for (const [key, count] of counts) {
        if (!count) continue;
        const [playerId, turn, progress, ...fields] = key.split(',');
        out.push({ age, playerId: Number(playerId), turn: Number(turn), progress: Number(progress), fields, count });
      }
    }
    return out;
  }

  return { record, read };
}

export { ageProgress, createEventLog };
