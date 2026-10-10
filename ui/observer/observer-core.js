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
 * Zatygold's Spectator - Observer core (in-game scope).
 *
 * Who is watching and who is being watched. Every Observer module no-ops
 * unless isObserverSeat() - other players are untouched.
 */
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { componentOf, createLogger, isObserverPlayer, leaderTypeOf, whenDefined, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';

const coreLog = createLogger('observer-core');
const BUILD = '2026-10-10 14:10';
// One line per game load, so UI.log always says which build ran and for whom.
engine.whenReady.then(() => coreLog(`build ${BUILD}; observer seat: ${isObserverSeat()}`));

/** ContextManager.push options for the Observer's full screens. */
const SCREEN_PROPS = { singleton: true, createMouseGuard: true };

/** True when this client plays the Observer (and the Observer's features are on). */
function isObserverSeat() {
  try { return CONFIG.enabled && isObserverPlayer(GameContext.localPlayerID); } catch (e) { return false; }
}

/** Run once the game is ready, on the Observer seat only (listeners for everyone else are never registered). */
function onObserverReady(run) {
  engine.whenReady.then(() => { if (isObserverSeat()) run(); });
}

/** Living major players, Observers excluded. */
function watchedPlayers() {
  try { return Players.getAlive().filter((p) => p?.isMajor && !isObserverPlayer(p.id)); }
  catch (e) { return []; }
}

/** An Independent Power (always hostile to everyone). */
const isIndependent = (id) => { const p = Players.get(id); return !!p && (p.isIndependent ?? (!p.isMajor && !p.isMinor)); };

/** Whether two players are enemies: at war, or either an Independent Power. */
const areEnemies = (a, b) => a != null && b != null && a !== b && (isIndependent(a) || isIndependent(b) || !!Players.get(a)?.Diplomacy?.isAtWarWith?.(b));

// ============================ Screen dock ============================

const DOCK_TAG = 'panel-sub-system-dock';

/**
 * The HUD's screen dock: patch(prototype) once its class is defined, then
 * place(dock) on the dock now (if it is up) and every time it attaches.
 */
function onScreenDock({ patch, place }, log) {
  const run = (dock) => {
    try { if (dock) place?.(dock); } catch (e) { log(`screen dock: ${e}`); }
  };
  whenDefined(DOCK_TAG, (definition) => {
    const proto = definition.createInstance.prototype;
    patch?.(proto);
    wrapMethod(proto, 'onAttach', function (base, ...args) {
      const result = base(...args);
      run(this);
      return result;
    });
    engine.whenReady.then(() => {
      const dock = document.querySelector(DOCK_TAG);
      run(componentOf(dock));
    });
  }, { log });
}

// ============================ Saved values ============================

/** The Observer's own player properties: saved with the game and kept across Age transitions (the store the game's UI catalogs use). */
const savedStore = () => Players.get(GameContext.localPlayerID)?.Tutorial;
const canSave = () => !!savedStore();
const readSaved = (key) => savedStore()?.getProperty(Database.makeHash(key));
const writeSaved = (key, value) => savedStore()?.setProperty(Database.makeHash(key), value);

// ============================ Diplomacy snapshot ============================

const SNAPSHOT_TTL_MS = 1000;
let snapshot = null;
let snapshotAt = 0;

/** Groups of ids linked by alliances (union of allied pairs), only groups of two or more. */
function allianceGroups(players, allied) {
  const parent = new Map(players.map((p) => [p.id, p.id]));
  const root = (id) => (parent.get(id) === id ? id : root(parent.get(id)));
  for (const [a, b] of allied) parent.set(root(a), root(b));
  const groups = new Map();
  for (const p of players) {
    const r = root(p.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(p.id);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

/**
 * Wars and alliances between watched leaders, recomputed at most once a
 * second (or right after a war or peace): { wars: [[idA, idB]], alliances: [[ids]] },
 * pairs with idA < idB.
 */
function diplomacySnapshot() {
  const now = Date.now();
  if (snapshot && now - snapshotAt < SNAPSHOT_TTL_MS) return snapshot;
  const players = watchedPlayers();
  const wars = [];
  const allied = [];
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const [a, b] = [players[i], players[j]];
      const pair = [a.id, b.id].sort((x, y) => x - y);
      try {
        if (a.Diplomacy?.isAtWarWith?.(b.id)) wars.push(pair);
        else if (a.Diplomacy?.hasAllied?.(b.id)) allied.push(pair);
      } catch (e) { /* skip pair */ }
    }
  }
  snapshot = { wars, alliances: allianceGroups(players, allied) };
  snapshotAt = now;
  return snapshot;
}

for (const event of ['DiplomacyDeclareWar', 'DiplomacyMakePeace', 'DiplomacyRelationshipStatusChanged']) engine.on(event, () => { snapshot = null; });

/** A unit's current base strengths (0 when it has none). */
const meleeStrength = (unit) => unit?.Combat?.getMeleeStrength?.(false) ?? 0;
const rangedStrength = (unit) => Math.max(unit?.Combat?.rangedStrength ?? 0, unit?.Combat?.bombardStrength ?? 0);
const unitStrength = (unit) => Math.max(meleeStrength(unit), rangedStrength(unit));

/** A circular leader portrait (fxs-icon) for a player. */
function leaderPortrait(player, sizeClass) {
  const icon = document.createElement('fxs-icon');
  icon.classList.value = sizeClass;
  icon.setAttribute('data-icon-id', leaderTypeOf(player.leaderType));
  icon.setAttribute('data-icon-context', 'CIRCLE_MASK');
  return icon;
}

/** True in any diplomacy screen (leader panel, dialogs, call to arms, peace deal). */
function inDiplomacyMode() {
  try { return /DIPLOMACY|CALL_TO_ARMS|PEACE_DEAL/.test(InterfaceMode.getCurrent() ?? ''); } catch (e) { return false; }
}

/** True in the leader panel itself. */
function inLeaderPanel() {
  try { return /DIPLOMACY_HUB/.test(InterfaceMode.getCurrent() ?? ''); } catch (e) { return false; }
}

export {
  areEnemies, canSave, diplomacySnapshot, inDiplomacyMode, inLeaderPanel, isObserverSeat, leaderPortrait, meleeStrength, onObserverReady, onScreenDock,
  rangedStrength, readSaved, SCREEN_PROPS, unitStrength, watchedPlayers, writeSaved
};
