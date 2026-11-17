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
 * Zatygold's Spectator - Observer settler lens (in-game scope).
 *
 * The settler lens asks the local player where it may settle: for the
 * Observer, whose home is the ice, every other land is Distant Lands (closed
 * in Antiquity), and it has no settlers to recommend sites for. In a
 * Perspective the lens answers for the viewed leader, recommendations
 * included; otherwise a plot is open when any watched leader may settle it
 * (no recommendations).
 */
import LensManager from 'fs://game/core/ui/lenses/lens-manager.js';
import 'fs://game/base-standard/ui/lenses/layer/appeal-layer.js';
import 'fs://game/base-standard/ui/lenses/layer/settlement-recommendations-layer.js';
import { createLogger, withReplaced, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, onObserverReady, watchedPlayers } from './observer-core.js';
import { PERSPECTIVE_CHANGED_EVENT, perspectivePlayer } from './observer-perspective.js';

const APPEAL_LAYER = 'fxs-appeal-layer';
const RECOMMENDATIONS_LAYER = 'fxs-settlement-recommendations-layer';

const log = createLogger('observer-settler-lens', CONFIG.debug);

/** Run fn with Players.get(local player) answering stand-in(get). */
function asLocalPlayer(standIn, fn) {
  const get = Players.get;
  const local = GameContext.localPlayerID;
  return withReplaced(Players, 'get', (id, ...rest) => (id === local ? standIn(get) : get.call(Players, id, ...rest)), fn);
}

/** The viewed leader, or one whose land claims hold where any watched leader's do. */
function claimant(get) {
  const viewed = perspectivePlayer();
  if (viewed != null) return get.call(Players, viewed);
  const leaders = watchedPlayers();
  return { Diplomacy: { isValidLandClaimLocation: (...args) => leaders.some((p) => p.Diplomacy?.isValidLandClaimLocation?.(...args)) } };
}

function patchLayers() {
  const appeal = LensManager.layers.get(APPEAL_LAYER);
  const recommendations = LensManager.layers.get(RECOMMENDATIONS_LAYER);
  if (!wrapMethod(appeal, 'applyLayer', (base, ...args) => asLocalPlayer(claimant, () => base(...args)))) log('appeal layer not patched');
  if (!wrapMethod(recommendations, 'applyLayer', (base, ...args) => {
    const viewed = perspectivePlayer();
    return viewed == null ? undefined : asLocalPlayer((get) => get.call(Players, viewed), () => base(...args));
  })) log('recommendations layer not patched');
  return { appeal, recommendations };
}

/** A Perspective change redraws an open settler lens for the new view. */
function redrawOnPerspective({ appeal, recommendations }) {
  window.addEventListener(PERSPECTIVE_CHANGED_EVENT, () => {
    try {
      if (LensManager.isLayerEnabled(APPEAL_LAYER)) appeal.applyLayer();
      if (LensManager.isLayerEnabled(RECOMMENDATIONS_LAYER)) { recommendations.removeLayer(); recommendations.applyLayer(); }
    } catch (e) { log(`settler lens not redrawn: ${e}`); }
  });
}

onObserverReady(() => {
  if (!isObserverSeat()) return;
  try { redrawOnPerspective(patchLayers()); } catch (e) { log(`settler lens not patched: ${e}`); }
});
