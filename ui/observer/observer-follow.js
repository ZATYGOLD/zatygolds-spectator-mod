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
 * Zatygold's Spectator - Follow the Action (in-game scope).
 *
 * A ribbon toggle (off by default, saved with the game) that moves the camera
 * to what happens between leaders: settlements captured or razed, then battles,
 * then settlements founded. At most one move per CONFIG.followDwellMs, to the
 * most important event since the last move; none while a screen is open or for
 * CONFIG.followIdleMs after the player's own input. In a Perspective, only what
 * the viewed leader can see.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { createLogger } from '../shared/zom-util.js';
import { combatLocation } from './observer-battle-log.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady, readSavedFlag, writeSavedFlag } from './observer-core.js';
import { perspectivePlayer } from './observer-perspective.js';
import { watchSettlements } from './observer-settlement-watch.js';

const log = createLogger('observer-follow');
const SAVE_KEY = 'ZOM_FOLLOW_ACTION';
const PRIORITY = { founded: 1, battle: 2, captured: 3 };

let following = CONFIG.followAction;
let pending = null;   // { location, priority }: where the next move goes
let timer = null;
let lastMoveAt = 0;
let lastInputAt = 0;

const plotLocation = (plot) => GameplayMap.getLocationFromIndex(plot);
/** In sight of the shown view: anywhere for the Observer, the viewed leader's sight in a Perspective. */
function inView(location) {
  const viewer = perspectivePlayer();
  return viewer == null || GameplayMap.getRevealedState(viewer, location.x, location.y) === RevealedStates.VISIBLE;
}
const canMove = () => following && ContextManager.isEmpty && Date.now() - lastInputAt >= CONFIG.followIdleMs;

function move() {
  timer = null;
  const target = pending;
  pending = null;
  if (!target || !canMove() || !inView(target.location)) return;
  try { Camera.lookAtPlot(target.location); } catch (e) { log(`camera move failed: ${e}`); }
  lastMoveAt = Date.now();
}

/** Queue a camera move; a more important event since the last move wins, an equal one replaces it. */
function follow(location, priority) {
  if (!following || !location || (pending && pending.priority > priority) || !inView(location)) return;
  pending = { location, priority };
  timer ??= setTimeout(move, Math.max(0, lastMoveAt + CONFIG.followDwellMs - Date.now()));
}

function isFollowing() { return following; }

function setFollowing(on) {
  following = !!on;
  try { writeSavedFlag(SAVE_KEY, following); } catch (e) { log(`follow save failed: ${e}`); }
  if (following) return;
  clearTimeout(timer);
  timer = null;
  pending = null;
}

onObserverReady(() => {
  try { following = readSavedFlag(SAVE_KEY, CONFIG.followAction); } catch (e) { log(`follow not restored: ${e}`); }
  window.addEventListener('engine-input', () => { lastInputAt = Date.now(); }, true);
  engine.on('Combat', (data) => follow(combatLocation(data), PRIORITY.battle));
  watchSettlements({
    founded: (settlement) => follow(plotLocation(settlement.plot), PRIORITY.founded),
    transferred: (settlement) => follow(plotLocation(settlement.plot), PRIORITY.captured),
    razed: (settlement) => follow(plotLocation(settlement.plot), PRIORITY.captured)
  });
});

export { isFollowing, setFollowing };
