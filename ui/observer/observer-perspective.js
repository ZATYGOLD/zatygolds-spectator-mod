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
 * Shows the map as one leader sees it (toggled from the ribbon portraits):
 * unexplored tiles blacked out (colour filter + overlay), seen tiles greyed,
 * the minimap masked, resources shown as the game shows fog-of-war resources,
 * and flags, district bars, banners and world texts hidden where the leader
 * cannot see. The UI's revealed-state lookups for the local seat answer for
 * the viewed leader while active. Drawing only; never game state.
 */
import LensManager from 'fs://game/core/ui/lenses/lens-manager.js';
import { ResourceLensLayer } from 'fs://game/base-standard/ui/lenses/layer/resource-layer.js';
import DistrictHealthManager from 'fs://game/base-standard/ui/district/district-health-manager.js';
import { DistrictHealthBar } from 'fs://game/base-standard/ui/district/district-health.js';
import WorldAnchorTextManager from 'fs://game/base-standard/ui/world-anchor-text/world-anchor-text-manager.js';
import { UnitFlagManager } from 'fs://game/base-standard/ui/unit-flags/unit-flag-manager.js';
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { IndependentPowersUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags-independent-powers.js';
import { OVERLAY_PRIORITY } from 'fs://game/base-standard/ui/utilities/utilities-overlay.js';
import { ancestorWithClass, createLogger, deferOnce, setStyle, wrapMethod } from '../shared/zom-util.js';
import { CONFIG, ICONS } from './observer-config.js';
import { inDiplomacyMode, isObserverSeat } from './observer-core.js';
import { forEachBanner } from './observer-settlement-info.js';

const PERSPECTIVE_CHANGED_EVENT = 'zom-perspective-changed';
const REFRESH_EVENTS = ['UnitMoveComplete', 'UnitAddedToMap', 'UnitRemovedFromMap', 'PlayerTurnActivated', 'DistrictAddedToMap', 'DistrictDamageChanged', 'DistrictControlChanged', 'CityTransfered'];
const BADGE_CLASS = 'zom-perspective-badge';
const BADGE_SIZE_REM = 1.4;
// The card banner's gap: the portrait hex ends about 2.8rem down, the civ symbol starts at 5rem (mt-20).
const BADGE_TOP_REM = 2.8 + (5 - 2.8 - BADGE_SIZE_REM) / 2;
const BADGE_STYLE = `position: absolute; top: ${BADGE_TOP_REM}rem; left: 50%; margin-left: ${-BADGE_SIZE_REM / 2}rem;
  width: ${BADGE_SIZE_REM}rem; height: ${BADGE_SIZE_REM}rem; z-index: 5; pointer-events: none;
  background-image: url("${ICONS.perspective}"); background-size: contain; background-repeat: no-repeat; background-position: center;`;
const MINIMAP_CLASS = 'zom-perspective-minimap';
const FOG_CLASS = 'zom-perspective-fog-hidden';
const FOG_STYLE_ID = 'zom-perspective-fog-style';
const SCREEN_MARGIN = 0.1;      // fraction of the screen kept filtered beyond its edges
const SCENE_SETTLE_MS = 1000;
const MINIMAP_CANVAS_PX = { width: 480, height: 300 };
const MINIMAP_TILE_OVERLAP = 1.1;   // opaque hexes drawn as slightly larger rectangles leave no gaps (translucent ones would darken where they overlap)
const MINIMAP_BORDER_ROWS = 2;      // fallback projection: sea rows above and below the map (panel-mini-map.js)
const PLOT_ORIGIN = { x: 0, y: 0, z: 0 };
const RESOURCE_LAYER = 'fxs-resource-layer';
// As resource-layer.js draws its icons.
const RESOURCE_POSITION = { x: 0, y: 25, z: 5 };
const RESOURCE_SIZE = 42;
const RESOURCE_TYPE_SIZE = 20;
const RESOURCE_TYPE_OFFSET = { x: 0, y: -16 };

const log = createLogger('observer-perspective', CONFIG.debug);

let viewed = null;         // the player whose view is shown
let filterPushed = false;
let filterPlots = null;     // explored plots kept clear of the unexplored filter (null: none drawn)
let unexploredPlots = [];
let filterRegion = null;    // the region currently pushed
let suppressedResources = false;
let shownKey = '';         // the revealed states currently drawn
let overlayGroup = null;
let unexploredOverlay = null;
let seenOverlay = null;
let seenResources = null;       // fog-of-war resource icons on tiles seen before
let seenResourceTypes = null;

const isActive = () => viewed != null && isObserverSeat();
/** The leader whose view is shown, else null. */
const perspectivePlayer = () => (isActive() ? viewed : null);

/** Whether the shown view includes this leader: always without a Perspective, else the viewed leader and those they met. */
function isKnownInPerspective(playerId) {
  if (!isActive() || playerId === viewed) return true;
  try { return !!Players.get(viewed)?.Diplomacy?.hasMet(playerId); } catch (e) { return false; }
}

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

/** What the viewed leader knows of a unit: theirs or in sight, else hidden (units are never drawn in fog). */
function unitState(unitId) {
  if (unitId?.owner === viewed) return RevealedStates.VISIBLE;
  try { return Visibility.isVisible(viewed, unitId) ? RevealedStates.VISIBLE : RevealedStates.HIDDEN; }
  catch (e) {
    const loc = Units.get(unitId)?.location;
    return loc && GameplayMap.getRevealedState(viewed, loc.x, loc.y) === RevealedStates.VISIBLE ? RevealedStates.VISIBLE : RevealedStates.HIDDEN;
  }
}


// ============================ Map ============================

/** Unexplored plots outside the screen (with a margin), from their projected screen position. */
function offscreenUnexplored() {
  return unexploredPlots.filter((plot) => {
    const uv = WorldUI.getScreenPlotPos(GameplayMap.getLocationFromIndex(plot));
    return !uv || uv.x < -SCREEN_MARGIN || uv.x > 1 + SCREEN_MARGIN || uv.y < -SCREEN_MARGIN || uv.y > 1 + SCREEN_MARGIN;
  });
}

/**
 * The unexplored filter is a final pass that also tests a diplomacy scene's pixels against the
 * plots behind them in world space, which lie off screen: during a scene those plots join the
 * explored region, so every tile on screen stays filtered and the scene stays whole.
 */
function syncFilter() {
  let region = filterPlots;
  if (region && inDiplomacyMode()) {
    try { region = region.concat(offscreenUnexplored()); } catch (e) { log(`scene region failed: ${e}`); }
  }
  if (region === filterRegion) return;
  try {
    if (filterPushed) { WorldUI.popFilter(); filterPushed = false; }
    if (region) { WorldUI.pushRegionColorFilter(region, {}, CONFIG.perspectiveUnexplored); filterPushed = true; }
    filterRegion = region;
  } catch (e) { log(`filter update failed: ${e}`); }
}

/** Re-fit the region on a mode change, and again once the camera has settled. */
function onInterfaceMode() {
  syncFilter();
  setTimeout(syncFilter, SCENE_SETTLE_MS);
}

function clearMap() {
  filterPlots = null;
  unexploredPlots = [];
  syncFilter();
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
  if (!states.length) { clearMap(); clearMinimap(); return; }
  const key = Array.prototype.join.call(states, '');
  drawMinimap(states, key);
  if (key === shownKey) return;
  clearMap();
  const unexplored = plotsWhere(states, (s) => s === RevealedStates.HIDDEN);
  const seen = plotsWhere(states, (s) => s === RevealedStates.REVEALED);
  unexploredPlots = unexplored;
  filterPlots = plotsWhere(states, (s) => s !== RevealedStates.HIDDEN);
  syncFilter();
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

/**
 * Plot -> minimap position as fractions of the image (u right, v down, the
 * plot's centre) and a tile's size in those fractions. Calibrated from the
 * minimap's own projection (its input v runs upwards); else the base minimap's
 * highlight formula.
 */
function minimapProjection() {
  const width = GameplayMap.getGridWidth();
  const height = GameplayMap.getGridHeight();
  try {
    const a = WorldUI.minimapToWorld({ x: 0.25, y: 0.25 });
    const b = WorldUI.minimapToWorld({ x: 0.75, y: 0.75 });
    const plot = (x, y) => WorldUI.getPlotLocation({ x, y }, PLOT_ORIGIN, PlacementMode.TERRAIN);
    const origin = plot(0, 0);
    const right = plot(1, 0);
    const up = plot(0, 1);
    if (a && b && origin && right && up && a.x !== b.x && a.y !== b.y) {
      const col = right.x - origin.x;
      const row = up.y - origin.y;
      const oddShift = up.x - origin.x;
      const scaleU = 0.5 / (b.x - a.x);
      const scaleV = 0.5 / (b.y - a.y);
      return {
        tile: { u: Math.abs(col * scaleU), v: Math.abs(row * scaleV) },
        at: (loc) => {
          const wx = origin.x + loc.x * col + (loc.y % 2 ? oddShift : 0);
          const wy = origin.y + loc.y * row;
          return { u: 0.25 + (wx - a.x) * scaleU, v: 1 - (0.25 + (wy - a.y) * scaleV) };
        }
      };
    }
  } catch (e) { log.debug(`minimap projection unavailable: ${e}`); }
  const rows = height + 2 * MINIMAP_BORDER_ROWS + 0.5;
  return {
    tile: { u: 1 / (width + 0.5), v: 1 / rows },
    at: (loc) => ({ u: (loc.x + (loc.y % 2 ? 0.5 : 0) + 0.5) / (width + 0.5), v: (height - 1 - loc.y + MINIMAP_BORDER_ROWS + 0.5) / rows })
  };
}

/** The minimap's mask for these revealed states (kept while unchanged; re-added if the minimap was rebuilt). */
function drawMinimap(states, key) {
  const image = document.querySelector('.mini-map__image');
  if (!image) return;
  let canvas = image.querySelector('.' + MINIMAP_CLASS);
  if (canvas?.getAttribute('data-key') === key) return;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.classList.add(MINIMAP_CLASS);
    canvas.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;';
    canvas.width = MINIMAP_CANVAS_PX.width;
    canvas.height = MINIMAP_CANVAS_PX.height;
    image.appendChild(canvas);
  }
  const projection = minimapProjection();
  const tileW = projection.tile.u * canvas.width;
  const tileH = projection.tile.v * canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < states.length; i++) {
    if (states[i] === RevealedStates.VISIBLE) continue;
    const unexplored = states[i] === RevealedStates.HIDDEN;
    const scale = unexplored ? MINIMAP_TILE_OVERLAP : 1;
    const { u, v } = projection.at(GameplayMap.getLocationFromIndex(i));
    ctx.fillStyle = unexplored ? CONFIG.perspectiveMinimapUnexplored : CONFIG.perspectiveMinimapSeen;
    ctx.fillRect(u * canvas.width - (tileW * scale) / 2, v * canvas.height - (tileH * scale) / 2, tileW * scale, tileH * scale);
  }
  canvas.setAttribute('data-key', key);
}

function clearMinimap() {
  Array.prototype.forEach.call(document.querySelectorAll('.' + MINIMAP_CLASS), (canvas) => canvas.remove());
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

/** Re-apply every unit flag's, district health bar's and settlement banner's visibility; returns how many bars and banners are in fog. */
function refreshFlagsAndBanners() {
  UnitFlagManager.instance?.flags?.forEach((flag) => {
    try {
      const loc = Units.get(flag.componentID)?.location;
      if (loc) flag.setVisibility(GameplayMap.getRevealedState(GameContext.localObserverID, loc.x, loc.y));
    } catch (e) { /* flag gone */ }
  });
  let bars = 0;
  DistrictHealthManager.instance?.children?.forEach((bar) => {
    try {
      const loc = barLocation(bar);
      if (loc) bar.setVisibility(GameplayMap.getRevealedState(GameContext.localObserverID, loc.x, loc.y) !== RevealedStates.REVEALED);
      if (applyBarFog(bar)) bars++;
    } catch (e) { /* bar gone */ }
  });
  return { bars, banners: refreshBanners() };
}

/** Hide a district health bar on tiles the viewed leader does not see (the base only dims it); returns whether hidden. */
function applyBarFog(bar) {
  const loc = barLocation(bar);
  const hidden = isActive() && !!loc && GameplayMap.getRevealedState(viewed, loc.x, loc.y) !== RevealedStates.VISIBLE;
  bar.Root?.classList.toggle(FOG_CLASS, hidden);
  return hidden;
}

/** Hide banners on tiles the viewed leader never explored; returns how many. */
function refreshBanners() {
  let hiddenCount = 0;
  forEachBanner((banner, subject) => {
    const hidden = isActive() && !!subject
      && subject.locations.every((loc) => GameplayMap.getRevealedState(viewed, loc.x, loc.y) === RevealedStates.HIDDEN);
    banner.classList.toggle(FOG_CLASS, hidden);
    if (hidden) hiddenCount++;
  });
  return hiddenCount;
}

/**
 * The banner manager's per-banner visible flags follow our seat redirect only when a banner's
 * status refreshes, so they go stale across toggles; re-showing recomputes them (each blinks once).
 */
function recomputeBannerFlags() {
  if (document.getElementById('city-banner-container')?.classList.contains('hidden')) return;
  window.dispatchEvent(new CustomEvent('ui-show-city-banners'));
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
    const hidden = applyBarFog(this);
    return base(isActive() ? !hidden : isVisible, ...rest);
  });
  wrapMethod(WorldAnchorTextManager.prototype, 'onWorldTextMessage', function (base, data, ...rest) {
    const loc = data?.location;
    if (isActive() && loc && GameplayMap.getRevealedState(viewed, loc.x, loc.y) !== RevealedStates.VISIBLE) return;
    return base(data, ...rest);
  });
}

// ============================ Ribbon ============================

/** The eye on the viewed leader's ribbon card, between portrait and civ symbol (re-applied after every ribbon rebuild). */
function markPerspectiveCard(panel = document.querySelector('panel-diplo-ribbon')) {
  if (!panel) return;
  Array.prototype.forEach.call(panel.querySelectorAll('.' + BADGE_CLASS), (badge) => badge.remove());
  if (!isActive()) return;
  const portrait = panel.querySelector(`.diplo-ribbon__portrait[data-player-id="${viewed}"]`);
  const banner = ancestorWithClass(portrait, 'diplo-ribbon-outer')?.querySelector('.diplo-ribbon__upper-bg');
  if (!banner) return;
  const badge = document.createElement('div');
  badge.classList.add(BADGE_CLASS);
  badge.style.cssText = BADGE_STYLE;
  banner.appendChild(badge);
}

// ============================ State ============================

/** Show the current view; returns how many bars and banners are in fog. Each step on its own, so one failure never skips the rest. */
function apply() {
  let fog = { bars: 0, banners: 0 };
  try {
    if (isActive()) drawMap();
    else { clearMap(); clearMinimap(); }
  } catch (e) { log(`perspective map failed: ${e}`); }
  try { fog = refreshFlagsAndBanners(); recomputeBannerFlags(); } catch (e) { log(`perspective banners failed: ${e}`); }
  try { markPerspectiveCard(); } catch (e) { log(`perspective ribbon failed: ${e}`); }
  window.dispatchEvent(new CustomEvent(PERSPECTIVE_CHANGED_EVENT));
  return fog;
}

/** Show the player's view, or return to the Observer's own when it is already shown. Returns whether it is now shown. */
function togglePerspective(playerId) {
  viewed = viewed === playerId ? null : playerId;
  const fog = apply();
  log(viewed != null ? `perspective on: player ${viewed} (in fog: ${fog.banners} banners, ${fog.bars} district bars)` : 'perspective off');
  return viewed != null;
}

/** Return to the Observer's own (whole) view. Returns whether a Perspective was shown. */
function endPerspective() {
  if (viewed == null) return false;
  viewed = null;
  apply();
  return true;
}

const queueRedraw = deferOnce(() => {
  if (!isActive()) return;
  try { drawMap(); } catch (e) { log(`perspective map redraw failed: ${e}`); }
  try { refreshFlagsAndBanners(); } catch (e) { log(`perspective banner redraw failed: ${e}`); }
}, CONFIG.perspectiveRefreshMs);

function install() {
  setStyle(FOG_STYLE_ID, `.${FOG_CLASS} { display: none !important; }`);
  patchVisibilityLookups();
  patchFlagsAndBanners();
  for (const event of REFRESH_EVENTS) engine.on(event, () => { if (isActive()) queueRedraw(); });
  window.addEventListener('interface-mode-changed', onInterfaceMode);
  // Fog-of-war resource icons follow the game's resource layer (diplomacy scenes turn it off).
  for (const event of ['lens-event-layer-enabled', 'lens-event-layer-disabled']) {
    window.addEventListener(event, (ev) => {
      if (ev.detail?.layer !== RESOURCE_LAYER || !isActive()) return;
      const shown = event === 'lens-event-layer-enabled';
      seenResources?.setVisible(shown);
      seenResourceTypes?.setVisible(shown);
    });
  }
  engine.on('BeforeUnload', () => { viewed = null; clearMap(); clearMinimap(); });
}

try { install(); } catch (e) { log(`install failed: ${e}`); }

export { PERSPECTIVE_CHANGED_EVENT, endPerspective, isActive as isPerspectiveActive, isKnownInPerspective, markPerspectiveCard, perspectivePlayer, togglePerspective };
