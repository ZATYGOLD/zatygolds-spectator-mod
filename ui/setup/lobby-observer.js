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
 * Zatygold's Spectator - Observer in the multiplayer lobby (shell scope).
 *
 * Makes the Observer leader + civilization one role: a single Observer civ
 * entry (the start Age's), picking either sets the other and clears the team,
 * locked civ / team dropdowns with the eye badge while observing, no Observer
 * team for computers, and no mementos.
 */
import MPLobbyModel, { LobbyUpdateEventName, MPLobbyDataModel } from 'fs://game/core/ui/shell/mp-staging/model-mp-staging-new.js';
import 'fs://game/core/ui/shell/mp-staging/mp-staging-leader-dropdown.js';
import 'fs://game/core/ui/shell/mp-staging/mp-staging-new.js';
import { MPStagingTeamDropdown } from 'fs://game/core/ui/shell/mp-staging/mp-staging-team-dropdown.js';
import { configCiv, configLeader, createLogger, isObserverCiv, OBSERVER_LEADER, whenDefined, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './setup-config.js';
import { isComputerSlot, isLocalObserver, isObserverRow, NO_TEAM, observerCivForStartAge, PARAM_LEADER, queueObserverFlag, setParam, setTeam, syncSelection } from './setup-observer.js';
import { ART } from '../shared/zom-assets.js';

const DROPDOWN_PARAM = 'DROPDOWN_TYPE_PLAYER_PARAM';
const DROPDOWN_TEAM = 'DROPDOWN_TYPE_TEAM';
const HIDDEN = 'hidden';

const log = createLogger('lobby-observer', CONFIG.debug);

// ============================ Dropdown shaping ============================

/** Base order, with the Observer entry moved last. */
function moveObserverLast(items, isObserver) {
  return items.filter((it) => !isObserver(it)).concat(items.filter(isObserver));
}

function lockDropdown(dropdown, index) {
  dropdown.selectedItemIndex = index;
  dropdown.isDisabled = true;
}

/** Civ list: one Observer entry (start Age only, never for computer players), eye icon; locked while observing. */
function shapeCivDropdown(dropdown, playerID) {
  const wanted = isComputerSlot(playerID) ? null : observerCivForStartAge();
  let items = (dropdown.itemList ?? []).filter((it) => !isObserverCiv(it.paramID) || it.paramID === wanted);
  if (wanted && !items.some((it) => it.paramID === wanted)) {   // unknown Age: keep one Observer entry rather than none
    const first = (dropdown.itemList ?? []).find((it) => isObserverCiv(it.paramID));
    if (first) items.push(first);
  }
  items = moveObserverLast(items, (it) => isObserverCiv(it.paramID));
  for (const it of items) if (isObserverCiv(it.paramID)) it.iconURL = ART.observerCivIcon;
  const current = configCiv(playerID);
  dropdown.itemList = items;
  dropdown.selectedItemIndex = items.findIndex((it) => it.paramID === current);
  if (isObserverRow(playerID)) lockDropdown(dropdown, items.findIndex((it) => isObserverCiv(it.paramID)));
}

/** Leader list: Observer last with the eye icon (never for computer players); stays enabled to switch back. */
function shapeLeaderDropdown(dropdown, playerID) {
  const offered = (dropdown.itemList ?? []).filter((it) => it.paramID !== OBSERVER_LEADER || !isComputerSlot(playerID));
  const items = moveObserverLast(offered, (it) => it.paramID === OBSERVER_LEADER);
  for (const it of items) if (it.paramID === OBSERVER_LEADER) it.iconURL = ART.observerIcon;
  dropdown.itemList = items;
  const current = configLeader(playerID);
  dropdown.selectedItemIndex = items.findIndex((it) => it.paramID === current);
}

/**
 * Team column: an "Observer" entry is appended to a human player's team list
 * (picking it makes the row an observer). While observing it is the selection, the eye
 * badge is shown and the numbered teams are disabled.
 */
function shapeTeamDropdown(dropdown, playerID) {
  const observing = isObserverRow(playerID);
  const items = (dropdown.itemList ?? []).filter((it) => !it.zomObserver);
  if (isComputerSlot(playerID)) { dropdown.itemList = items; return; }
  if (observing) for (const it of items) it.disabled = true;
  items.push({
    label: Locale.compose('LOC_ZOM_TEAM_OBSERVER'),
    teamID: NO_TEAM,
    zomObserver: true,
    tooltip: 'LOC_ZOM_TEAM_OBSERVER_DESC',
    disabled: false
  });
  dropdown.itemList = items;
  if (observing) {
    dropdown.selectedItemIndex = items.length - 1;
    dropdown.showLabelOnSelectedItem = false;
  }
}

// ============================ Mementos ============================


/**
 * An Observer row lists no mementos: its "mementos" attribute is emptied, so the
 * base row and other mods' slots on it (Advanced Settings Pro) hide as they do
 * for a player without mementos.
 */
function syncRowMementos(dropdown) {
  const playerID = parseInt(dropdown.Root.getAttribute('data-player-id') ?? '', 10);
  if (Number.isInteger(playerID) && isObserverRow(playerID) && dropdown.Root.getAttribute('mementos')) {
    dropdown.Root.setAttribute('mementos', '');
  }
}

/** The lobby's Mementos button: shown only when mementos are on and the local player does not observe. */
function syncMementoButton() {
  const button = document.querySelector('screen-mp-lobby .memento-button');
  button?.classList.toggle(HIDDEN, !Configuration.getGame().isMementosEnabled || isLocalObserver());
}

function installMementos(proto) {
  const canEdit = Object.getOwnPropertyDescriptor(proto, 'canEditMementos');
  if (canEdit?.get) {
    Object.defineProperty(proto, 'canEditMementos', { ...canEdit, get() { return canEdit.get.call(this) && !isLocalObserver(); } });
  }

  whenDefined('leader-dropdown', (definition) => {
    wrapMethod(definition.createInstance.prototype, 'onAttributeChanged', function (base, ...args) {
      base(...args);
      try { syncRowMementos(this); } catch (e) { /* keep base visuals */ }
    });
  }, { log });

  whenDefined('screen-mp-lobby', (definition) => {
    wrapMethod(definition.createInstance.prototype, 'openMementos', function (base, ...args) {
      return isLocalObserver() ? undefined : base(...args);
    });
  }, { log });

  window.addEventListener(LobbyUpdateEventName, () => {
    try { syncMementoButton(); } catch (e) { log(`memento button failed: ${e}`); }
  });
}

// ============================ Installation ============================

function install() {
  const proto = MPLobbyDataModel.prototype;

  wrapMethod(proto, 'createPlayerParamDropdown', function (base, playerID, dropID, type, dropLabel, dropDesc, paramNameHandle, ...rest) {
    const dropdown = base(playerID, dropID, type, dropLabel, dropDesc, paramNameHandle, ...rest);
    try {
      if (dropdown && paramNameHandle === this.PlayerCivilizationStringHandle) shapeCivDropdown(dropdown, playerID);
      else if (dropdown && paramNameHandle === this.PlayerLeaderStringHandle) { shapeLeaderDropdown(dropdown, playerID); queueObserverFlag(); }
    } catch (e) { log(`dropdown shaping failed: ${e}`); }
    return dropdown;
  });

  wrapMethod(proto, 'createTeamParamDropdown', (base, playerID, ...rest) => {
    const dropdown = base(playerID, ...rest);
    try { if (dropdown) shapeTeamDropdown(dropdown, playerID); } catch (e) { log(`team shaping failed: ${e}`); }
    return dropdown;
  });

  // Sync after the base handler has applied the player's pick.
  const baseParamCallback = MPLobbyModel.dropdownCallbacks.get(DROPDOWN_PARAM);
  MPLobbyModel.dropdownCallbacks.set(DROPDOWN_PARAM, (event) => {
    baseParamCallback?.(event);
    try {
      const target = event?.target;
      const playerID = parseInt(target?.getAttribute?.('data-player-id') ?? '');
      const param = target?.getAttribute?.('data-player-param');
      const value = event?.detail?.selectedItem?.paramID;
      if (Number.isInteger(playerID) && param && value) syncSelection(playerID, param, value);
    } catch (e) { log(`sync failed: ${e}`); }
  });

  // Team "Observer" makes the row an observer (leader + civ follow); an
  // observer row never joins a numbered team.
  const baseTeamCallback = MPLobbyModel.dropdownCallbacks.get(DROPDOWN_TEAM);
  MPLobbyModel.dropdownCallbacks.set(DROPDOWN_TEAM, (event) => {
    try {
      const playerID = parseInt(event?.target?.getAttribute?.('data-player-id') ?? '');
      if (Number.isInteger(playerID)) {
        if (event?.detail?.selectedItem?.zomObserver && !isComputerSlot(playerID)) {
          if (configLeader(playerID) !== OBSERVER_LEADER) setParam(playerID, PARAM_LEADER, OBSERVER_LEADER);
          syncSelection(playerID, PARAM_LEADER, OBSERVER_LEADER);
          return;
        }
        if (isObserverRow(playerID)) { setTeam(playerID, NO_TEAM); return; }
      }
    } catch (e) { /* fall through */ }
    baseTeamCallback?.(event);
  });

  // Collapsed team badge: paint the eye instead of a team color for the Observer
  // entry. Re-checked when the items change too, since the index may not move.
  wrapMethod(MPStagingTeamDropdown.prototype, 'onAttributeChanged', function (base, name, oldValue, newValue) {
    base(name, oldValue, newValue);
    try {
      if (name !== 'selected-item-index' && name !== 'dropdown-items') return;
      const index = parseInt(this.Root.getAttribute('selected-item-index') ?? '-1');
      const observing = !!this.dropdownItems?.[index]?.zomObserver;
      if (observing) {
        this.Root.setAttribute('icon-container-innerhtml',
          `<div class='absolute w-16 h-16' style='background-image: url("${ART.observerIcon}"); background-size: contain; background-repeat: no-repeat; background-position: center;'></div>`);
      }
      this.Root.setAttribute('show-label-on-selected-item', observing ? 'false' : 'true');
    } catch (e) { /* keep base visuals */ }
  });

  installMementos(proto);

  log.debug('lobby role installed');
}

if (CONFIG.observerRole !== false) {
  try { install(); } catch (e) { log(`install failed: ${e}`); }
}
