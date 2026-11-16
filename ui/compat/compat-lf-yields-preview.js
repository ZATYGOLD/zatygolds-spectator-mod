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
 * Zatygold's Spectator - Policy Yield Previews compatibility (in-game scope,
 * loaded only with that mod in use).
 *
 * The Policy Yield Previews mod computes every preview for
 * GameContext.localPlayerID: the Observer, who has no empire. While a screen
 * with previews is open on another leader (picked, or the Perspective's),
 * localPlayerID reads as that leader for calls from that mod's files only;
 * everything else keeps the Observer. Its yields cache is rebuilt for the
 * shown leader.
 */
import { PolicyYieldsCache } from 'fs://game/lf-policies-yields-preview/scripts/cache.js';
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from '../observer/observer-config.js';
import { isObserverSeat } from '../observer/observer-core.js';
import { LEADER_VIEW_CHANGED_EVENT, viewedPlayerID } from '../observer/observer-leader-view.js';
import { PERSPECTIVE_CHANGED_EVENT } from '../observer/observer-perspective.js';

const PREVIEW_MOD = 'lf-policies-yields-preview';
const SCREEN_TAGS = ['screen-policies', 'screen-attribute-trees', 'screen-tech-tree', 'screen-culture-tree', 'screen-tech-tree-chooser', 'screen-culture-tree-chooser'];
const PROPERTY = 'localPlayerID';

const log = createLogger('compat-lf-yields-preview', CONFIG.debug);

const openScreens = new Set();
let restore = null;      // undoes the localPlayerID override while installed
let resolving = false;   // reads made while resolving the shown leader get the real id

const fromPreviewMod = () => (new Error().stack ?? '').includes(PREVIEW_MOD);

/** The property's descriptor on GameContext or its prototypes, and the object holding it. */
function findProperty(target) {
  for (let owner = target; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, PROPERTY);
    if (descriptor) return { owner, descriptor };
  }
  return null;
}

/** Shown leader for the preview mod's reads, else the real id. */
function overrideRead(real) {
  if (resolving) return real;
  resolving = true;
  try {
    const shown = viewedPlayerID();
    return shown != null && shown !== real && fromPreviewMod() ? shown : real;
  } finally { resolving = false; }
}

function install() {
  if (restore) return;
  const found = findProperty(GameContext);
  if (!found) { log.once('missing', `GameContext.${PROPERTY} not found: previews stay the Observer's`); return; }
  const { owner, descriptor } = found;
  let value = descriptor.value;
  const readReal = descriptor.get ? () => descriptor.get.call(GameContext) : () => value;
  try {
    Object.defineProperty(GameContext, PROPERTY, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: () => overrideRead(readReal()),
      set: (v) => { if (descriptor.set) descriptor.set.call(GameContext, v); else value = v; }
    });
  } catch (e) { log.once('locked', `GameContext.${PROPERTY} can't be redefined (${e}): previews stay the Observer's`); return; }
  restore = () => {
    if (owner === GameContext) Object.defineProperty(GameContext, PROPERTY, descriptor.get ? descriptor : { ...descriptor, value });
    else delete GameContext[PROPERTY];
  };
}

function uninstall() {
  try { restore?.(); } catch (e) { log(`override not removed: ${e}`); }
  restore = null;
}

function refreshCache() {
  try { PolicyYieldsCache.update(); } catch (e) { log(`yields cache not rebuilt: ${e}`); }
}

class ShownLeaderPreviews {
  constructor(screen) { this.screen = screen; }

  beforeAttach() {
    if (!isObserverSeat()) return;
    openScreens.add(this.screen);
    install();
    refreshCache();
  }

  afterAttach() {}
  beforeDetach() {}

  afterDetach() {
    if (!openScreens.delete(this.screen) || openScreens.size) return;
    uninstall();
    refreshCache();
  }
}

for (const tag of SCREEN_TAGS) Controls.decorate(tag, (screen) => new ShownLeaderPreviews(screen));
for (const event of [LEADER_VIEW_CHANGED_EVENT, PERSPECTIVE_CHANGED_EVENT]) {
  window.addEventListener(event, () => { if (openScreens.size) refreshCache(); });
}
