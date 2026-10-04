/*
 * Zatygold's Spectator - a playable Observer for multiplayer Civilization VII.
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
 * Shared by game setup (single player) and the multiplayer lobby:
 *   - Leader and civilization move together: the Observer leader takes the
 *     Observer civilization of the game's start Age, leaving it resets the
 *     civilization to Random (the lobby calls syncSelection from its dropdowns;
 *     single player syncs every parameter change).
 *   - Single player lists the Observer civilization only for the Observer
 *     leader, and the Observer leader only for the local player.
 *   - The hidden game option ZOMObserverInGame follows whether any player is
 *     the Observer (the multiplayer host, or the single player); the modinfo
 *     loads the Observer's base-game overrides only in such a game.
 *   - Computer players never become the Observer: their leader list omits it
 *     and, when a single-player game starts, a Random leader is resolved here
 *     to a valid leader nobody else plays.
 *   - The leader-select 3D models use the game's stand-ins for the Observer.
 * Wraps GameSetup's parameter lookup / setter and engine.call; no base file edits.
 */
import LeaderSelectModelManager from 'fs://game/core/ui/shell/leader-select/leader-select-model-manager.js';
import { installAssetAliases } from '../shared/zom-assets.js';
import { createLogger, isObserverCiv, OBSERVER_CIV_PREFIX, OBSERVER_LEADER, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './setup-config.js';

const PARAM_LEADER = 'PlayerLeader';
const PARAM_CIV = 'PlayerCivilization';
const PARAM_OBSERVER_IN_GAME = 'ZOMObserverInGame';
const RANDOM = 'RANDOM';
const NO_TEAM = -1;

const log = CONFIG.debug ? createLogger('setup-observer') : () => {};
const logged = new Set();
const logOnce = (key, message) => { if (!logged.has(key)) { logged.add(key); log(message); } };

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

function observerCivForStartAge() {
  return OBSERVER_CIV_PREFIX + startAgeType().replace(/^AGE_/, '');
}

function isMultiplayerSetup() {
  try { return !!Configuration.getGame().isAnyMultiplayer; } catch (e) { return true; }   // unknown: leave single-player rules off
}

// ============================ Players ============================

function playerLeader(playerID) {
  try { return Configuration.getPlayer(playerID)?.leaderTypeName ?? ''; } catch (e) { return ''; }
}

function playerCiv(playerID) {
  try { return Configuration.getPlayer(playerID)?.civilizationTypeName ?? ''; } catch (e) { return ''; }
}

function isObserverRow(playerID) {
  return playerLeader(playerID) === OBSERVER_LEADER || isObserverCiv(playerCiv(playerID));
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

// ============================ Selection sync ============================

/** Leader and civ move together: Observer leader <-> Observer civ, team cleared. */
function syncSelection(playerID, param, value) {
  const civ = observerCivForStartAge();
  if (param === PARAM_LEADER) {
    if (value === OBSERVER_LEADER) {
      if (playerCiv(playerID) !== civ) setParam(playerID, PARAM_CIV, civ);
      setTeam(playerID, NO_TEAM);
      log(`player ${playerID} -> observer (${civ})`);
    } else if (isObserverCiv(playerCiv(playerID))) {
      setParam(playerID, PARAM_CIV, RANDOM);
      log(`player ${playerID} left observer; civ reset`);
    }
  } else if (param === PARAM_CIV) {
    if (isObserverCiv(value)) {
      if (value !== civ) setParam(playerID, PARAM_CIV, civ);
      if (playerLeader(playerID) !== OBSERVER_LEADER) setParam(playerID, PARAM_LEADER, OBSERVER_LEADER);
      setTeam(playerID, NO_TEAM);
      log(`player ${playerID} -> observer via civ`);
    } else if (playerLeader(playerID) === OBSERVER_LEADER) {
      setParam(playerID, PARAM_LEADER, RANDOM);
      log(`player ${playerID} left observer via civ; leader reset`);
    }
  }
}

// ============================ Observer-in-game flag ============================

let flagQueued = false;

/** Only the multiplayer host writes game options; a single player always can. */
function canWriteGameOptions() {
  if (!isMultiplayerSetup()) return true;
  try { return Network.getHostPlayerId() === GameContext.localPlayerID; } catch (e) { return false; }
}

/** The hidden game option follows whether any player is the Observer. */
function syncObserverFlag() {
  flagQueued = false;
  if (!canWriteGameOptions()) return;
  try {
    const slots = Configuration.getMap().maxMajorPlayers ?? 0;
    let anyObserver = false;
    for (let id = 0; id < slots && !anyObserver; id++) anyObserver = playerLeader(id) === OBSERVER_LEADER;
    const current = !!GameSetup.findGameParameter(PARAM_OBSERVER_IN_GAME)?.value?.value;
    if (current !== anyObserver) {
      GameSetup.setGameParameterValue(PARAM_OBSERVER_IN_GAME, anyObserver);
      log(`observer-in-game flag -> ${anyObserver}`);
    }
  } catch (e) { log(`observer flag sync failed: ${e}`); }
}

function queueObserverFlag() {
  if (flagQueued) return;
  flagQueued = true;
  setTimeout(syncObserverFlag, 0);
}

// ============================ Parameter lists ============================

const valueOf = (entry) => entry?.value?.toString() ?? '';

/** keep(value) applied to a parameter's possible values, as a copy. */
function filterValues(param, keep) {
  const values = param?.domain?.possibleValues;
  if (!Array.isArray(values)) return param;
  return { ...param, domain: { ...param.domain, possibleValues: values.filter((v) => keep(valueOf(v))) } };
}

function shapeParameter(playerID, paramName, param) {
  if (paramName === PARAM_LEADER && isComputerSlot(playerID)) {
    logOnce(`leader-${playerID}`, `Spectator hidden from computer player ${playerID}`);
    return filterValues(param, (v) => v !== OBSERVER_LEADER);
  }
  if (paramName === PARAM_LEADER && playerID === GameContext.localPlayerID) {
    const entry = param?.domain?.possibleValues?.find((v) => valueOf(v) === OBSERVER_LEADER);
    logOnce('leader-local', entry ? `Spectator offered to the local player (invalidReason ${entry.invalidReason})` : 'Spectator missing from the local leader list');
  }
  if (paramName !== PARAM_CIV || isMultiplayerSetup()) return param;
  if (playerLeader(playerID) === OBSERVER_LEADER) {
    const civ = observerCivForStartAge();
    const shaped = filterValues(param, (v) => v === civ);
    return shaped?.domain?.possibleValues?.length ? shaped : filterValues(param, isObserverCiv);   // unknown Age: any Observer civ
  }
  return filterValues(param, (v) => !isObserverCiv(v));
}

// ============================ Computer leaders ============================

/** Single player, at game start: every computer player on Random gets a concrete leader, never the Observer. */
function resolveComputerLeaders() {
  const ids = [...(Configuration.getGame().participatingPlayerIDs ?? [])];
  const taken = new Set(ids.map(playerLeader).filter((leader) => leader && leader !== RANDOM));
  for (const id of ids) {
    if (!isComputerSlot(id) || playerLeader(id) !== RANDOM) continue;
    const pool = (GameSetup.findPlayerParameter(id, PARAM_LEADER)?.domain?.possibleValues ?? [])
      .filter((v) => v.invalidReason === GameSetupDomainValueInvalidReason.Valid)
      .map(valueOf)
      .filter((leader) => leader && leader !== RANDOM && leader !== OBSERVER_LEADER && !taken.has(leader));
    if (pool.length === 0) continue;
    const leader = pool[Math.floor(Math.random() * pool.length)];
    if (setParam(id, PARAM_LEADER, leader)) taken.add(leader);
    log(`computer player ${id}: Random -> ${leader}`);
  }
}

// ============================ Installation ============================

function install() {
  installAssetAliases(LeaderSelectModelManager.leaderSelectModelGroup, LeaderSelectModelManager.leaderPedestalModelGroup);

  wrapMethod(GameSetup, 'findPlayerParameter', (base, playerID, paramName, ...rest) => {
    const param = base(playerID, paramName, ...rest);
    try { return param ? shapeParameter(playerID, paramName, param) : param; } catch (e) { return param; }
  });

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

  wrapMethod(engine, 'call', (base, name, ...args) => {
    if (name === 'startGame' && !isMultiplayerSetup()) {
      if (CONFIG.resolveComputerLeaders) {
        try { resolveComputerLeaders(); } catch (e) { log(`computer leaders failed: ${e}`); }
      }
      syncObserverFlag();
    }
    return base(name, ...args);
  });

  log(`setup rules installed (start-age civ: ${observerCivForStartAge()})`);
}

if (CONFIG.observerRole !== false) {
  try { install(); } catch (e) { log(`install failed: ${e}`); }
}

export { isObserverRow, observerCivForStartAge, playerCiv, playerLeader, queueObserverFlag, setParam, setTeam, syncSelection };
