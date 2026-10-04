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
 * Zatygold's Spectator - 3D asset aliases (shell and game scope).
 *
 * The Observer has no leader model or civilization banner. Screens build asset
 * names from the leader / civ type (LEADER_X_GAME_ASSET, CIVILIZATION_X_BANNER_GAME_ASSET)
 * and some never fall back, so a missing asset reached the engine (the old
 * single-player crash). Every model group swaps the Observer's names for the
 * game's own stand-ins before they reach the engine.
 */
import { OBSERVER_CIV_PREFIX, OBSERVER_LEADER } from './zom-util.js';

const LEADER_ASSET = `${OBSERVER_LEADER}_GAME_ASSET`;
const BANNER_ASSET = new RegExp(`^${OBSERVER_CIV_PREFIX}\\w+_BANNER_GAME_ASSET$`);
const STAND_INS = {
  shell: { leader: 'LEADER_RANDOMIZED_GAME_ASSET', banner: 'CIVILIZATION_RANDOM_BANNER_GAME_ASSET' },   // the Random leader's silhouette (setup screens)
  game: { leader: 'LEADER_FALLBACK_GAME_ASSET', banner: 'CIVILIZATION_DEFAULT_BANNER_GAME_ASSET' }       // diplomacy scenes' own fallbacks
};
const PATCHED = Symbol('zomAssetAliases');

function standIns() {
  try { return UI.isInShell() ? STAND_INS.shell : STAND_INS.game; } catch (e) { return STAND_INS.game; }
}

/** The asset to load in place of name (name itself unless it is one of the Observer's). */
function aliasAsset(name) {
  if (name === LEADER_ASSET) return standIns().leader;
  if (typeof name === 'string' && BANNER_ASSET.test(name)) return standIns().banner;
  return name;
}

function patchModel(model) {
  if (!model || model[PATCHED] || typeof model.setAssetName !== 'function') return model;
  const base = model.setAssetName;
  model.setAssetName = function (name, ...rest) { return base.call(this, aliasAsset(name), ...rest); };
  model[PATCHED] = true;
  return model;
}

function patchModelGroup(group) {
  if (!group || group[PATCHED]) return group;
  for (const method of ['addModel', 'addModelAtPos']) {
    const base = group[method];
    if (typeof base !== 'function') continue;
    group[method] = function (name, ...rest) { return patchModel(base.call(this, aliasAsset(name), ...rest)); };
  }
  group[PATCHED] = true;
  return group;
}

/** Alias assets in every model group created from now on, and in the given existing groups. */
function installAssetAliases(...existingGroups) {
  if (!WorldUI[PATCHED]) {
    const base = WorldUI.createModelGroup;
    WorldUI.createModelGroup = function (...args) { return patchModelGroup(base.apply(this, args)); };
    WorldUI[PATCHED] = true;
  }
  existingGroups.forEach(patchModelGroup);
}

export { aliasAsset, installAssetAliases };
