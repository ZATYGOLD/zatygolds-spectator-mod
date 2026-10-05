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
 * Zatygold's Spectator - Observer setup rules (shell scope).
 *
 * Shared by single-player setup and the lobby: the Observer leader and the
 * start Age's Observer civilization move together; only the local player may be
 * the Observer (never a computer, never through Random); the hidden option
 * ZOMObserverInGame tracks whether anyone observes; the Observer plays no
 * mementos; leader-select models use the game's stand-ins.
 */
import LeaderSelectModelManager from 'fs://game/core/ui/shell/leader-select/leader-select-model-manager.js';
import { installAssetAliases } from '../shared/zom-assets.js';
import { configCiv, configLeader, createLogger, deferOnce, filterParamValues, isObserverCiv, OBSERVER_LEADER, observerCivForAge, paramValue, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './setup-config.js';

const PARAM_LEADER = 'PlayerLeader';
const PARAM_CIV = 'PlayerCivilization';
const PARAM_AGE = 'Age';
const MEMENTO_SLOT = /^PlayerMemento\w*Slot/;   // every memento slot, other mods' too (Multiplayer Balance Mod adds PlayerMementoMinorSlot2), as config/setup-rules.sql
const NO_MEMENTO = 'NONE';
const PARAM_OBSERVER_IN_GAME = 'ZOMObserverInGame';
const RANDOM = 'RANDOM';
const NO_TEAM = -1;

const log = createLogger('setup-observer', CONFIG.debug);
const logged = new Set();
const debugOnce = (key, message) => { if (!logged.has(key)) { logged.add(key); log.debug(message); } };

// ============================ Game state ============================

/**
 * The game's start Age. The game config only exposes the Age's display key
 * (LOC_AGE_ANTIQUITY_NAME), so it is resolved to the AgeType through the setup
 * database, with a name-strip fallback.
 */
let ageRows = null;
let lastStartAge = 'AGE_ANTIQUITY';
function startAgeType() {
  let name = '';
  try { name = Configuration.getGame().startAgeName || ''; } catch (e) { /* unknown */ }
  if (!name) return lastStartAge;
  try { ageRows ??= Database.query('config', 'select AgeType, Name from Ages') ?? []; } catch (e) { ageRows = []; }
  lastStartAge = ageRows.find((r) => r.Name === name)?.AgeType ?? name.replace(/^LOC_/, '').replace(/_NAME$/, '');
  return lastStartAge;
}

const observerCivForStartAge = () => observerCivForAge(startAgeType());

function isMultiplayerSetup() {
  try { return !!Configuration.getGame().isAnyMultiplayer; } catch (e) { return true; }   // unknown: leave single-player rules off
}

// ============================ Players ============================

const isLocalObserver = () => configLeader(GameContext.localPlayerID) === OBSERVER_LEADER;

function isObserverRow(playerID) {
  return configLeader(playerID) === OBSERVER_LEADER || isObserverCiv(configCiv(playerID));
}

/** A computer player's slot: never the local player (single-player setup may report its slot as a computer one). */
function isComputerSlot(playerID) {
  if (playerID === GameContext.localPlayerID) return false;
  try { return !!Configuration.getPlayer(playerID)?.isAI; } catch (e) { return false; }
}

function setParam(playerID, param, value) {
  try { GameSetup.setPlayerParameterValue(playerID, param, value); return true; }
  catch (e) { log(`set ${param}=${value} failed for ${playerID}: ${e}`); return false; }
}

function setTeam(playerID, team) {
  try { Configuration.editPlayer(playerID)?.setTeam(team); } catch (e) { /* ignore */ }
}

/** Unequip the player's mementos (the Observer plays none; config/setup-rules.sql turns its slots off). */
function clearMementos(playerID) {
  const slots = (GameSetup.getPlayerParameters(playerID) ?? []).map((p) => GameSetup.resolveString(p.ID)).filter((id) => MEMENTO_SLOT.test(id ?? ''));
  for (const param of slots) {
    const value = GameSetup.findPlayerParameter(playerID, param)?.value?.value;
    if (value && value !== NO_MEMENTO) setParam(playerID, param, NO_MEMENTO);
  }
}

// ============================ Selection sync ============================

/** Leader and civ move together: Observer leader <-> Observer civ, team cleared. */
function syncSelection(playerID, param, value) {
  const civ = observerCivForStartAge();
  if (param === PARAM_LEADER) {
    if (value === OBSERVER_LEADER) {
      clearMementos(playerID);
      if (configCiv(playerID) !== civ) setParam(playerID, PARAM_CIV, civ);
      setTeam(playerID, NO_TEAM);
      log.debug(`player ${playerID} -> observer (${civ})`);
    } else if (isObserverCiv(configCiv(playerID))) {
      setParam(playerID, PARAM_CIV, RANDOM);
      log.debug(`player ${playerID} left observer; civ reset`);
    }
  } else if (param === PARAM_CIV) {
    if (isObserverCiv(value)) {
      if (value !== civ) setParam(playerID, PARAM_CIV, civ);
      if (configLeader(playerID) !== OBSERVER_LEADER) { clearMementos(playerID); setParam(playerID, PARAM_LEADER, OBSERVER_LEADER); }
      setTeam(playerID, NO_TEAM);
      log.debug(`player ${playerID} -> observer via civ`);
    } else if (configLeader(playerID) === OBSERVER_LEADER) {
      setParam(playerID, PARAM_LEADER, RANDOM);
      log.debug(`player ${playerID} left observer via civ; leader reset`);
    }
  }
}

/** Single player: a new start Age moves every Observer to that Age's Observer civilization. */
function syncObserverCivsToAge() {
  const civ = observerCivForStartAge();
  for (const id of Configuration.getGame().participatingPlayerIDs ?? []) {
    if (configLeader(id) === OBSERVER_LEADER && configCiv(id) !== civ && setParam(id, PARAM_CIV, civ)) log.debug(`player ${id} -> ${civ} (start Age)`);
  }
}

// ============================ Observer-in-game flag ============================

/** Only the multiplayer host writes game options; a single player always can. */
function canWriteGameOptions() {
  if (!isMultiplayerSetup()) return true;
  try { return Network.getHostPlayerId() === GameContext.localPlayerID; } catch (e) { return false; }
}

/** The hidden game option follows whether any player is the Observer. */
function syncObserverFlag() {
  if (!canWriteGameOptions()) return;
  try {
    const slots = Configuration.getMap().maxMajorPlayers ?? 0;
    let anyObserver = false;
    for (let id = 0; id < slots && !anyObserver; id++) anyObserver = configLeader(id) === OBSERVER_LEADER;
    const current = !!GameSetup.findGameParameter(PARAM_OBSERVER_IN_GAME)?.value?.value;
    if (current !== anyObserver) {
      GameSetup.setGameParameterValue(PARAM_OBSERVER_IN_GAME, anyObserver);
      log.debug(`observer-in-game flag -> ${anyObserver}`);
    }
  } catch (e) { log(`observer flag sync failed: ${e}`); }
}

const queueObserverFlag = deferOnce(syncObserverFlag);

// ============================ Parameter lists ============================

function shapeParameter(playerID, paramName, param) {
  if (paramName === PARAM_LEADER && isComputerSlot(playerID)) {
    debugOnce(`leader-${playerID}`, `Spectator hidden from computer player ${playerID}`);
    return filterParamValues(param, (v) => v !== OBSERVER_LEADER);
  }
  if (paramName === PARAM_LEADER && playerID === GameContext.localPlayerID) {
    const entry = param?.domain?.possibleValues?.find((v) => paramValue(v) === OBSERVER_LEADER);
    debugOnce('leader-local', entry ? `Spectator offered to the local player (invalidReason ${entry.invalidReason})` : 'Spectator missing from the local leader list');
  }
  if (paramName !== PARAM_CIV || isMultiplayerSetup()) return param;
  if (configLeader(playerID) === OBSERVER_LEADER) {
    const civ = observerCivForStartAge();
    const shaped = filterParamValues(param, (v) => v === civ);
    return shaped?.domain?.possibleValues?.length ? shaped : filterParamValues(param, isObserverCiv);   // unknown Age: any Observer civ
  }
  return filterParamValues(param, (v) => !isObserverCiv(v));
}

// ============================ Random leaders ============================

/** Single player, at game start: every player on Random (computer or not) gets a concrete leader, never the Observer. */
function resolveRandomLeaders() {
  const ids = [...(Configuration.getGame().participatingPlayerIDs ?? [])];
  const taken = new Set(ids.map(configLeader).filter((leader) => leader && leader !== RANDOM));
  for (const id of ids) {
    if (configLeader(id) !== RANDOM) continue;
    const pool = (GameSetup.findPlayerParameter(id, PARAM_LEADER)?.domain?.possibleValues ?? [])
      .filter((v) => v.invalidReason === GameSetupDomainValueInvalidReason.Valid)
      .map(paramValue)
      .filter((leader) => leader && leader !== RANDOM && leader !== OBSERVER_LEADER && !taken.has(leader));
    if (pool.length === 0) continue;
    const leader = pool[Math.floor(Math.random() * pool.length)];
    if (setParam(id, PARAM_LEADER, leader)) taken.add(leader);
    log.debug(`player ${id}: Random -> ${leader}`);
  }
}

// ============================ Installation ============================

function install() {
  installAssetAliases(LeaderSelectModelManager.leaderSelectModelGroup, LeaderSelectModelManager.leaderPedestalModelGroup);

  wrapMethod(GameSetup, 'findPlayerParameter', (base, playerID, paramName, ...rest) => {
    const param = base(playerID, paramName, ...rest);
    try { return param ? shapeParameter(playerID, paramName, param) : param; } catch (e) { return param; }
  });

  // Memento screens (single player, multiplayer editor) list no slots for the Observer.
  wrapMethod(GameSetup, 'getMementoFilteredPlayerParameters', (base, playerID, ...rest) =>
    (configLeader(playerID) === OBSERVER_LEADER ? [] : base(playerID, ...rest)));

  let syncing = false;
  wrapMethod(GameSetup, 'setPlayerParameterValue', (base, playerID, paramName, value, ...rest) => {
    const result = base(playerID, paramName, value, ...rest);
    if (!syncing && !isMultiplayerSetup() && (paramName === PARAM_LEADER || paramName === PARAM_CIV)) {
      syncing = true;
      try { syncSelection(playerID, paramName, value?.toString?.() ?? value); } catch (e) { log(`sync failed: ${e}`); }
      finally { syncing = false; }
      queueObserverFlag();
    }
    return result;
  });

  wrapMethod(GameSetup, 'setGameParameterValue', (base, paramName, ...rest) => {
    const result = base(paramName, ...rest);
    if (paramName === PARAM_AGE && !isMultiplayerSetup()) {
      try { syncObserverCivsToAge(); } catch (e) { log(`age sync failed: ${e}`); }
    }
    return result;
  });

  wrapMethod(engine, 'call', (base, name, ...args) => {
    if (name === 'startGame' && !isMultiplayerSetup()) {
      if (CONFIG.resolveRandomLeaders) {
        try { resolveRandomLeaders(); } catch (e) { log(`random leaders failed: ${e}`); }
      }
      syncObserverFlag();
    }
    return base(name, ...args);
  });

  log.debug(`setup rules installed (start-age civ: ${observerCivForStartAge()})`);
}

if (CONFIG.observerRole !== false) {
  try { install(); } catch (e) { log(`install failed: ${e}`); }
}

export { isComputerSlot, isLocalObserver, isObserverRow, NO_TEAM, observerCivForStartAge, PARAM_LEADER, queueObserverFlag, setParam, setTeam, syncSelection };
