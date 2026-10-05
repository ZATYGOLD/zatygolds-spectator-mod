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
 * Zatygold's Spectator - Observer in single-player game creation (shell scope).
 *
 *   - Leader select: the Observer's portrait gets the leaders' XP ring, with the
 *     eye in the level bubble (the Observer has no Legend Path level).
 *   - The civilization steps are skipped while the local player is the Observer:
 *     its civilization follows the leader (setup-observer.js). Leader select
 *     goes on to game setup, Back from game setup returns to leader select, and
 *     the Overview's civilization card does nothing.
 *   - Overview: the leader card shows the Observer's portrait (the cutout the
 *     base cards load as blp:lsl_<leader>), the civilization card its
 *     BACKGROUND_VERT art (data/icons/icons.xml), the level ring the eye, and
 *     the Mementos section is hidden (the Observer's memento slots are turned
 *     off in config/setup-rules.sql).
 * Overrides registered ui-next components (ComponentRegistry) and wraps the
 * screen flow's activate; no base file edits.
 */
import { createComponent, createEffect } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { RingMeter } from 'fs://game/core/ui-next/components/ring-meter.js';
import { ScreenFlowContextProvider } from 'fs://game/core/ui-next/components/screen-flow.js';
import { useCivSelectModelContext } from 'fs://game/core/ui-next/screens/create-game/civ-select-model.js';
import 'fs://game/core/ui-next/screens/create-game/create-game-hub.js';
import 'fs://game/core/ui-next/screens/create-game/leader-select-button.js';
import { useLeaderSelectModelContext } from 'fs://game/core/ui-next/screens/create-game/leader-select-model.js';
import { configLeader, createLogger, OBSERVER_LEADER, overrideComponent as overrideRegistered, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './setup-config.js';

const OBSERVER_ICON = 'fs://game/art/icons/zom_observer.png';
const OBSERVER_LEADER_ART = 'fs://game/art/leaders/lsl_zom_observer.png';
const CIV_ART_CONTEXT = 'BACKGROUND_VERT';
const OVERRIDE_PRIORITY = 1;

const CIV_STEPS = new Set(['civ-select', 'civ-details']);
const STEP_LEADER = 'leader-select';
const STEP_GAME_SETUP = 'game-setup';
const STEP_HUB = 'create-game-hub';

/** The Overview's level ring shows the eye instead of a level. */
const LEVEL_EYE_STYLE = {
  'font-size': '0',
  'width': '4rem',
  'height': '4rem',
  'background-image': `url('${OBSERVER_ICON}')`,
  'background-size': 'contain',
  'background-position': 'center',
  'background-repeat': 'no-repeat'
};
const HIDDEN_STYLE = { 'display': 'none' };

const log = createLogger('create-game-observer', CONFIG.debug);

const isLocalObserver = () => configLeader(GameContext.localPlayerID) === OBSERVER_LEADER;

/** As the base screens: no XP rings when mementos work offline (no 2K account). */
function isOfflineMemento() {
  try { return !Network.supportsSSO() && Online.Metaprogression.supportsMemento(); } catch (e) { return false; }
}

function setStyles(el, styles, on) {
  if (!el) return;
  for (const [name, value] of Object.entries(styles)) {
    if (on) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  }
}

function setBackground(el, url) {
  if (el && url) el.style.setProperty('background-image', `url('${url}')`);
}

function overrideComponent(name, wrap) {
  if (!overrideRegistered(name, wrap, OVERRIDE_PRIORITY)) log(`${name} is not registered`);
}

// ============================ Leader select ============================

/** The base level bubble, holding the eye. */
function eyeBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'z-1 leader-button-ring-xp-bubble absolute bottom-0 -ml-4 left-1\\/2 flex items-center justify-center';
  const eye = document.createElement('div');
  setStyles(eye, { ...LEVEL_EYE_STYLE, 'width': '70%', 'height': '70%' }, true);
  bubble.appendChild(eye);
  return bubble;
}

function observerXpRing() {
  return createComponent(RingMeter, {
    'class': 'leader-button-ring-meter',
    value: 0,
    min: 0,
    max: 1,
    ringImage: 'url("blp:leaderselect_xp_fill.png")',
    get children() { return eyeBubble(); }
  });
}

// ============================ Civilization steps ============================

/** Where a civilization step goes for the Observer (null: stay). */
function civStepTarget(flow) {
  switch (flow.active()?.name) {
    case STEP_GAME_SETUP: return STEP_LEADER;   // Back
    case STEP_HUB: return null;                 // the Overview's civilization card
    default: return flow.wasHubVisited() ? STEP_HUB : STEP_GAME_SETUP;
  }
}

// ============================ Overview ============================

/** The Overview's element among a component's output (an element or an array of nodes). */
function hubRoot(view) {
  const nodes = (Array.isArray(view) ? view : [view]).filter((node) => typeof node?.querySelector === 'function');
  return nodes.find((node) => node.querySelector('.create-game-hub-banner')) ?? document.getElementById('create-game');
}

/** Leader card, civilization card (the age card follows). */
function hubCards(root) {
  const cards = root?.querySelectorAll('.create-game-hub-banner') ?? [];
  return [cards[0], cards[1]];
}

function decorateHub(root, observer, civID) {
  const [leaderCard, civCard] = hubCards(root);
  setStyles(leaderCard?.querySelector('.create-game-hub-leader-level'), LEVEL_EYE_STYLE, observer);
  setStyles(root?.querySelector('.text-accent-2.mx-2')?.parentElement, HIDDEN_STYLE, observer);   // Mementos section
  if (!observer) return;
  const layers = leaderCard?.querySelectorAll('div') ?? [];
  setBackground(Array.prototype.find.call(layers, (el) => el.style.backgroundImage?.includes('lsl_')), OBSERVER_LEADER_ART);
  setBackground(civCard?.querySelector('.bg-cover'), UI.getIconURL(civID, CIV_ART_CONTEXT));
}

// ============================ Installation ============================

function install() {
  overrideComponent('LeaderXpRing', (base) => (props) =>
    props.leaderID === OBSERVER_LEADER && !isOfflineMemento() ? observerXpRing() : base(props));

  overrideComponent('CreateGameHub', (base) => (props) => {
    const leaderModel = useLeaderSelectModelContext();
    const civModel = useCivSelectModelContext();
    const view = base(props);
    createEffect(() => {
      const observer = leaderModel.selectedLeader().leaderID === OBSERVER_LEADER;
      const civID = civModel.selectedCiv().civID;
      try { decorateHub(hubRoot(view), observer, civID); } catch (e) { log(`overview failed: ${e}`); }
    });
    return view;
  });

  // Game setup's Back asks for both civ steps in one go: the second is ignored.
  let redirected = false;
  wrapMethod(ScreenFlowContextProvider.prototype, 'activate', function (base, name, ...rest) {
    if (!CIV_STEPS.has(name) || !isLocalObserver()) return base(name, ...rest);
    if (redirected) return false;
    redirected = true;
    setTimeout(() => { redirected = false; }, 0);
    const target = civStepTarget(this);
    log.debug(`${name} -> ${target ?? 'stay'}`);
    return target ? base(target, ...rest) : false;
  });

  log.debug('create-game rules installed');
}

if (CONFIG.observerRole !== false) {
  try { install(); } catch (e) { log(`install failed: ${e}`); }
}
