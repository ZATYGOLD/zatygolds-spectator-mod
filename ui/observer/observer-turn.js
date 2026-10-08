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
 * Zatygold's Spectator - Observer turn ending (in-game scope).
 *
 * Auto End Turn (off by default, toggled from the ribbon): ends the Observer's
 * turn once nothing blocks it, never while paused or after the Observer
 * un-readied. A blocker that outlasts a few retries is logged and dismissed
 * when the game allows it; a turn still open well after it began is logged and
 * ended again (a watchdog). Switches off when an Age completes so the transition action shows,
 * and hides the End Turn button while the turn is ended. After every unpause
 * an ended turn is sent again (the engine drops completions sent while paused).
 */
import { createLogger, isAgeEnding, isAgeTransitionInProgress, setStyle } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, onObserverReady } from './observer-core.js';

const log = createLogger('observer-turn');
const HIDE_CLASS = 'zom-observer-auto-turn';
const STYLE_ID = 'zom-observer-turn-style';
const SLIDE = '0.35s ease';
const STYLE = [
  `panel-action { transition: transform ${SLIDE}, opacity ${SLIDE}; }`,
  `.${HIDE_CLASS} panel-action { transform: translateY(120%); opacity: 0; pointer-events: none; }`
].join('\n');

let autoEnd = CONFIG.autoEndTurn;
let retryTimer = null;
let blockedRetries = 0;
const BLOCK_PATIENCE = 3;   // blocked retries before the blocker is reported and, if allowed, dismissed
const WATCHDOG_MS = 10000;  // a turn still open this long after it began is ended again
let watchdog = null;

const isPaused = () => !!Configuration.getGame().isPaused;
const turnActive = () => !!Players.get(GameContext.localPlayerID)?.isTurnActive;
const blocked = () => Game.Notifications.getEndTurnBlockingType(GameContext.localPlayerID) !== EndTurnBlockingTypes.NONE;
/** The Age has ended (after its last turn) and the next one has not begun. */
function ageOver() {
  if (isAgeTransitionInProgress()) return true;
  try {
    const ages = Game.AgeProgressManager;
    return !!ages?.isAgeOver && !ages.isFinalAge && !ages.isExtendedGame;
  } catch (e) { return false; }
}

/** The notification blocking the turn: logged (first time), dismissed when the game allows it. */
function clearBlocker(report) {
  const me = GameContext.localPlayerID;
  const type = Game.Notifications.getEndTurnBlockingType(me);
  const id = Game.Notifications.findEndTurnBlocking(me, type);
  if (report) {
    log(`turn blocked by ${enumName(EndTurnBlockingTypes, type)}${id ? ` (${Game.Notifications.getTypeName?.(Game.Notifications.getType(id)) ?? ''})` : ''}`);
  }
  if (id && Game.Notifications.canUserDismissNotification(id)) Game.Notifications.dismiss(id);
}

const enumName = (values, value) => Object.keys(values).find((k) => values[k] === value) ?? value;

/** The turn's state, for the log: what blocks it, what was sent, the pending notifications. */
function describeTurn() {
  const me = GameContext.localPlayerID;
  const notifications = (Game.Notifications.getIdsForPlayer(me) ?? []).map((id) => Game.Notifications.getTypeName?.(Game.Notifications.getType(id)) ?? '?');
  return `blocking ${enumName(EndTurnBlockingTypes, Game.Notifications.getEndTurnBlockingType(me))}, sent ${GameContext.hasSentTurnComplete()}, `
    + `unready ${GameContext.hasSentTurnUnreadyThisTurn()}, ageEnding ${isAgeEnding()}, notifications [${notifications.join(', ')}]`;
}

/** A turn still open long after it began: logged, then ended again (or retried). */
function checkStuckTurn() {
  watchdog = null;
  if (!endsAutomatically() || !isObserverSeat() || isPaused()) return;
  try {
    if (!turnActive()) return;
    log(`turn ${Game.turn} still open: ${describeTurn()}`);
    if (GameContext.hasSentTurnComplete()) sendTurnComplete();
    else tryEndTurn();
  } catch (e) { log(`watchdog failed: ${e}`); }
  armWatchdog();
}

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(checkStuckTurn, WATCHDOG_MS);
}

const endsAutomatically = () => (autoEnd && !isAgeEnding()) || ageOver();

function sendTurnComplete() {
  UI.Player.deselectAllUnits();
  GameContext.sendTurnComplete();
}

/** End the turn now if possible; otherwise retry while the turn stays open. */
function tryEndTurn() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!endsAutomatically() || !isObserverSeat()) return;
  try {
    if (!turnActive() || GameContext.hasSentTurnComplete() || GameContext.hasSentTurnUnreadyThisTurn()) return;
    if (isPaused() || blocked()) {
      if (!isPaused() && ++blockedRetries % BLOCK_PATIENCE === 0) clearBlocker(blockedRetries === BLOCK_PATIENCE);
      retryTimer = setTimeout(tryEndTurn, CONFIG.autoEndTurnRetryMs);
      return;
    }
    blockedRetries = 0;
    sendTurnComplete();
  } catch (e) { log(`auto end turn failed: ${e}`); }
}

/** Re-send a turn completion the engine dropped while paused. */
function recoverAfterPause() {
  if (!isObserverSeat() || isPaused()) return;
  try {
    if (turnActive() && GameContext.hasSentTurnComplete()) {
      log('re-sending turn completion after unpause');
      sendTurnComplete();
    }
  } catch (e) { log(`turn recovery failed: ${e}`); }
  tryEndTurn();
}

const later = (fn) => () => setTimeout(fn, CONFIG.autoEndTurnDelayMs);

/** Hide the End Turn button while the turn ends automatically (shown again when paused or off). */
function updateEndTurnButton() {
  if (!isObserverSeat()) return;
  setStyle(STYLE_ID, STYLE);
  document.body.classList.toggle(HIDE_CLASS, endsAutomatically() && !isPaused());
}

/** Turn start / Age end: refresh the button, then end the turn if it ends automatically. */
function onTurnState() {
  if (autoEnd && isObserverSeat() && isAgeEnding() && !ageOver()) {
    autoEnd = false;   // the last turn of the Age: the Observer starts the transition from the HUD
    log('age complete: auto end turn switched off');
  }
  updateEndTurnButton();
  tryEndTurn();
  if (endsAutomatically()) armWatchdog();
}

function isAutoEndTurn() { return autoEnd; }

function setAutoEndTurn(on) {
  autoEnd = !!on;
  updateEndTurnButton();
  if (autoEnd) { tryEndTurn(); return; }
  clearTimeout(retryTimer);
  retryTimer = null;
  try { if (Players.get(GameContext.localPlayerID)?.canUnreadyTurn) GameContext.sendUnreadyTurn(); }
  catch (e) { log(`unready failed: ${e}`); }
}

onObserverReady(() => {
  for (const event of ['LocalPlayerTurnBegin', 'GameAgeEnded']) engine.on(event, later(onTurnState));
  engine.on('GamePauseStateChanged', () => { setTimeout(updateEndTurnButton, 0); later(recoverAfterPause)(); });
  later(onTurnState)();
});

export { isAutoEndTurn, setAutoEndTurn };
