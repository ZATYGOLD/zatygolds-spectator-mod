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
 * Zatygold's Spectator - Observer start and Eye (gameplay scripts).
 *
 * Loaded into every map generation as a MapGenScript, and imported by the
 * map-globals override (which every map script and the Age-transition script
 * import). While a new map is generated:
 * - the Observer is hidden from the Players lists, so any map script or
 *   placement mod (East vs West, FFA balancers...) counts, regions and spaces
 *   only the real players;
 * - the Observer's start and Eye are set here, once, on the ice;
 * - a script that still sets the Observer's start directly gets the same ice
 *   start back and creates no second Eye.
 * An Age transition resets units, so each Observer gets a new Eye once the
 * transition's own pass is done (RequestMapInitData does not fire there).
 */
import { createObserverEye, hasEye, isObserverPlayerId, observerPlots, placeObserverEyes } from './zom-observer-eye.js';

const HIDDEN_LISTS = ['getAliveMajorIds', 'getAliveIds', 'getAlive', 'getEverAlive'];

const log = (m) => console.log('[ZOM observer-start] ' + m);

/** Shared by every loaded copy of this module (MapGenScript and map-globals import). */
const state = globalThis.zomObserverStart ??= {
  installed: false,
  generating: false,
  showObservers: false,     // this map indexes its starts by player ID: the Observer stays listed
  finalPass: false,         // the GenerateMap final pass is registered
  raw: {},
  observerIds: null,
  starts: new Map(),
  usedPlots: new Set()
};

const listId = (entry) => (typeof entry === 'number' ? entry : entry?.id);

function observerIds() {
  if (!state.observerIds) {
    const ids = state.raw.getAliveMajorIds?.call(Players) ?? [];
    state.observerIds = new Set(ids.filter(isObserverPlayerId));
  }
  return state.observerIds;
}

/** Set the Observer's start on the ice (chosen once per map) and give it one Eye. */
function assignObserverStart(playerId) {
  let plots = state.starts.get(playerId);
  if (!plots) {
    plots = observerPlots(state.usedPlots);
    if (!plots) { log(`player ${playerId}: no water for the start`); return false; }
    const setStart = state.raw.setStartPosition;
    let placed = false;
    try { placed = setStart(plots.start.index, playerId) !== false; } catch (e) { log(`ice start refused for ${playerId}: ${e}`); }
    if (!placed) {
      const w = GameplayMap.getGridWidth();
      const waterIndex = plots.water.y * w + plots.water.x;
      try { placed = setStart(waterIndex, playerId) !== false; } catch (e) { log(`water start refused for ${playerId}: ${e}`); }
    }
    if (!placed) return false;
    state.starts.set(playerId, plots);
  }
  if (!hasEye(playerId)) {
    try { createObserverEye(playerId, plots); } catch (e) { log(`eye creation failed for ${playerId}: ${e}`); }
  }
  return true;
}

function ensureObserverStarts() {
  for (const playerId of observerIds()) {
    try { assignObserverStart(playerId); } catch (e) { log(`start failed for ${playerId}: ${e}`); }
  }
}

function hideObserversFromLists() {
  for (const name of HIDDEN_LISTS) {
    const original = Players[name];
    if (typeof original !== 'function') continue;
    state.raw[name] = original;
    try {
      Players[name] = (...args) => {
        const list = original.apply(Players, args);
        if (!state.generating || state.showObservers || !Array.isArray(list)) return list;
        const hidden = observerIds();
        return hidden.size ? list.filter((entry) => !hidden.has(listId(entry))) : list;
      };
    } catch (e) { log(`could not wrap Players.${name}: ${e}`); }
  }
}

function routeStartPositions() {
  const original = StartPositioner.setStartPosition.bind(StartPositioner);
  state.raw.setStartPosition = original;
  StartPositioner.setStartPosition = (plotIndex, playerId) => {
    if (!state.generating) return original(plotIndex, playerId);
    if (observerIds().has(playerId)) return assignObserverStart(playerId) || original(plotIndex, playerId);
    const result = original(plotIndex, playerId);
    ensureObserverStarts();
    return result;
  };
}

/**
 * True Start Location starts (the Earth maps) are kept in arrays indexed by player ID:
 * a hidden Observer below the last real player leaves a hole there that stops generation.
 * The Observer stays listed for them; its start is still routed to the ice.
 */
function startsIndexedByPlayerId() {
  try {
    const value = Configuration.getMapValue('StartPosition');
    return value != null && Number(BigInt.asIntN(32, BigInt(value))) === Database.makeHash('START_POSITION_HISTORICAL');
  } catch (e) { return false; }
}

function beginMapGeneration() {
  state.generating = true;
  state.showObservers = startsIndexedByPlayerId();
  state.observerIds = null;
  state.starts = new Map();
  state.usedPlots = new Set();
  // Registered now, after the map script's own GenerateMap listener: a final pass once every start is placed (once per context).
  if (state.finalPass) return;
  state.finalPass = true;
  engine.on('GenerateMap', ensureObserverStarts);
}

/** A new Eye for each Observer after an Age transition (one that still has its Eye keeps it). */
function placeEyesAfterTransition() {
  try { placeObserverEyes(); } catch (e) { log(`age transition eye placement failed: ${e}`); }
}

/**
 * The game's initialization after the map (or an Age transition's): map generation is over,
 * and the Age-transition pass is registered again, so it always comes after the transition
 * script's own GenerateAgeTransition listener and runs once units are reset.
 */
function onAgeInitialization() {
  state.generating = false;
  if (typeof engine.off === 'function') engine.off('GenerateAgeTransition', placeEyesAfterTransition);   // a repeat is harmless: an Eye is never placed twice
  engine.on('GenerateAgeTransition', placeEyesAfterTransition);
}

/**
 * Map generation (where StartPositioner exists): the Observer hidden from the player lists
 * and its start routed to the ice. Every context: the Age initialization hook.
 */
function installObserverStarts() {
  if (state.installed || typeof engine === 'undefined' || typeof Players === 'undefined') return;
  state.installed = true;
  try {
    // Hidden until the game's initialization after the map, so every placement step sees only the real players.
    engine.on('RequestAgeInitializationParameters', onAgeInitialization);
    if (typeof StartPositioner === 'undefined') return;
    hideObserversFromLists();
    routeStartPositions();
    engine.on('RequestMapInitData', beginMapGeneration);
  } catch (e) { log('could not install: ' + e); }
}

installObserverStarts();
