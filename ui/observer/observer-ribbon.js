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
 * Zatygold's Spectator - Observer diplomacy ribbon (in-game scope).
 *
 * The base ribbon lists only leaders the local player has met, and an empire
 * with no units meets no one. For the Observer seat the ribbon model is
 * rebuilt from every living major (the Observer's own card last, at the right
 * edge), stats follow the game's "Always Show Ribbon Yields" option (toggled
 * by right-clicking the Observer's portrait), and the Observer's card switches what every
 * card shows (see observer-ribbon-toolbar.js). Portraits show each leader's
 * mood (angry at war, else happy while celebrating); look and highlights are
 * in observer-ribbon-style.js, the Perspective eye in observer-perspective.js.
 * While a Perspective is shown, only the leaders the viewed leader has met
 * get a card (the Observer's own always does).
 *
 * The leader panel (and other diplomacy screens) keep the base compact cards
 * and are never rebuilt by this module: there the base panel re-centres on
 * the selected leader on every rebuild, which reads as the ribbon jumping.
 */
import { DiploRibbonData } from 'fs://game/base-standard/ui/diplo-ribbon/model-diplo-ribbon.js';
import { PanelDiploRibbon } from 'fs://game/base-standard/ui/diplo-ribbon/panel-diplo-ribbon.js';
import { createLogger, wrapMethod } from '../shared/zom-util.js';
import { CONFIG, OBSERVER_VIEW } from './observer-config.js';
import { inDiplomacyMode, inLeaderPanel, isObserverSeat, watchedPlayers } from './observer-core.js';
import { isKnownInPerspective, markPerspectiveCard, PERSPECTIVE_CHANGED_EVENT } from './observer-perspective.js';
import { faithBadges } from './observer-faith.js';
import { openOverview } from './observer-overview.js';
import { bestByType, productionItems, researchItems, scoreItems, worstByType, yieldsItems } from './observer-ribbon-data.js';
import { DETAILS_CHANGED_EVENT, isDetailsHidden, lockCardSize, markCards, markFaith, markRows, setRibbonHidden } from './observer-ribbon-style.js';
import { placeViewButtons } from './observer-ribbon-toolbar.js';

const log = createLogger('observer-ribbon');
const RIGHT_EDGE_CLASS = 'right-4';   // the base panel uses right-24; the Observer's ribbon sits at the edge
const VIEW_ITEMS = {
  [OBSERVER_VIEW.YIELDS]: yieldsItems,
  [OBSERVER_VIEW.RESEARCH]: researchItems,
  [OBSERVER_VIEW.PRODUCTION]: productionItems,
  [OBSERVER_VIEW.SCORE]: scoreItems
};

/** A pantheon badge opens every leader's pantheons (in any Age). */
const FAITH_ACTIONS = { pantheon: () => openOverview('pantheons') };

const METER_VIEWS = new Set([OBSERVER_VIEW.RESEARCH, OBSERVER_VIEW.PRODUCTION]);

let viewMode = CONFIG.defaultView;
const meterRows = new Map(); // player id -> meter markup of the latest model update
let shownMeters = '';        // meters the ribbon was last rebuilt with
let refreshing = false;      // refreshRibbon rebuilds itself after the model update

// ============================ Moods ============================

function isAtWar(player) {
  try { return !!player.Diplomacy?.isAtWarWithAnyMajorCiv?.(); } catch (e) { return false; }
}

function isCelebrating(player) {
  try { return !!player.Happiness?.isInGoldenAge?.(); } catch (e) { return false; }
}

function moodContext(player) {
  if (isAtWar(player)) return 'LEADER_ANGRY';
  return isCelebrating(player) ? 'LEADER_HAPPY' : '';
}

// ============================ Panel ============================

function hudPanel() {
  return document.querySelector('panel-diplo-ribbon');
}

/** Everything the Observer's ribbon needs after the base panel builds it. */
function decorateRibbon(panel) {
  if (!panel) return;
  const hidden = inLeaderPanel();
  setRibbonHidden(panel, hidden);
  if (hidden) return;
  if (inDiplomacyMode()) panel.classList.remove(RIGHT_EDGE_CLASS);
  else {
    panel.classList.remove('right-24');
    panel.classList.add(RIGHT_EDGE_CLASS);
    lockCardSize(panel, viewMode === OBSERVER_VIEW.YIELDS);
    placeViewButtons(panel, viewMode, setView);
  }
  markCardState(panel);
  markPerspectiveCard(panel);
}

/** Per-card state that changes during play: highlights, faith badges, best rows (after every rebuild and in-place update). */
function markCardState(panel) {
  markCards(panel, isCelebrating);
  markFaith(panel, faithBadges, FAITH_ACTIONS);
  markBest(panel);
}

const BEST_VIEWS = new Set([OBSERVER_VIEW.YIELDS, OBSERVER_VIEW.SCORE]);

/** Highest and lowest value per row (Yields and Victories views) and negative numbers. */
function markBest(panel) {
  const ids = BEST_VIEWS.has(viewMode) ? watchedPlayers().filter((p) => isKnownInPerspective(p.id)).map((p) => p.id) : null;
  markRows(panel, ids && bestByType(ids), ids && worstByType(ids));
}

/** Full rebuild of the HUD ribbon, keeping its scroll position (never in diplomacy screens). */
function rebuildRibbon() {
  if (inDiplomacyMode()) return;
  try {
    const panel = hudPanel();
    const component = panel?.maybeComponent ?? panel?.component;
    if (!component) return;
    shownMeters = meterSignature();
    const first = component.firstLeaderIndex;
    component.populateFlags?.();   // decorated by the populateFlags wrapper
    if (first != null && component.firstLeaderIndex !== first) {
      component.firstLeaderIndex = first;
      component.refreshRibbonVis?.();
      decorateRibbon(panel);
    }
  } catch (e) { log(`ribbon rebuild failed: ${e}`); }
}

/** Refresh the model and repaint the cards. */
function refreshRibbon() {
  if (!isObserverSeat()) return;
  refreshing = true;
  try { DiploRibbonData.updateAll(); } catch (e) { log(`ribbon refresh failed: ${e}`); }
  finally { refreshing = false; }
  rebuildRibbon();
}

function setView(view) {
  if (view === viewMode) return;
  viewMode = view;
  refreshRibbon();
}

const meterSignature = () => [...meterRows].join('|');

/**
 * Research / Production meters live in each row's `img`, which the base
 * incremental refresh never repaints; rebuild when a meter changed.
 */
function refreshMeters() {
  if (refreshing || !METER_VIEWS.has(viewMode) || meterSignature() === shownMeters) return;
  rebuildRibbon();
}

// ============================ Model ============================

function patchModel() {
  // Every refresh path builds a card's rows here; the selected view swaps them.
  wrapMethod(DiploRibbonData, 'createPlayerYieldsData', (base, player, ...rest) => {
    if (!isObserverSeat() || !player) return base(player, ...rest);
    if (player.id === GameContext.localPlayerID) return [];   // the Observer's card holds the view buttons
    try {
      const items = VIEW_ITEMS[viewMode](player, () => base(player, ...rest));
      if (METER_VIEWS.has(viewMode)) meterRows.set(player.id, items.map((item) => item.img).join(''));
      return items;
    } catch (e) { return base(player, ...rest); }
  });
  wrapMethod(DiploRibbonData, 'createPlayerSizeData', (base, player, ...rest) =>
    (isObserverSeat() && player?.id === GameContext.localPlayerID ? [] : base(player, ...rest)));

  // On the map stats follow the game's option (live, toggled from the Observer's card); diplomacy screens stay compact.
  const baseStuck = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(DiploRibbonData), 'areRibbonYieldsStuckOnScreen')?.get;
  Object.defineProperty(DiploRibbonData, 'areRibbonYieldsStuckOnScreen', {
    configurable: true,
    get() {
      if (isObserverSeat() && !inDiplomacyMode()) return !isDetailsHidden() || this._userDiploRibbonsToggled === 1;
      return baseStuck ? baseStuck.call(this) : (this._alwaysShowYields === 1 || this._userDiploRibbonsToggled === 1);
    }
  });

  // The base turn-end handler captures an index into playerData and writes
  // through it 250ms later; by then updateAll may have replaced the filtered,
  // reordered array, so the write lands out of bounds (a logged TypeError
  // every turn). Re-register it to look the card up by id at write time.
  try {
    const proto = Object.getPrototypeOf(DiploRibbonData);
    engine.off('PlayerTurnDeactivated', proto.onPlayerTurnDeactivated, DiploRibbonData);
    engine.on('PlayerTurnDeactivated', (data) => {
      setTimeout(() => {
        const card = DiploRibbonData._playerData?.find?.((o) => o.id === data.player);
        if (card) card.isTurnActive = false;
      }, 250);
      DiploRibbonData.onUpdate?.(DiploRibbonData);
    });
  } catch (e) { log(`turn handler not replaced: ${e}`); }

  // Every living major (in a Perspective: those the viewed leader met), the Observer's own card last.
  wrapMethod(DiploRibbonData, 'updateAll', function (base) {
    if (!isObserverSeat()) return base();
    try {
      this.getRibbonDisplayTypesFromUserOptions?.();
      const cards = [];
      let own = null;
      for (const player of Players.getAlive()) {
        if (!player?.isMajor || (player.id !== GameContext.localPlayerID && !isKnownInPerspective(player.id))) continue;
        const data = this.createPlayerData(player, player.Diplomacy, true);
        if (!data) continue;
        data.portraitContext = moodContext(player);
        if (player.id === GameContext.localPlayerID) own = data; else cards.push(data);
      }
      if (own) cards.push(own);
      this._playerData = cards;
      this.onUpdate?.(this);
      this._eventNotificationRefresh?.trigger?.();
      for (const panel of document.querySelectorAll('panel-diplo-ribbon')) markCardState(panel);
      if (!inDiplomacyMode()) refreshMeters();
    } catch (e) {
      log(`observer update failed (${e}); using the base ribbon`);
      base();
    }
  });
}

function patchPanel() {
  const proto = PanelDiploRibbon.prototype;
  // Losing focus minimises the stats and requests a full update; the Observer's
  // stats are pinned and rebuilding moves focus, so that would loop.
  wrapMethod(proto, 'onFocusout', (base, ...args) => (isObserverSeat() ? undefined : base(...args)));
  wrapMethod(proto, 'populateFlags', function (base, ...args) {
    const result = base(...args);
    try { if (isObserverSeat()) decorateRibbon(this.Root); } catch (e) { log(`ribbon decoration failed: ${e}`); }
    return result;
  });
}

/**
 * The model's first updateAll runs before this module loads, so the Observer's
 * ribbon starts empty; seed it once the HUD panel exists.
 */
function seedRibbon(attempts) {
  if (!isObserverSeat()) return;
  refreshRibbon();
  if (!hudPanel() && attempts > 0) setTimeout(() => seedRibbon(attempts - 1), CONFIG.ribbonSeedIntervalMs);
}

patchModel();
patchPanel();
for (const event of ['DiplomacyDeclareWar', 'DiplomacyMakePeace']) engine.on(event, refreshRibbon);
for (const event of [DETAILS_CHANGED_EVENT, PERSPECTIVE_CHANGED_EVENT]) window.addEventListener(event, refreshRibbon);
engine.whenReady.then(() => seedRibbon(CONFIG.ribbonSeedAttempts));
