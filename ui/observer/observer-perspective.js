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
 * unexplored tiles black, seen ones grey, the minimap masked, resources as the
 * fog of war shows them and no map yields on unexplored tiles; unit flags,
 * district bars and world texts hidden where the leader cannot see now, and
 * banners where they never explored. The UI's revealed-state lookups answer
 * for the viewed leader; only tiles whose state changed are redrawn. Drawing
 * only; never game state.
 */
import LensManager from 'fs://game/core/ui/lenses/lens-manager.js';
import { ResourceLensLayer } from 'fs://game/base-standard/ui/lenses/layer/resource-layer.js';
import 'fs://game/base-standard/ui/lenses/layer/yields-layer.js';   // registers the yields layer patched below
import DistrictHealthManager from 'fs://game/base-standard/ui/district/district-health-manager.js';
import { DistrictHealthBar } from 'fs://game/base-standard/ui/district/district-health.js';
import WorldAnchorTextManager from 'fs://game/base-standard/ui/world-anchor-text/world-anchor-text-manager.js';
import { UnitFlagManager } from 'fs://game/base-standard/ui/unit-flags/unit-flag-manager.js';
import { GenericUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags.js';
import { IndependentPowersUnitFlag } from 'fs://game/base-standard/ui/unit-flags/unit-flags-independent-powers.js';
import { OVERLAY_PRIORITY } from 'fs://game/base-standard/ui/utilities/utilities-overlay.js';
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { ancestorWithClass, createLogger, deferOnce, setStyle, wrapMethod } from '../shared/zom-util.js';
import { CONFIG, ICONS } from './observer-config.js';
import { inDiplomacyMode, isObserverSeat, onObserverReady } from './observer-core.js';
import { forEachBanner } from './observer-settlement-banners.js';

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
const YIELDS_LAYER = 'fxs-yields-layer';
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
let suppressedPlots = new Set(); // plots whose real resource icons are hidden (unexplored or seen)
let shownKey = '';         // the revealed states currently drawn
let shownUnexploredKey = '';     // the unexplored plots currently drawn
let shownSeen = new Set();       // plots currently drawn as seen
let overlayGroup = null;
let unexploredOverlay = null;
let seenOverlay = null;
let seenResources = null;       // fog-of-war resource icons on tiles seen before
let seenResourceTypes = null;
let yieldlessPlots = new Set();  // plots whose map yields are hidden (the viewed leader never explored them)

const isActive = () => viewed != null && isObserverSeat();
/** The leader whose view is shown, else null. */
const perspectivePlayer = () => (isActive() ? viewed : null);

/** Whether a plot is in sight in the shown view: always without a Perspective, else when the viewed leader sees it now. */
function isVisibleInView(loc) {
  return !isActive() || (!!loc && GameplayMap.getRevealedState(viewed, loc.x, loc.y) === RevealedStates.VISIBLE);
}

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
  catch (e) { return isVisibleInView(Units.get(unitId)?.location) ? RevealedStates.VISIBLE : RevealedStates.HIDDEN; }
}

// ============================ Yields ============================

const yieldsLayer = () => LensManager.layers?.get(YIELDS_LAYER);

/** Clear a plot's yield icons, marked hidden so the layer redraws them once shown again. */
function hideYields(layer, plot) {
  layer.yieldSpriteGrid?.clearPlot(plot);
  const state = layer.plotStates?.[plot];
  if (!state) return;
  state.revealedState = RevealedStates.HIDDEN;
  state.yields.clear();
}

/** Map yields hidden on these plots, redrawn on the ones hidden before. */
function syncYields(plots) {
  const layer = yieldsLayer();
  if (!layer) return;
  const previous = yieldlessPlots;
  yieldlessPlots = plots;
  for (const plot of plots) if (!previous.has(plot)) hideYields(layer, plot);
  for (const plot of previous) {
    if (!plots.has(plot)) layer.updatePlotState(plot, layer.revealedStates[plot], layer.calculateConstructibleState(plot));
  }
}

/** The yields layer leaves hidden plots alone (its own updates would draw them again). */
function patchYields() {
  const layer = yieldsLayer();
  if (!wrapMethod(layer, 'updatePlotState', (base, plot, ...rest) => (yieldlessPlots.has(plot) ? hideYields(layer, plot) : base(plot, ...rest)))) {
    log('yields layer not patched');
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

/** The plots of `after` not in `before`, and of `before` not in `after`. */
function plotChanges(before, after) {
  const added = [];
  const removed = [];
  for (const plot of after) if (!before.has(plot)) added.push(plot);
  for (const plot of before) if (!after.has(plot)) removed.push(plot);
  return { added, removed };
}

/**
 * The resource layer's real icons hidden on these plots (the seen ones get fog-of-war icons
 * instead): only the plots that changed are touched, through the layer's own per-plot steps.
 */
function syncResources(plots) {
  const layer = ResourceLensLayer.instance;
  const { added, removed } = plotChanges(suppressedPlots, plots);
  suppressedPlots = plots;
  try {
    if (!layer.suppressedPlots || !layer.clearResourceSpritesFromPlot) {   // the layer changed: whole-set fallback
      layer.clearSuppressedPlots();
      if (plots.size) layer.suppressPlots([...plots]);
      return;
    }
    for (const plot of added) { layer.clearResourceSpritesFromPlot(plot); layer.suppressedPlots.add(plot); }
    if (!removed.length) return;
    const restore = layer.suppressedPlots;
    layer.suppressedPlots = new Set(removed);
    layer.clearSuppressedPlots();   // redraws exactly the removed plots
    for (const plot of removed) restore.delete(plot);
    layer.suppressedPlots = restore;
  } catch (e) { log(`resource icons not updated: ${e}`); }
}

/** The seen plots' fog-of-war resource icons, only the changed plots redrawn. */
function syncSeenResources(seen) {
  const { added, removed } = plotChanges(shownSeen, seen);
  shownSeen = seen;
  for (const plot of removed) { seenResources?.clearPlot(plot); seenResourceTypes?.clearPlot(plot); }
  drawSeenResources(added);
}

function clearMap() {
  filterPlots = null;
  unexploredPlots = [];
  syncFilter();
  overlayGroup?.clearAll();
  syncYields(new Set());
  syncResources(new Set());
  seenResources?.clear();
  seenResourceTypes?.clear();
  shownSeen = new Set();
  shownKey = '';
  shownUnexploredKey = '';
}

/**
 * Fog for the viewed leader, redrawn only when their revealed tiles changed. Tiles going in
 * and out of sight (every unit move) only update the seen overlay and the resource icons of
 * the tiles that changed; the unexplored overlay, filter and yields follow newly explored tiles.
 */
function drawMap() {
  const states = revealedStates(viewed);
  if (!states.length) { clearMap(); clearMinimap(); return; }
  const key = Array.prototype.join.call(states, '');
  drawMinimap(states, key);
  if (key === shownKey) return;
  const unexplored = plotsWhere(states, (s) => s === RevealedStates.HIDDEN);
  const seen = plotsWhere(states, (s) => s === RevealedStates.REVEALED);
  overlayGroup ??= WorldUI.createOverlayGroup('ZOMPerspectiveOverlayGroup', OVERLAY_PRIORITY.HEX_GRID);
  unexploredOverlay ??= overlayGroup.addPlotOverlay();
  seenOverlay ??= overlayGroup.addPlotOverlay();
  const unexploredKey = unexplored.join(',');
  if (unexploredKey !== shownUnexploredKey) {
    unexploredPlots = unexplored;
    filterPlots = plotsWhere(states, (s) => s !== RevealedStates.HIDDEN);
    syncFilter();
    unexploredOverlay.clear();
    unexploredOverlay.addPlots(unexplored, { fillColor: CONFIG.perspectiveUnexploredFill });
    syncYields(new Set(unexplored));
    shownUnexploredKey = unexploredKey;
  }
  seenOverlay.clear();
  seenOverlay.addPlots(seen, { fillColor: CONFIG.perspectiveSeenFill });
  syncResources(new Set([...unexplored, ...seen]));
  syncSeenResources(new Set(seen));
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

/** The game's greyed fog-of-war resource icons added on the given plots. */
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
  const hidden = isActive() && !!loc && !isVisibleInView(loc);
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

/** The Unit List is the Observer's only while Perspective shows a leader, and then lists that leader's units. */
function syncUnitListButton() {
  if (!isObserverSeat()) return;
  const button = document.querySelector(`.mini-map__lens-button[data-tooltip-content="${Locale.compose('LOC_UI_TOGGLE_UNIT_LIST_PANEL')}"]`);
  if (button) button.style.display = isActive() ? '' : 'none';
  if (!isActive() && ContextManager.hasInstanceOf('panel-unit-list')) ContextManager.pop('panel-unit-list');
}

/** The UI's visibility lookups for the local seat answer for the viewed leader while active. */
function patchVisibilityLookups() {
  try {
    wrapMethod(GameplayMap, 'getRevealedState', (base, playerId, ...rest) => base(seatFor(playerId), ...rest));
    wrapMethod(GameplayMap, 'getRevealedStates', (base, playerId, ...rest) => base(seatFor(playerId), ...rest));
    wrapMethod(Visibility, 'isVisible', (base, playerId, ...rest) => base(seatFor(playerId), ...rest));
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
    if (loc && !isVisibleInView(loc)) return;
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
  try { syncUnitListButton(); } catch (e) { log(`unit list button failed: ${e}`); }
  window.dispatchEvent(new CustomEvent(PERSPECTIVE_CHANGED_EVENT));
  return fog;
}

/** Show the player's view, or return to the Observer's own when it is already shown. Returns whether it is now shown. */
function togglePerspective(playerId) {
  const previous = viewed;
  viewed = viewed === playerId ? null : playerId;
  if (previous != null && viewed != null) clearMap();   // another leader: their fog-of-war icons differ too
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
  patchYields();
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
engine.on('minimap-panel-initialized', syncUnitListButton);   // the mini-map (and its Unit List button) is built after load
onObserverReady(syncUnitListButton);

export {
  PERSPECTIVE_CHANGED_EVENT, endPerspective, isActive as isPerspectiveActive, isKnownInPerspective, isVisibleInView, markPerspectiveCard, perspectivePlayer,
  togglePerspective
};
