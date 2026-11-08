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
 * A counted log of what each leader did, per Age, turn and Age progress, kept
 * in the Observer's own player properties like the yield history
 * (observer-history.js): saved with the game and carried across Ages.
 * Entry text: "<playerId>,<turn>,<progress %>,<field>,...,<count>", joined by ';'
 * into one property per Age and turn ("<prefix><age>_<n>", counted by
 * "<prefix><age>_COUNT"); older saves' single property per Age ("<prefix><age>")
 * is still read and kept.
 */
import { clamp, currentAgeChronology, deferOnce } from '../shared/zom-util.js';
import { isWatchedLeader, onObserverReady, readSaved, writeSaved } from './observer-core.js';
import { savedOnce } from './observer-history.js';

const SAVE_DELAY_MS = 2000;
const ANNOUNCE_MS = 250;   // changes announced together (an AI turn's fighting logs in bursts)
const BASE_PARTS = 3;      // playerId, turn, progress
const AGE_TEXT = 'age';    // an Age's single property of older saves
const logs = [];           // every event log, flushed together on teardown

/** The current Age's progress, 0-99 (the Culture tab's notches); 99 once the Age has no limit. */
function ageProgress() {
  const max = Game.AgeProgressManager.getMaxAgeProgressionPoints();
  if (!(max > 0)) return 99;
  return clamp(Math.floor((Game.AgeProgressManager.getCurrentAgeProgressionPoints() / max) * 100), 0, 99);
}

/** Oldest first: by Age, then turn. */
const byTime = (a, b) => a.age - b.age || a.turn - b.turn;

/** A category list's index by id: { [id]: index }. */
const categoryIndex = (categories) => Object.fromEntries(categories.map((c, i) => [c.id, i]));

/** A field without the log's separators (a settlement may carry a player's own name). */
const field = (value) => String(value ?? '').replace(/[,;|]/g, ' ');

/**
 * A log saved under `keyPrefix`, with `fieldCount` fields of its own per entry
 * (an older entry may have `minFieldCount`, the rest read as ''), recording
 * only for players that pass `isPlayer` and announcing changes with the window
 * event `changeEvent`. record(playerId, fields, count) counts `count` more (one
 * by default); flush() saves what waits; read() gives derive(entries), kept
 * until the next change: each entry ({ age, playerId, turn, progress, fields,
 * count }, oldest first) as decode(entry) gives it, left out when null.
 */
function createEventLog({ keyPrefix, fieldCount, minFieldCount = fieldCount, changeEvent, log, isPlayer = isWatchedLeader, decode = (entry) => entry, derive = (entries) => entries }) {
  const announce = deferOnce(() => window.dispatchEvent(new CustomEvent(changeEvent)), ANNOUNCE_MS);
  const countKey = (age) => `${keyPrefix}${age}_COUNT`;
  const dirty = new Set();   // chunks to save
  let saveTimer = 0;
  let version = 0;
  let readVersion = -1;
  let derived = [];

  /** The saved entries: { entries (oldest first), chunks: Map<"age:turn", chunk>, byKey: Map<"age|key", chunk>, counts: Map<age, chunks saved> }. */
  const stored = savedOnce(keyPrefix, () => {
    const store = { entries: [], chunks: new Map(), byKey: new Map(), counts: new Map() };
    for (const { ChronologyIndex: age } of GameInfo.Ages) {
      try {
        const text = readSaved(keyPrefix + age);
        if (typeof text === 'string' && text) parse(store, newChunk(store, age, AGE_TEXT, keyPrefix + age), text);
        const count = Number(readSaved(countKey(age))) || 0;
        store.counts.set(age, count);
        for (let i = 0; i < count; i++) {
          const chunkText = readSaved(`${keyPrefix}${age}_${i}`);
          if (typeof chunkText === 'string' && chunkText) parse(store, newChunk(store, age, Number(chunkText.split(',', 2)[1]), `${keyPrefix}${age}_${i}`), chunkText);
        }
      } catch (e) { log(`${keyPrefix} read failed: ${e}`); }
    }
    store.entries.sort(byTime);
    return store;
  }, () => null);

  /** A property's entries ("age:turn" its id; turn AGE_TEXT for an older save's whole Age): { age, key, rows: Map<entry key, entry> }. */
  function newChunk(store, age, turn, key) {
    const chunk = { age, key, rows: new Map() };
    store.chunks.set(`${age}:${turn}`, chunk);
    return chunk;
  }

  function addEntry(store, chunk, key, entry) {
    chunk.rows.set(key, entry);
    store.byKey.set(`${chunk.age}|${key}`, chunk);
    store.entries.push(entry);
  }

  function parse(store, chunk, text) {
    for (const item of text.split(';')) {
      const parts = item.split(',');
      const own = parts.length - BASE_PARTS - 1;
      const count = Number(parts[parts.length - 1]);
      if (own < minFieldCount || own > fieldCount || !(count > 0)) continue;
      const [playerId, turn, progress] = parts;
      const fields = [...parts.slice(BASE_PARTS, -1), ...Array(fieldCount - own).fill('')];
      addEntry(store, chunk, parts.slice(0, -1).join(','), { age: chunk.age, playerId: Number(playerId), turn: Number(turn), progress: Number(progress), fields, count });
    }
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const store = stored();
    if (!store) return;
    const ages = new Set();
    for (const chunk of dirty) {
      try { writeSaved(chunk.key, [...chunk.rows].map(([key, entry]) => `${key},${entry.count}`).join(';')); } catch (e) { log(`${keyPrefix} write failed: ${e}`); }
      ages.add(chunk.age);
    }
    dirty.clear();
    for (const age of ages) {
      try { writeSaved(countKey(age), store.counts.get(age) ?? 0); } catch (e) { log(`${keyPrefix} write failed: ${e}`); }
    }
  }

  function record(playerId, fields, count = 1) {
    if (playerId == null || playerId < 0 || !(count > 0) || !isPlayer(playerId)) return;
    const store = stored();
    if (!store) return;
    const [age, turn, progress] = [currentAgeChronology(), Game.turn, ageProgress()];
    const own = fields.map(field);
    const key = [playerId, turn, progress, ...own].join(',');
    let chunk = store.byKey.get(`${age}|${key}`);
    if (chunk) chunk.rows.get(key).count += count;
    else {
      chunk = store.chunks.get(`${age}:${turn}`);
      if (!chunk) {
        const index = store.counts.get(age) ?? 0;
        store.counts.set(age, index + 1);
        chunk = newChunk(store, age, turn, `${keyPrefix}${age}_${index}`);
      }
      addEntry(store, chunk, key, { age, playerId, turn, progress, fields: own, count });
    }
    dirty.add(chunk);
    version++;
    if (!saveTimer) saveTimer = setTimeout(save, SAVE_DELAY_MS);
    announce();
  }

  function read() {
    const store = stored();
    if (!store) return [];
    if (readVersion !== version) {
      derived = derive(store.entries.flatMap((entry) => { const decoded = decode(entry); return decoded ? [decoded] : []; }));
      readVersion = version;
    }
    return derived;
  }

  const flush = () => { if (saveTimer) save(); };
  logs.push(flush);
  return { record, read, flush };
}

onObserverReady(() => {
  for (const name of ['GameAgeEnded', 'BeforeUnload']) engine.on(name, () => logs.forEach((flush) => flush()));
});

/** Logs the first payload of each engine event by name, to confirm its fields in UI.log. */
function payloadLogger(log) {
  const shown = new Set();
  return (name, data) => {
    if (shown.has(name)) return;
    shown.add(name);
    try { log(`${name} payload: ${JSON.stringify(data)}`); } catch (e) { /* not serializable */ }
  };
}

export { ageProgress, byTime, categoryIndex, createEventLog, payloadLogger };
