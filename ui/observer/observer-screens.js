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
 * Zatygold's Spectator - Observer screen routing (in-game scope).
 *
 * Blocks the advisor and Age-start screens, redirects the pantheon, religion
 * and tech / civic chooser screens to their read-only views, and keeps the
 * dock's Religion button in every Age.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import PopupSequencer from 'fs://game/base-standard/ui/popup-sequencer/popup-sequencer.js';
import { createLogger, wrapMethod } from '../shared/zom-util.js';
import { isObserverSeat, onScreenDock, SCREEN_PROPS } from './observer-core.js';
import { CHOOSER_TAGS, openFullTree } from './observer-leader-screens.js';
import { OVERVIEW_PANEL_TAG, setOverviewSource } from './observer-overview.js';

const log = createLogger('observer-screens');
const RELIGION_SCREEN = 'panel-belief-picker';
const RELIGION_UI = 'CAPABILITY_RELIGION_UI';
const RELIGION_BUTTON_CLASS = 'tut-religion';   // the game's own button class

const BLOCKED = new Set(['screen-advisor-council', 'advisor-council-popup', 'screen-dedication-selection', 'screen-advanced-start']);
/** Screen -> what opens instead: an overview source, or another screen. */
const REDIRECTS = {
  'screen-pantheon-chooser': { overview: 'pantheons' },
  'panel-pantheon-complete': { overview: 'pantheons' },
  'panel-religion-picker': { screen: 'panel-belief-picker' }
};

wrapMethod(ContextManager, 'push', (base, target, ...rest) => {
  if (typeof target !== 'string' || !isObserverSeat()) return base(target, ...rest);
  if (BLOCKED.has(target)) return null;
  if (CHOOSER_TAGS.has(target) && openFullTree(target)) return null;
  const redirect = REDIRECTS[target];
  if (!redirect) return base(target, ...rest);
  if (redirect.screen) return base(redirect.screen, ...rest);
  setOverviewSource(redirect.overview);
  return base(OVERVIEW_PANEL_TAG, SCREEN_PROPS);
});

// Blocked popups never enter the queue, so nothing waits on a screen that will not open.
wrapMethod(PopupSequencer, 'addDisplayRequest', (base, request, ...rest) =>
  (isObserverSeat() && BLOCKED.has(request?.screenId) ? request : base(request, ...rest)));

// ============================ Religion after Exploration ============================

/** The game's Religion button (same look and sound), after Great Works as the game places it. */
function placeReligionButton(dock) {
  const root = dock.Root;
  if (!isObserverSeat() || Game.hasCapability(RELIGION_UI) || root?.querySelector('.' + RELIGION_BUTTON_CLASS)) return;
  const button = dock.createButton({
    tooltip: 'LOC_UI_VIEW_RELIGION',
    modifierClass: 'religion',
    callback: dock.openReligionViewer.bind(dock),
    class: RELIGION_BUTTON_CLASS,
    audio: 'religion',
    focusedAudio: 'data-audio-focus-small'
  });
  button.classList.add('ssb__element');
  const greatWorks = root.querySelector('.tut-great-works');
  if (greatWorks) greatWorks.after(button);
  else dock.buttonContainer?.appendChild(button);
}

onScreenDock({
  // The game has no religion screen after Exploration; the Observer keeps the belief screen (button and hotkey).
  patch: (proto) => wrapMethod(proto, 'getReligionScreenName', function (base, ...args) {
    return base(...args) ?? (isObserverSeat() ? RELIGION_SCREEN : undefined);
  }),
  place: placeReligionButton
}, log);
