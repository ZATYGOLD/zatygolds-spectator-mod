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
 * Zatygold's Spectator - Observer's Eye (in-game scope).
 *
 * The Observer's only unit is the Eye (data/units.xml), made on marine ice by
 * the map script: its sight covers the whole map, so every unit shows live.
 * Its flag is hidden for every seat (other players may still come in sight of
 * it), and the Observer seat keeps it asleep (with 1 move it would ask for
 * orders every turn); it is never selected (observer-units.js).
 * The Eye sees every plot all game, so the Observer's remembered constructibles
 * are never refreshed: after a reload they show discoveries long gone. Outside
 * a Perspective the Observer's lookups read the live map instead.
 */
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { createLogger, isObserverPlayer, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, onObserverReady } from './observer-core.js';
import { isPerspectiveActive } from './observer-perspective.js';

const log = createLogger('observer-eye', CONFIG.debug);
const SLEEP_OPERATION = 'UNITOPERATION_SLEEP';

const ownUnits = () => Players.get(GameContext.localPlayerID)?.Units?.getUnits?.() ?? [];

function sleepUnits() {
  if (!isObserverSeat()) return;
  for (const unit of ownUnits()) {
    try {
      if (Game.UnitOperations.canStart(unit.id, SLEEP_OPERATION, {}, false)?.Success) Game.UnitOperations.sendRequest(unit.id, SLEEP_OPERATION, {});
    } catch (e) { log(`sleep failed: ${e}`); }
  }
}

const isEyeFlag = (flag) => { try { return isObserverPlayer(flag.componentID?.owner); } catch (e) { return false; } };

function hideEyeFlags() {
  const proto = GenericUnitFlag.prototype;
  wrapMethod(proto, 'onAttach', function (base, ...args) {
    const result = base(...args);
    if (isEyeFlag(this)) this.hide();
    return result;
  });
  wrapMethod(proto, 'show', function (base, ...args) { return isEyeFlag(this) ? this.hide() : base(...args); });
}

function readLiveConstructibles() {
  const live = MapConstructibles.getConstructibles;
  if (!wrapMethod(MapConstructibles, 'getHiddenFilteredConstructibles', (base, x, y, ...rest) =>
    (isPerspectiveActive() ? base(x, y, ...rest) : live.call(MapConstructibles, x, y)))) log('constructible lookups not patched');
}

/** Debug: where the Eye is, and how many other units are on visible plots. */
function logVision() {
  const me = GameContext.localPlayerID;
  const eyes = ownUnits().map((u) => `${u.location?.x},${u.location?.y}`).join(' ');
  let total = 0, visible = 0;
  for (const player of Players.getAlive()) {
    if (isObserverPlayer(player.id)) continue;
    for (const unit of player.Units?.getUnits?.() ?? []) {
      total++;
      const loc = unit.location;
      if (loc && GameplayMap.getRevealedState(me, loc.x, loc.y) === RevealedStates.VISIBLE) visible++;
    }
  }
  log.debug(`eye at [${eyes}], units on visible plots: ${visible}/${total}`);
}

hideEyeFlags();
onObserverReady(() => {
  readLiveConstructibles();
  engine.on('LocalPlayerTurnBegin', sleepUnits);
  engine.on('UnitAddedToMap', (data) => { if (data?.unit?.owner === GameContext.localPlayerID) sleepUnits(); });
  sleepUnits();
  if (CONFIG.debug) {
    engine.on('LocalPlayerTurnBegin', logVision);
    logVision();
  }
});
