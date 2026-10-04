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
 * Zatygold's Spectator - Observer perspective (in-game scope).
 *
 * The Observer's Eye sees the whole map. The Perspective toggle on the
 * Observer's ribbon card (observer-ribbon-toolbar.js) shows the map as one
 * leader sees it instead: while it is on, left-clicking a leader's portrait
 * (observer-navigation.js) picks that leader.
 *   - Fog: tiles the leader never explored are blacked out by a region colour
 *     filter (as the game's tile purchase uses), which also blacks out
 *     mountains, vegetation and units there, plus an opaque black plot
 *     overlay. Tiles they saw before but do not see now get a dark grey plot
 *     overlay on the ground; 3D models there (units too) stay drawn, since
 *     only one colour filter applies at a time (tested in-game) and no
 *     per-unit model API exists.
 *   - Resource icons: suppressed on unexplored tiles (the resource layer's own
 *     suppressPlots); on tiles seen before they are redrawn with the game's
 *     greyed fog-of-war icons (the layer's FOW variants), as the game does.
 *   - The camera keeps the game's own zoom range (observer-hud.js).
 *   - While active, the UI's visibility lookups for the local player
 *     (GameplayMap.getRevealedState / getRevealedStates) answer for the viewed
 *     leader, so the game's own checks follow them: plot tooltips, district
 *     health bars, floating world texts ("+1 Food") and the like.
 *   - Unit flags, district health bars and settlement banners are re-applied
 *     on every change (the flags' and bars' setVisibility; the ui-next
 *     CityBanner component is overridden), and floating world texts on tiles
 *     the leader does not see are dropped.
 *   - The picked leader's ribbon portrait carries the eye.
 * The game's real fog of war is drawn by the engine for the local observer
 * only, with no per-tile API, so it cannot be moved to another leader.
 * Only drawing changes, never game state. Redrawn (debounced) when units move,
 * appear or leave, and at every turn.
 */
import { createSignal, mergeProps } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';
import LensManager from 'fs://game/core/ui/lenses/lens-manager.js';
import { CityBannerComponent } from 'fs://game/base-standard/ui/city-banners/city-banners.js';
import { ResourceLensLayer } from 'fs://game/base-standard/ui/lenses/layer/resource-layer.js';
import DistrictHealthManager from 'fs://game/base-standard/ui/district/district-health-manager.js';
import { DistrictHealthBar } from 'fs://game/base-standard/ui/district/district-health.js';
import WorldAnchorTextManager from 'fs://game/base-standard/ui/world-anchor-text/world-anchor-text-manager.js';
import { UnitFlagManager } from 'fs://game/base-standard/ui/unit-flags/unit-flag-manager.js';
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { IndependentPowersUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags-independent-powers.js';
import { OVERLAY_PRIORITY } from 'fs://game/base-standard/ui/utilities/utilities-overlay.js';
import 'fs://game/base-standard/ui-next/screens/city-banners/city-banner.js';
import { createLogger, deferOnce, wrapMethod } from '../shared/zom-util.js';
import { CONFIG, ICONS } from './observer-config.js';
import { isObserverSeat } from './observer-core.js';

const PERSPECTIVE_CHANGED_EVENT = 'zom-perspective-changed';
const REFRESH_EVENTS = ['UnitMoveComplete', 'UnitAddedToMap', 'UnitRemovedFromMap', 'PlayerTurnActivated'];
const BADGE_CLASS = 'zom-perspective-badge';
const BADGE_STYLE = `position: absolute; top: -0.1rem; right: -0.1rem; width: 1.4rem; height: 1.4rem; z-index: 5; pointer-events: none;
  background-image: url("${ICONS.perspective}"); background-size: contain; background-repeat: no-repeat; background-position: center;`;
const OVERRIDE_PRIORITY = 1;
const RESOURCE_LAYER = 'fxs-resource-layer';
// As resource-layer.js draws its icons.
const RESOURCE_POSITION = { x: 0, y: 25, z: 5 };
const RESOURCE_SIZE = 42;
const RESOURCE_TYPE_SIZE = 20;
const RESOURCE_TYPE_OFFSET = { x: 0, y: -16 };

const log = createLogger('observer-perspective', CONFIG.debug);

let enabled = false;       // the Perspective toggle
let viewed = null;         // the player whose view is shown
let filterPushed = false;
let suppressedResources = false;
let shownKey = '';         // the revealed states currently drawn
let overlayGroup = null;
let unexploredOverlay = null;
let seenOverlay = null;
let seenResources = null;       // fog-of-war resource icons on tiles seen before
let seenResourceTypes = null;
const [revision, setRevision] = createSignal(0);   // settlement banners re-check their visibility when it changes

const isPerspectiveMode = () => enabled;
const perspectivePlayer = () => viewed;
const isActive = () => viewed != null && isObserverSeat();

// ============================ Visibility ============================

const isLocalSeat = (playerId) => playerId === GameContext.localPlayerID || playerId === GameContext.localObserverID;

/** The player the UI's visibility lookups stand for: the viewed leader while active. */
const seatFor = (playerId) => (isActive() && isLocalSeat(playerId) ? viewed : playerId);

function revealedStates(playerId) {
  try { return GameplayMap.getRevealedStates(playerId) ?? []; } catch (e) { return []; }
}

function plotsWhere(states, test) {
  const plots = [];
  for (let i = 0; i < states.length; i++) if (test(states[i])) plots.push(i);
  return plots;
}

/** What the viewed leader knows of a unit: visible when it is theirs or they see it. */
function unitState(unitId) {
  if (unitId?.owner === viewed) return RevealedStates.VISIBLE;
  try { return Visibility.isVisible(viewed, unitId) ? RevealedStates.VISIBLE : RevealedStates.REVEALED; }
  catch (e) {
    const loc = Units.get(unitId)?.location;
    return loc ? GameplayMap.getRevealedState(viewed, loc.x, loc.y) : RevealedStates.HIDDEN;
  }
}

const isExploredBy = (playerId, loc) => GameplayMap.getRevealedState(playerId, loc.x, loc.y) !== RevealedStates.HIDDEN;

// ============================ Map ============================

function clearMap() {
  if (filterPushed) {
    try { WorldUI.popFilter(); } catch (e) { log(`filter pop failed: ${e}`); }
    filterPushed = false;
  }
  overlayGroup?.clearAll();
  seenResources?.clear();
  seenResourceTypes?.clear();
  if (suppressedResources) {
    try { ResourceLensLayer.instance.clearSuppressedPlots(); } catch (e) { log(`resource restore failed: ${e}`); }
    suppressedResources = false;
  }
  shownKey = '';
}

/** Fog for the viewed leader; redrawn only when their revealed tiles changed. */
function drawMap() {
  const states = revealedStates(viewed);
  if (!states.length) { clearMap(); return; }
  const key = Array.prototype.join.call(states, '');
  if (key === shownKey) return;
  clearMap();
  const unexplored = plotsWhere(states, (s) => s === RevealedStates.HIDDEN);
  const seen = plotsWhere(states, (s) => s === RevealedStates.REVEALED);
  WorldUI.pushRegionColorFilter(plotsWhere(states, (s) => s !== RevealedStates.HIDDEN), {}, CONFIG.perspectiveUnexplored);
  filterPushed = true;
  overlayGroup ??= WorldUI.createOverlayGroup('ZOMPerspectiveOverlayGroup', OVERLAY_PRIORITY.HEX_GRID);
  unexploredOverlay ??= overlayGroup.addPlotOverlay();
  unexploredOverlay.addPlots(unexplored, { fillColor: CONFIG.perspectiveUnexploredFill });
  seenOverlay ??= overlayGroup.addPlotOverlay();
  seenOverlay.addPlots(seen, { fillColor: CONFIG.perspectiveSeenFill });
  ResourceLensLayer.instance.suppressPlots([...unexplored, ...seen]);
  suppressedResources = true;
  drawSeenResources(seen);
  shownKey = key;
  log.debug(`perspective of player ${viewed} drawn`);
}

/** The game's greyed fog-of-war resource icons on the given plots. */
function drawSeenResources(plots) {
  seenResources ??= WorldUI.createSpriteGrid('ZOMPerspectiveResources_SpriteGroup', SpriteMode.FixedBillboard);
  seenResourceTypes ??= WorldUI.createSpriteGrid('ZOMPerspectiveResourceTypes_SpriteGroup', SpriteMode.FixedBillboard);
  const scale = (GlobalScaling.getCurrentScale?.() ?? 100) / 100;
  const shown = LensManager.isLayerEnabled(RESOURCE_LAYER);
  for (const grid of [seenResources, seenResourceTypes]) { grid.setScale(scale); grid.setVisible(shown); }
  const player = Players.get(viewed);
  for (const plot of plots) {
    const loc = GameplayMap.getLocationFromIndex(plot);
    const resource = GameplayMap.getResourceType(loc.x, loc.y);
    if (resource === ResourceTypes.NO_RESOURCE) continue;
    const def = GameInfo.Resources.lookup(resource);
    if (!def) continue;
    const fleet = def.ResourceClassType === 'RESOURCECLASS_TREASURE' && !!player?.isDistantLands?.(loc);
    seenResources.addSprite(loc, UI.getIconBLP(def.ResourceType, 'FOW'), RESOURCE_POSITION, { scale: RESOURCE_SIZE });
    seenResourceTypes.addSprite(loc, UI.getIconBLP(fleet ? 'RESOURCECLASS_TREASURE_FLEET' : def.ResourceClassType, 'FOW'), RESOURCE_POSITION, {
      scale: RESOURCE_TYPE_SIZE,
      offset: RESOURCE_TYPE_OFFSET
    });
  }
}

// ============================ Flags and banners ============================

/** A district health bar's plot, from its anchor attribute ("x;y"). */
function barLocation(bar) {
  const [x, y] = (bar.Root?.getAttribute('data-district-location') ?? '').split(';').map(Number);
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

/** Re-apply every unit flag's, district health bar's and settlement banner's visibility. */
function refreshFlagsAndBanners() {
  UnitFlagManager.instance?.flags?.forEach((flag) => {
    try {
      const loc = Units.get(flag.componentID)?.location;
      if (loc) flag.setVisibility(GameplayMap.getRevealedState(GameContext.localObserverID, loc.x, loc.y));
    } catch (e) { /* flag gone */ }
  });
  DistrictHealthManager.instance?.children?.forEach((bar) => {
    try {
      const loc = barLocation(bar);
      if (loc) bar.setVisibility(GameplayMap.getRevealedState(GameContext.localObserverID, loc.x, loc.y) !== RevealedStates.REVEALED);
    } catch (e) { /* bar gone */ }
  });
  window.banners?.forEach?.((banner) => {
    try { banner.setVisibility(banner.getVisibility()); } catch (e) { /* banner gone */ }
  });
  setRevision((r) => r + 1);
}

/** A settlement banner's data with status.visible following the viewed leader while active. */
function perspectiveBannerData(props) {
  const visible = () => {
    revision();
    const own = props.data.status.visible;
    const loc = props.location ?? props.data.identity?.location;
    return isActive() && loc ? isExploredBy(viewed, loc) : own;
  };
  const status = new Proxy({}, { get: (_, key) => (key === 'visible' ? visible() : props.data.status[key]) });
  return new Proxy({}, { get: (_, key) => (key === 'status' ? status : props.data[key]) });
}

/** The UI's visibility lookups for the local seat answer for the viewed leader while active. */
function patchVisibilityLookups() {
  try {
    wrapMethod(GameplayMap, 'getRevealedState', (base, playerId, ...rest) => base(seatFor(playerId), ...rest));
    wrapMethod(GameplayMap, 'getRevealedStates', (base, playerId, ...rest) => base(seatFor(playerId), ...rest));
  } catch (e) { log(`visibility lookups not patched: ${e}`); }
}

function patchFlagsAndBanners() {
  for (const flagClass of [GenericUnitFlag, IndependentPowersUnitFlag]) {
    wrapMethod(flagClass.prototype, 'setVisibility', function (base, state, ...rest) {
      return base(isActive() ? unitState(this.componentID) : state, ...rest);
    });
  }
  wrapMethod(DistrictHealthBar.prototype, 'setVisibility', function (base, isVisible, ...rest) {
    const loc = isActive() ? barLocation(this) : null;
    return base(loc ? GameplayMap.getRevealedState(viewed, loc.x, loc.y) === RevealedStates.VISIBLE : isVisible, ...rest);
  });
  wrapMethod(CityBannerComponent.prototype, 'setVisibility', function (base, state, ...rest) {
    const loc = this.location;
    return base(isActive() && loc ? GameplayMap.getRevealedState(viewed, loc.x, loc.y) : state, ...rest);
  });
  wrapMethod(WorldAnchorTextManager.prototype, 'onWorldTextMessage', function (base, data, ...rest) {
    const loc = data?.location;
    if (isActive() && loc && GameplayMap.getRevealedState(viewed, loc.x, loc.y) !== RevealedStates.VISIBLE) return;
    return base(data, ...rest);
  });
  const banner = ComponentRegistry.get('CityBanner')?.factory();
  if (!banner) { log('CityBanner is not registered'); return; }
  ComponentRegistry.register('CityBanner', (props) => {
    const data = perspectiveBannerData(props);
    return banner(mergeProps(props, { get data() { return data; } }));
  }, OVERRIDE_PRIORITY);
}

// ============================ Ribbon ============================

/** The eye on the viewed leader's ribbon portrait (re-applied after every ribbon rebuild). */
function markPerspectiveCard(panel = document.querySelector('panel-diplo-ribbon')) {
  if (!panel) return;
  Array.prototype.forEach.call(panel.querySelectorAll('.' + BADGE_CLASS), (badge) => badge.remove());
  if (!isActive()) return;
  const portrait = panel.querySelector(`.diplo-ribbon__portrait[data-player-id="${viewed}"]`);
  if (!portrait) return;
  const badge = document.createElement('div');
  badge.classList.add(BADGE_CLASS);
  badge.style.cssText = BADGE_STYLE;
  portrait.appendChild(badge);
}

// ============================ State ============================

function apply() {
  try {
    if (isActive()) drawMap();
    else clearMap();
    refreshFlagsAndBanners();
    markPerspectiveCard();
  } catch (e) { log(`perspective failed: ${e}`); }
  window.dispatchEvent(new CustomEvent(PERSPECTIVE_CHANGED_EVENT));
}

/** The toggle: off also returns to the Observer's own (whole) view. */
function setPerspectiveMode(on) {
  enabled = !!on;
  if (!enabled) viewed = null;
  apply();
}

/** Show the player's view (only while the toggle is on). */
function viewPerspective(playerId) {
  if (!enabled || playerId === viewed) return;
  viewed = playerId;
  apply();
}

const queueRedraw = deferOnce(() => {
  if (!isActive()) return;
  try {
    drawMap();
    refreshFlagsAndBanners();
  } catch (e) { log(`perspective redraw failed: ${e}`); }
}, CONFIG.perspectiveRefreshMs);

function install() {
  patchVisibilityLookups();
  patchFlagsAndBanners();
  for (const event of REFRESH_EVENTS) engine.on(event, () => { if (isActive()) queueRedraw(); });
  engine.on('BeforeUnload', () => { enabled = false; viewed = null; clearMap(); });
}

try { install(); } catch (e) { log(`install failed: ${e}`); }

export { PERSPECTIVE_CHANGED_EVENT, isActive as isPerspectiveActive, isPerspectiveMode, markPerspectiveCard, perspectivePlayer, setPerspectiveMode, viewPerspective };
