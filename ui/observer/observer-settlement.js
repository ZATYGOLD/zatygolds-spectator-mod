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
 * A town's details open with its focus (icon, name, effect), which the
 * owner would see in the production panel beside them.
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
import { townFocus } from './observer-settlement-info.js';

const HOST_TAG = 'zom-observer-settlement';
const UPDATE_CALLER = 'zom-observer-settlement';
const FOCUS_CLASS = 'zom-town-focus';

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
  attributes: [],
  tabIndex: -1
});

// ============================ Town focus ============================

function textLine(loc, classes) {
  const el = document.createElement('div');
  el.classList.value = classes;
  el.setAttribute('data-l10n-id', loc);
  return el;
}

/** The shown town's focus above the growth tab's first note (redrawn on every panel update). */
function showTownFocus(root) {
  root.querySelector('.' + FOCUS_CLASS)?.remove();
  const anchor = root.querySelector('.specialist-container');
  const focus = shown != null ? townFocus(Cities.get(shown)) : null;
  if (!focus || !anchor?.parentElement) return;
  const block = document.createElement('div');
  block.classList.value = `${FOCUS_CLASS} flex flex-row items-center m-1`;
  const icon = document.createElement('div');
  icon.classList.value = 'size-12 m-1 bg-contain bg-center bg-no-repeat';
  icon.style.backgroundImage = `url('${focus.icon}')`;
  const text = document.createElement('div');
  text.classList.value = 'flex flex-col flex-auto ml-2';
  text.append(
    textLine('LOC_UI_TOWN_FOCUS', 'font-title text-gradient-secondary uppercase'),
    textLine(focus.name, 'font-title text-accent-2'),
    textLine(focus.description, 'font-body text-sm text-accent-3')
  );
  block.append(icon, text);
  anchor.parentElement.insertBefore(block, anchor);
}

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
  wrapMethod(PanelCityDetails.prototype, 'update', function (base, ...rest) {
    const result = base(...rest);
    try { if (shown != null) showTownFocus(this.Root); } catch (e) { log(`town focus failed: ${e}`); }
    return result;
  });
  for (const [name, step] of [['selectPrevCity', GetPrevCityID], ['selectNextCity', GetNextCityID]]) {
    wrapMethod(PanelCityDetails.prototype, name, (base, ...rest) => (shown == null ? base(...rest) : showSettlement(step(shown))));
  }
  engine.on('BeforeUnload', () => { shown = null; });
}

try { install(); } catch (e) { log(`install failed: ${e}`); }

export { showSettlement };
