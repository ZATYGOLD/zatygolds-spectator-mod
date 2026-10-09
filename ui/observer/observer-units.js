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
 * Zatygold's Spectator - Observer units (in-game scope).
 *
 * Lets the Observer select other players' units with the game's own selection
 * (so the unit panel shows them, a commander's with its promotions to view),
 * and guards every step that assumes ownership: no move / attack decorations
 * (they stall the renderer), no orders sent and no promotions bought.
 */
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import UnitSelection from 'fs://game/base-standard/ui/unit-selection/unit-selection.js';
import { UnitMapDecorationSupport } from 'fs://game/base-standard/ui/interface-modes/support-unit-map-decoration.js';
import { InterfaceMode } from 'fs://game/core/ui/interface-modes/interface-modes.js';
import { InputHandlerState } from 'fs://game/core/ui/input/input-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { createLogger, findAncestor, isObserverPlayer, setStyle, whenDefined, wrapMethod } from '../shared/zom-util.js';
import { isObserverSeat, onObserverReady } from './observer-core.js';

const log = createLogger('observer-units');
const PROMOTE = 'UNITCOMMAND_PROMOTE';
const READ_ONLY_CLASS = 'zom-observer-read-only';
const STYLE_ID = 'zom-observer-units-style';

/** True when the Observer seat is looking at a unit it does not own. */
function isForeign(unitId) {
  return isObserverSeat() && !!unitId && ComponentID.isValid(unitId) && unitId.owner !== GameContext.localPlayerID;
}

/** Units on a tile the Observer can inspect (other players' units only). */
function inspectableUnits(x, y) {
  try { return MapUnits.getUnits(x, y).filter((id) => !isObserverPlayer(id.owner)); }
  catch (e) { return []; }
}

// ============================ Selection ============================

function selectUnit(unitId) {
  UI.Player.selectUnit(unitId);
  if (!ComponentID.isMatch(UI.Player.getHeadSelectedUnit(), unitId)) log(`selection refused for ${ComponentID.toLogString(unitId)}`);
}

/** Unit flags only select the local player's units; for the Observer they select any other unit. */
function onEngineInput(ev) {
  const d = ev.detail;
  if (!d || d.status !== InputActionStatuses.FINISH || d.name !== 'mousebutton-left' || !isObserverSeat()) return;
  const flag = findAncestor(ev.target, (el) => !!el.getAttribute('unit-id'));
  const unitId = flag ? ComponentID.fromString(flag.getAttribute('unit-id')) : null;
  if (!isForeign(unitId)) return;
  selectUnit(unitId);
  ev.stopPropagation();
  ev.preventDefault();
}

function patchSelection() {
  wrapMethod(WorldInput, 'handleSelectedPlotUnit', (base, location, ...rest) => {
    if (!isObserverSeat()) return base(location, ...rest);
    const units = inspectableUnits(location.x, location.y);
    if (units.length === 0) return true;
    const current = units.findIndex((id) => ComponentID.isMatch(id, UI.Player.getHeadSelectedUnit()));
    selectUnit(units[(current + 1) % units.length]);
    return false;
  });
  wrapMethod(UnitSelection, 'trySwitchToUnitSelectedMode', (base, unitId, ...rest) => {
    if (!isForeign(unitId)) return base(unitId, ...rest);
    return InterfaceMode.isInInterfaceMode('INTERFACEMODE_UNIT_SELECTED') || InterfaceMode.switchTo('INTERFACEMODE_UNIT_SELECTED', { UnitID: unitId });
  });
}

// ============================ Guards ============================

function patchGuards() {
  const decorations = UnitMapDecorationSupport.manager;
  const headIsForeign = () => isForeign(UI.Player.getHeadSelectedUnit());
  const guards = [
    [decorations, 'activate', (base, unitId, ...rest) => (isForeign(unitId) ? undefined : base(unitId, ...rest))],
    [decorations, 'update', (base, ...args) => (isForeign(decorations.unitID) ? undefined : base(...args))],
    [WorldInput, 'doActionOnPlot', (base, ...args) => (headIsForeign() ? undefined : base(...args))],
    [WorldInput, 'actionMouseRightButton', (base, ...args) => (headIsForeign() ? InputHandlerState.Handled : base(...args))],
    [WorldInput, 'requestMoveOperation', (base, unitId, ...rest) => (isForeign(unitId) ? false : base(unitId, ...rest))],
    ...[Game.UnitOperations, Game.UnitCommands].map((library) => [library, 'sendRequest', (base, unitId, ...rest) => (isForeign(unitId) ? undefined : base(unitId, ...rest))])
  ];
  for (const [target, name, guard] of guards) {
    try { if (!wrapMethod(target, name, guard)) log(`guard unavailable: ${name}`); }
    catch (e) { log(`guard unavailable: ${name} (${e})`); }
  }
}

// ============================ Promotions ============================

const openPromotions = () => { if (!InterfaceMode.switchTo('INTERFACEMODE_UNIT_PROMOTION')) log('promotion screen refused'); };

/** The unit panel's Promote action, as the game builds it for the owner. */
function promoteAction(panel) {
  const command = GameInfo.UnitCommands.lookup(PROMOTE);
  return command && {
    name: `[STYLE:unit-action__tooltip-title]${Locale.compose(command.Name)}[/STYLE][n]${Locale.compose(command.Description ?? '')}`,
    icon: command.Icon,
    type: PROMOTE,
    annotation: '',
    active: true,
    requireConfirm: false,
    UICategory: panel.getUnitActionCategory(command.CategoryInUI),
    priority: command.PriorityInUI ?? 0,
    hotkeyId: command.HotkeyId,
    callback: openPromotions
  };
}

/** Another player's commander can show its promotions and commendations, read-only (no purchase buttons). */
function patchPromotions() {
  whenDefined('unit-actions', (definition) => wrapMethod(definition.createInstance.prototype, 'getUnitActions', function (base, unit, ...rest) {
    const result = base(unit, ...rest);
    try {
      if (unit?.isCommanderUnit && isForeign(unit.id)) {
        const listed = this.actions.find((a) => a.type === PROMOTE);   // listed disabled for another player's unit
        if (listed) Object.assign(listed, { active: true, requireConfirm: false, callback: openPromotions });
        else {
          const action = promoteAction(this);
          if (action) this.actions.push(action);
        }
      }
    } catch (e) { log(`promote action not added: ${e}`); }
    return result;
  }), { log });
  whenDefined('panel-unit-promotion', (definition) => wrapMethod(definition.createInstance.prototype, 'onAttach', function (base, ...args) {
    this.Root.classList.toggle(READ_ONLY_CLASS, isForeign(UI.Player.getHeadSelectedUnit()));
    return base(...args);
  }), { log });
  setStyle(STYLE_ID, `.${READ_ONLY_CLASS} #promotion-button-container { display: none !important; }`);
}

patchSelection();
patchGuards();
patchPromotions();
onObserverReady(() => window.addEventListener('engine-input', onEngineInput, true));

export { inspectableUnits, isForeign };
