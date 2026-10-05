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
 * Zatygold's Spectator - Observer navigation (in-game scope).
 *
 * Ribbon portraits: left click toggles that leader's Perspective and moves the
 * camera, right click opens their leader panel; on the Observer's own portrait
 * they end a Perspective / find the Eye and toggle every card's details.
 * Settlement banners and city centers open the settlement's details; right
 * click on a banner opens its owner's panel.
 */
import { RaiseDiplomacyEvent } from 'fs://game/base-standard/ui/diplomacy/diplomacy-events.js';
import WorldInput from 'fs://game/base-standard/ui/world-input/world-input.js';
import { ancestorWithClass, createLogger, findAncestor, isObserverPlayer, isTag, wrapMethod } from '../shared/zom-util.js';
import { isObserverSeat } from './observer-core.js';
import { endPerspective, togglePerspective } from './observer-perspective.js';
import { isDetailsHidden, setDetailsHidden } from './observer-ribbon-style.js';
import { showSettlement } from './observer-settlement.js';
import { bannerOf, bannerSubject } from './observer-settlement-info.js';

const log = createLogger('observer-navigation');

const openLeaderPanel = (playerId) => window.dispatchEvent(new RaiseDiplomacyEvent(playerId));

/** Move the camera to the player's capital (else first city, else a unit - the Eye for the Observer). */
function lookAtPlayer(playerId) {
  try {
    const player = Players.get(playerId);
    const cities = player?.Cities?.getCities?.() ?? [];
    const loc = (cities.find((c) => c.isCapital) ?? cities[0])?.location
      ?? (player?.Units?.getUnits?.() ?? []).find((u) => !u.isDead)?.location;
    if (loc) Camera.lookAtPlot(loc, { zoom: 1 });
  } catch (e) { log(`look-at failed: ${e}`); }
}

/** A watched leader's settlement shown by this banner, else null (independents and city-states keep the base behaviour). */
function settlementOfBanner(banner) {
  const subject = bannerSubject(banner);
  const owner = subject?.city ? Players.get(subject.owner) : null;
  return owner?.isMajor && !isObserverPlayer(owner.id) ? subject.city : null;
}

/** The ribbon portrait (and its player id) under an event target, or null. */
function portraitTarget(target) {
  const ribbon = findAncestor(target, (el) => isTag(el, 'panel-diplo-ribbon'));
  if (!ribbon || !(ancestorWithClass(target, 'diplo-ribbon__portrait') || ancestorWithClass(target, 'diplo-ribbon__portrait-hitbox'))) return null;
  const id = parseInt(findAncestor(target, (el) => el.getAttribute('data-player-id') != null)?.getAttribute('data-player-id'), 10);
  return Number.isNaN(id) ? null : id;
}

function onEngineInput(ev) {
  const d = ev.detail;
  if (!d || !['mousebutton-left', 'mousebutton-right', 'accept'].includes(d.name) || !isObserverSeat()) return;
  try {
    const banner = d.name === 'accept' ? null : bannerOf(ev.target);
    const settlement = banner ? settlementOfBanner(banner) : null;
    const portraitId = settlement ? null : portraitTarget(ev.target);
    if (!settlement && portraitId == null) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (d.status !== InputActionStatuses.FINISH) return;
    if (settlement) {
      if (d.name === 'mousebutton-right') openLeaderPanel(settlement.owner);
      else showSettlement(settlement.id);
      return;
    }
    const own = portraitId === GameContext.localPlayerID;
    if (d.name === 'mousebutton-right') {
      if (own) { setDetailsHidden(!isDetailsHidden()); return; }
      lookAtPlayer(portraitId);
      if (!isObserverPlayer(portraitId)) openLeaderPanel(portraitId);
      return;
    }
    if (own ? endPerspective() : !togglePerspective(portraitId)) return;
    lookAtPlayer(portraitId);
  } catch (e) { log(`click failed: ${e}`); }
}

/** City-center tiles open the settlement's details; every other tile keeps the base behaviour. */
function patchCityCenterClicks() {
  wrapMethod(WorldInput, 'handleSelectedPlotCity', (base, location, ...rest) => {
    if (!isObserverSeat()) return base(location, ...rest);
    try {
      const districtId = MapCities.getDistrict(location.x, location.y);
      const district = districtId ? Districts.get(districtId) : null;
      const city = district?.cityId && district.type === DistrictTypes.CITY_CENTER ? Cities.get(district.cityId) : null;
      if (city && !isObserverPlayer(city.owner) && showSettlement(city.id)) return false;
    } catch (e) { log(`city center click failed: ${e}`); }
    return base(location, ...rest);
  });
}

patchCityCenterClicks();
window.addEventListener('engine-input', onEngineInput, true);
