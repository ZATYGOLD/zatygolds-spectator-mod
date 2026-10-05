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
 * Zatygold's Spectator - Observer settlement details (in-game scope).
 *
 * Clicking a settlement (observer-navigation.js) opens the game's own City
 * Details panel for it, Town Details for a town, as players see their own:
 * growth, buildings, improvements, wonders, connections and yields. It only
 * shows; nothing in it changes the game. The base panel and its model follow
 * the head selected city, which the Observer (owning none) cannot select, so
 * while the model updates, that lookup answers with the clicked settlement.
 * The panel's previous / next arrows step through the owner's settlements.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { InputEngineEventName } from 'fs://game/core/ui/input/input-support.js';
import Panel from 'fs://game/core/ui/panel-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { FocusManager } from 'fs://game/core/ui-next/services/focus-manager.js';
import CityDetails from 'fs://game/base-standard/ui/city-details/model-city-details.js';
import { CityDetailsClosedEventName, PanelCityDetails } from 'fs://game/base-standard/ui/city-details/panel-city-details.js';
import { GetNextCityID, GetPrevCityID } from 'fs://game/base-standard/ui/production-chooser/production-chooser-helpers.js';
import { createLogger, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, SCREEN_PROPS } from './observer-core.js';

const HOST_TAG = 'zom-observer-settlement';
const UPDATE_CALLER = 'zom-observer-settlement';

const log = createLogger('observer-settlement', CONFIG.debug);

let shown = null;          // the settlement whose details are open
let answering = false;     // the details model is updating for it

// ============================ Panel ============================

/** Hosts the base City Details panel at the right edge, as the city view places it. */
class ObserverSettlementHost extends Panel {
  closeListener = () => this.close();
  engineInputListener = this.onEngineInput.bind(this);

  onAttach() {
    super.onAttach();
    this.details = document.createElement('panel-city-details');
    this.Root.appendChild(this.details);
    window.addEventListener(CityDetailsClosedEventName, this.closeListener);
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
  }

  onDetach() {
    window.removeEventListener(CityDetailsClosedEventName, this.closeListener);
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    shown = null;
    super.onDetach();
  }

  onReceiveFocus() {
    super.onReceiveFocus();
    FocusManager.get().setFocus(this.details ?? this.Root);
  }

  onEngineInput(ev) {
    if (ev.detail.status !== InputActionStatuses.FINISH) return;
    if (ev.isCancelInput() || ev.detail.name === 'sys-menu') {
      this.close();
      ev.stopPropagation();
      ev.preventDefault();
    }
  }
}

Controls.define(HOST_TAG, {
  createInstance: ObserverSettlementHost,
  description: 'Spectator settlement details (any leader).',
  classNames: ['absolute', 'inset-0', 'flex', 'flex-row', 'justify-end', 'pointer-events-none'],
  attributes: []
});

// ============================ Details ============================

/** Open (or switch) the details panel to a settlement. */
function showSettlement(cityId) {
  if (!isObserverSeat() || !ComponentID.isValid(cityId) || !Cities.get(cityId)) return false;
  shown = cityId;
  CityDetails.updateGate.call(UPDATE_CALLER);
  if (!document.querySelector(HOST_TAG)) ContextManager.push(HOST_TAG, SCREEN_PROPS);
  return true;
}

function install() {
  wrapMethod(UI.Player, 'getHeadSelectedCity', (base, ...rest) => (answering ? shown : base(...rest)));
  wrapMethod(CityDetails.updateGate, 'updateFunction', (base, ...rest) => {
    answering = shown != null;
    try { return base(...rest); } finally { answering = false; }
  });
  for (const [name, step] of [['selectPrevCity', GetPrevCityID], ['selectNextCity', GetNextCityID]]) {
    wrapMethod(PanelCityDetails.prototype, name, (base, ...rest) => (shown == null ? base(...rest) : showSettlement(step(shown))));
  }
  engine.on('BeforeUnload', () => { shown = null; });
}

try { install(); } catch (e) { log(`install failed: ${e}`); }

export { showSettlement };
