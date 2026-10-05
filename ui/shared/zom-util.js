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
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';

/**
 * Zatygold's Spectator - shared helpers (shell and game scope).
 *
 * Logging, method wrapping, deferred component patching, DOM and game-data
 * lookups used by every feature, plus Observer identity (the Observer is a
 * real player whose leader is LEADER_ZOM_OBSERVER).
 */
const OBSERVER_LEADER = 'LEADER_ZOM_OBSERVER';
const OBSERVER_CIV_PREFIX = 'CIVILIZATION_ZOM_OBSERVER_';

/** True for any Age's Observer civilization type name. */
function isObserverCiv(civType) { return typeof civType === 'string' && civType.startsWith(OBSERVER_CIV_PREFIX); }

/** The Observer civilization of an Age (AGE_ANTIQUITY -> CIVILIZATION_ZOM_OBSERVER_ANTIQUITY). */
function observerCivForAge(ageType) { return OBSERVER_CIV_PREFIX + ageType.replace(/^AGE_/, ''); }

// ============================ Logging ============================

const noop = () => {};

/**
 * Logger that reaches UI.log (console.log output does not); log.debug writes
 * only when debug is on.
 */
function createLogger(tag, debug = false) {
  const log = (message) => { try { console.warn(`[ZOM ${tag}] ${message}`); } catch (e) { /* ignore */ } };
  log.debug = debug ? log : noop;
  return log;
}

// ============================ Patching ============================

/**
 * Replace target[name] with wrapper(base, ...args). The wrapper runs with the
 * call's receiver as `this`, and base calls the original on that receiver, so
 * it works for singletons and prototypes alike.
 */
function wrapMethod(target, name, wrapper) {
  const base = target?.[name];
  if (typeof base !== 'function') return false;
  target[name] = function (...args) { return wrapper.call(this, (...a) => base.apply(this, a), ...args); };
  return true;
}

/**
 * Register wrap(current factory) as a ui-next component's factory. A
 * component is resolved when each instance is created, so the override
 * reaches every instance created from now on (not ones already rendered).
 * Returns whether the component was registered.
 */
function overrideComponent(name, wrap, priority = 1) {
  const base = ComponentRegistry.get(name)?.factory();
  if (!base) return false;
  ComponentRegistry.register(name, wrap(base), priority);
  return true;
}

/** Run callback(definition) once the UI component tag is defined, retrying a bounded number of times. */
function whenDefined(tag, callback, { retries = 50, intervalMs = 200, log = null } = {}) {
  let definition = null;
  try { definition = Controls.getDefinition(tag); } catch (e) { definition = null; }
  if (definition?.createInstance) { callback(definition); return; }
  if (retries > 0) setTimeout(() => whenDefined(tag, callback, { retries: retries - 1, intervalMs, log }), intervalMs);
  else log?.(`${tag} was never defined`);
}

/** A function that runs fn once after the current call stack, however often it is called before then. */
function deferOnce(fn, delayMs = 0) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; fn(); }, delayMs);
  };
}

// ============================ DOM ============================

/** The nearest element from el upwards (el included) that matches the test, or null. */
function findAncestor(el, test) {
  for (let node = el; node && typeof node.getAttribute === 'function'; node = node.parentElement) {
    if (test(node)) return node;
  }
  return null;
}

function clearChildren(el) {
  while (el?.firstChild) el.removeChild(el.firstChild);
}

/** The stylesheet with this id, created on first use; its text is rewritten only when it changes. */
function setStyle(id, css) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// ============================ Game data ============================

/** A leader's type name from its hash, or fallback. */
function leaderTypeOf(leaderHash, fallback = 'UNKNOWN_LEADER') {
  try { return GameInfo.Leaders.lookup(leaderHash)?.LeaderType ?? fallback; } catch (e) { return fallback; }
}

/** The current Age's chronology index (0 = Antiquity). */
function currentAgeChronology() {
  try { return GameInfo.Ages.lookup(Game.age)?.ChronologyIndex ?? 0; } catch (e) { return 0; }
}

/** True while an Age transition is processing. */
function isAgeTransitionInProgress() {
  try { return Modding.getTransitionInProgress?.() === TransitionType.Age; } catch (e) { return false; }
}

/**
 * True from the moment a non-final Age is complete (its progress is full, the
 * HUD's action turns into the Age transition) until the next Age loads.
 */
function isAgeEnding() {
  if (isAgeTransitionInProgress()) return true;
  try {
    const ages = Game.AgeProgressManager;
    if (!ages || ages.isFinalAge || ages.isExtendedGame) return false;
    const max = ages.getMaxAgeProgressionPoints();
    return !!ages.isAgeOver || (max > 0 && ages.getCurrentAgeProgressionPoints() >= max);
  } catch (e) { return false; }
}

// ============================ Setup parameters ============================

/** A player slot's leader type name in the game configuration ('' if unknown). */
function configLeader(playerId) {
  try { return Configuration.getPlayer(playerId)?.leaderTypeName ?? ''; } catch (e) { return ''; }
}

const paramValue = (entry) => entry?.value?.toString() ?? '';

/** A setup parameter with only the possible values keep(value) accepts, as a copy (the parameter itself if it has no list). */
function filterParamValues(param, keep) {
  const values = param?.domain?.possibleValues;
  if (!Array.isArray(values)) return param;
  return { ...param, domain: { ...param.domain, possibleValues: values.filter((v) => keep(paramValue(v))) } };
}

// ============================ Observer identity ============================

/** Observer by leader; cached per player id (a player's leader is fixed for the life of the UI). */
const observerById = new Map();
function isObserverPlayer(playerId) {
  if (observerById.has(playerId)) return observerById.get(playerId);
  try {
    const leader = GameInfo.Leaders.lookup(Players.get(playerId)?.leaderType);
    if (!leader) return false;   // not resolvable yet: ask again next time
    const observer = leader.LeaderType === OBSERVER_LEADER;
    observerById.set(playerId, observer);
    return observer;
  } catch (e) { return false; }
}

export {
  OBSERVER_CIV_PREFIX, OBSERVER_LEADER, clamp, clearChildren, configLeader, createLogger, currentAgeChronology, deferOnce,
  filterParamValues, findAncestor, isAgeEnding, isAgeTransitionInProgress, isObserverCiv, isObserverPlayer, leaderTypeOf,
  observerCivForAge, overrideComponent, paramValue, setStyle, whenDefined, wrapMethod
};
