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
 * Auto End Turn (off by default, toggled from the ribbon, saved with the game):
 * ends the Observer's turn once nothing blocks it, never while paused or
 * un-readied. A blocker is answered through the prompts module; one that stays
 * is logged and the End Turn button shown again. A turn still open long after
 * it began is ended again (a watchdog), and after an unpause an ended turn is
 * sent again (the engine drops completions sent while paused). Opening the
 * pause menu switches it off, unless a multiplayer pause opened it (Better
 * Balanced Multiplayer opens it for everyone). A complete Age waits for one
 * click on the End Turn button (Transition to Next Age); the transition then
 * runs by itself, including the loading screen's Continue (single player).
 * The End Turn button hides while turns end automatically.
 */
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { createLogger, isAgeEnding, isAgeTransitionInProgress, setStyle } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, onObserverReady, savedToggle } from './observer-core.js';
import { resolveNotification } from './observer-prompts.js';

const log = createLogger('observer-turn', CONFIG.debug);
const PAUSE_MENU_MODE = 'INTERFACEMODE_PAUSE_MENU';
const BEGIN_POLL_MS = 250;
const BEGIN_TIMEOUT_MS = 120000;   // stop waiting for the loading screen's Continue
const HIDE_CLASS = 'zom-observer-auto-turn';
const STYLE_ID = 'zom-observer-turn-style';
const SLIDE = '0.35s ease';
const STYLE = [
  `panel-action { transition: transform ${SLIDE}, opacity ${SLIDE}; }`,
  `.${HIDE_CLASS} panel-action { transform: translateY(120%); opacity: 0; pointer-events: none; }`
].join('\n');

const autoEnd = savedToggle('ZOM_AUTO_END_TURN', CONFIG.autoEndTurn);
let transitionStarted = false;   // the Observer ended the Age's last turn: the transition runs by itself
let sentAutomatically = false;   // this turn's completion came from Auto End Turn (not the player's click)
let stuck = false;               // a blocker that could not be answered: the End Turn button is shown
let retryTimer = null;
let blockedRetries = 0;
let watchdog = null;

const enumName = (values, value) => Object.keys(values).find((k) => values[k] === value) ?? value;
const isPaused = () => !!Configuration.getGame().isPaused;
const turnActive = () => !!Players.get(GameContext.localPlayerID)?.isTurnActive;
/** Whether the local player's leader is known yet (isObserverSeat is false until it is). */
const seatKnown = () => !!GameInfo.Leaders.lookup(Players.get(GameContext.localPlayerID)?.leaderType);
const blocked = () => Game.Notifications.getEndTurnBlockingType(GameContext.localPlayerID) !== EndTurnBlockingTypes.NONE;

/** The notification blocking the turn: answered or dismissed when possible, logged on the first report. */
function clearBlocker(report) {
  const me = GameContext.localPlayerID;
  const type = Game.Notifications.getEndTurnBlockingType(me);
  const id = Game.Notifications.findEndTurnBlocking(me, type);
  if (report) {
    log(`turn blocked by ${enumName(EndTurnBlockingTypes, type)}${id ? ` (${Game.Notifications.getTypeName?.(Game.Notifications.getType(id)) ?? ''})` : ''}`);
  }
  if (!id || resolveNotification(id)) return;
  if (Game.Notifications.canUserDismissNotification(id)) Game.Notifications.dismiss(id);
}

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
  if (!endsAutomatically() || !isObserverSeat()) return;
  if (!isPaused()) {
    try {
      if (!turnActive()) return;
      log(`turn ${Game.turn} still open: ${describeTurn()}`);
      if (GameContext.hasSentTurnComplete()) resendTurnComplete();
      else tryEndTurn();
    } catch (e) { log(`watchdog failed: ${e}`); }
  }
  armWatchdog();   // kept running while paused: a pause is when completions get dropped
}

function armWatchdog() {
  clearTimeout(watchdog);
  watchdog = setTimeout(checkStuckTurn, CONFIG.autoEndTurnWatchdogMs);
}

/** On and the Age still running, or the transition the Observer started is under way. */
const endsAutomatically = () => (autoEnd.get() && !isAgeEnding()) || transitionStarted || isAgeTransitionInProgress();

/** Send the turn's completion again (the engine dropped it); who sent it first is kept. */
function resendTurnComplete() {
  UI.Player.deselectAllUnits();
  GameContext.sendTurnComplete();
}

/** End the turn for the player (Auto End Turn). */
function sendTurnComplete() {
  sentAutomatically = true;
  resendTurnComplete();
}

function setStuck(on) {
  if (stuck === on) return;
  stuck = on;
  if (on) log(`turn ${Game.turn} still blocked: End Turn shown`);
  updateEndTurnButton();
}

/** End the turn now if possible; otherwise answer the blocker and retry while the turn stays open. */
function tryEndTurn() {
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!endsAutomatically() || !isObserverSeat()) return;
  try {
    if (!turnActive() || GameContext.hasSentTurnComplete() || GameContext.hasSentTurnUnreadyThisTurn()) return;
    if (isPaused() || blocked()) {
      if (!isPaused()) {
        clearBlocker(++blockedRetries === CONFIG.autoEndTurnReportRetries);
        if (blockedRetries >= CONFIG.autoEndTurnStuckRetries) setStuck(true);
      }
      retryTimer = setTimeout(tryEndTurn, CONFIG.autoEndTurnRetryMs);
      return;
    }
    blockedRetries = 0;
    setStuck(false);
    sendTurnComplete();
  } catch (e) { log(`auto end turn failed: ${e}`); }
}

/** Re-send a turn completion the engine dropped while paused. */
function recoverAfterPause() {
  if (!isObserverSeat() || isPaused()) return;
  try {
    if (turnActive() && GameContext.hasSentTurnComplete()) {
      log('re-sending turn completion after unpause');
      resendTurnComplete();
    }
  } catch (e) { log(`turn recovery failed: ${e}`); }
  tryEndTurn();
  if (endsAutomatically()) armWatchdog();
}

const later = (fn) => () => setTimeout(fn, CONFIG.autoEndTurnDelayMs);

/** Hide the End Turn button while the turn ends automatically (shown again when paused, stuck or off). */
function updateEndTurnButton() {
  if (!isObserverSeat()) return;
  setStyle(STYLE_ID, STYLE);
  document.body.classList.toggle(HIDE_CLASS, endsAutomatically() && !isPaused() && !stuck);
}

/** Turn start / Age end: refresh the button, then end the turn if it ends automatically. */
function onTurnState() {
  blockedRetries = 0;
  stuck = false;
  updateEndTurnButton();
  tryEndTurn();
  if (endsAutomatically()) armWatchdog();
}

/**
 * The Age's last turn ended by the player's click (Transition to Next Age): the
 * rest of the transition runs by itself. A turn Auto End Turn ended while the
 * Age filled up is not that click.
 */
function onTurnEnd() {
  const clicked = !sentAutomatically;
  sentAutomatically = false;
  if (transitionStarted || !clicked || !isAgeEnding()) return;
  transitionStarted = true;
  log('age transition started');
  updateEndTurnButton();
}

/**
 * The Age-transition loading screen's Continue, pressed for the Observer once
 * the next Age has loaded (single player; multiplayer has no button). Polled:
 * the game is loaded a little before it waits for the press.
 */
function beginNextAge(waitedMs = 0) {
  try {
    const game = Configuration.getGame();
    if (game.isNetworkMultiplayer || game.isHotseat || !isAgeTransitionInProgress()) return;
    if (seatKnown() && !isObserverSeat()) return;
    const state = UI.getGameLoadingState();
    if (state === UIGameLoadingState.WaitingForUIReady && isObserverSeat()) {
      log('next age loaded: continuing');
      UI.notifyUIReady();
      return;
    }
    if (state === UIGameLoadingState.GameStarted) return;
    if (waitedMs >= BEGIN_TIMEOUT_MS) { log(`next age not continued: loading state ${state}`); return; }
    if (!waitedMs) log(`next age loading: continuing once ready (state ${state})`);
    setTimeout(() => beginNextAge(waitedMs + BEGIN_POLL_MS), BEGIN_POLL_MS);
  } catch (e) { log(`begin next age failed: ${e}`); }
}

/** A pause menu opened for a multiplayer pause, not by the player (Better Balanced Multiplayer opens it for everyone). */
const openedForPause = () => !!Configuration.getGame().isNetworkMultiplayer && isPaused();

/** The pause menu the player opens switches Auto End Turn off. */
function onInterfaceMode() {
  if (autoEnd.get() && isObserverSeat() && InterfaceMode.isInInterfaceMode(PAUSE_MENU_MODE) && !openedForPause()) {
    log('pause menu: auto end turn switched off');
    setAutoEndTurn(false);
  }
}

const isAutoEndTurn = autoEnd.get;

function setAutoEndTurn(on) {
  autoEnd.set(on);
  updateEndTurnButton();
  if (autoEnd.get()) {
    tryEndTurn();
    armWatchdog();
    return;
  }
  clearTimeout(retryTimer);
  clearTimeout(watchdog);
  retryTimer = null;
  watchdog = null;
  sentAutomatically = false;   // the turn is un-readied: the player ends it from here
  try { if (Players.get(GameContext.localPlayerID)?.canUnreadyTurn) GameContext.sendUnreadyTurn(); }
  catch (e) { log(`unready failed: ${e}`); }
}

try { Loading.runWhenLoaded(() => beginNextAge()); } catch (e) { log(`begin next age not watched: ${e}`); }
onObserverReady(() => {
  engine.on('LocalPlayerTurnBegin', () => { sentAutomatically = false; });
  for (const event of ['LocalPlayerTurnBegin', 'GameAgeEnded']) engine.on(event, later(onTurnState));
  engine.on('LocalPlayerTurnEnd', onTurnEnd);
  window.addEventListener('interface-mode-changed', onInterfaceMode);
  engine.on('GamePauseStateChanged', () => { setTimeout(updateEndTurnButton, 0); later(recoverAfterPause)(); });
  later(onTurnState)();
});

export { isAutoEndTurn, setAutoEndTurn };
