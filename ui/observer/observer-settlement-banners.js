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
 * Zatygold's Spectator - settlement banners (in-game scope).
 *
 * Which settlement each on-screen banner shows. Banners are matched by the
 * name they compose; two settlements sharing a name are told apart by the
 * banner's location when its component has one.
 */
import { ancestorWithClass, componentOf } from '../shared/zom-util.js';

const BANNER_CLASS = 'city-banner';
const VILLAGE_TYPES = ['IMPROVEMENT_VILLAGE', 'IMPROVEMENT_ENCAMPMENT'];
const INDEX_EVENTS = ['CityInitialized', 'CityRemovedFromMap', 'CityNameChanged', 'CityTransfered', 'DistrictAddedToMap', 'DistrictRemovedFromMap'];

let cachedIndex = null;
const misses = new Set();   // names not found after the miss rebuild, until the index changes
let missRebuilt = false;    // the index was already rebuilt for a miss since it last changed

/** Every settlement a banner can show, by composed name: [{ owner, city (null for a village), locations }]. */
function buildIndex() {
  const index = new Map();
  const add = (name, entry) => {
    const key = Locale.compose(name);
    if (index.has(key)) index.get(key).push(entry); else index.set(key, [entry]);
  };
  for (const player of Players.getAlive()) {
    for (const city of player.Cities?.getCities?.() ?? []) add(city.name, { owner: player.id, city, locations: [city.location] });
    if (!player.isIndependent) continue;
    const locations = (player.Constructibles?.getConstructibles() ?? [])
      .filter((c) => VILLAGE_TYPES.includes(GameInfo.Constructibles.lookup(c.type)?.ConstructibleType))
      .map((c) => c.location);
    if (locations.length) add(player.civilizationFullName, { owner: player.id, city: null, locations });
  }
  return index;
}

function resetIndex() {
  cachedIndex = null;
  misses.clear();
  missRebuilt = false;
}

/** The settlements with a composed name; a miss rebuilds the index at most once until it changes (or the next turn). */
function subjectsNamed(name) {
  const fresh = !cachedIndex;
  cachedIndex ??= buildIndex();
  const found = cachedIndex.get(name);
  if (found || misses.has(name)) return found ?? null;
  if (fresh) missRebuilt = true;   // just built: nothing to gain from rebuilding
  if (!missRebuilt) {
    missRebuilt = true;
    cachedIndex = buildIndex();
    const rebuilt = cachedIndex.get(name);
    if (rebuilt) return rebuilt;
  }
  misses.add(name);
  return null;
}

const isPlot = (loc) => Number.isInteger(loc?.x) && Number.isInteger(loc?.y) && loc.x >= 0 && loc.y >= 0;

/** The plot a banner's component is anchored to, else null. */
function bannerLocation(banner) {
  try {
    const component = componentOf(banner);
    if (isPlot(component?.location)) return component.location;
    const city = component?.componentID ? Cities.get(component.componentID) : null;
    return isPlot(city?.location) ? city.location : null;
  } catch (e) { return null; }
}

/**
 * The settlement a banner element shows, else null. Same-named settlements
 * the banner's location cannot tell apart give { owner: null, city: null,
 * locations (all of theirs) }.
 */
function bannerSubject(banner) {
  const name = banner?.querySelector('.city-banner__name')?.textContent?.trim();
  const subjects = name ? subjectsNamed(name) : null;
  if (!subjects) return null;
  if (subjects.length === 1) return subjects[0];
  const at = bannerLocation(banner);
  return (at && subjects.find((s) => s.locations.some((loc) => loc.x === at.x && loc.y === at.y)))
    ?? { owner: null, city: null, locations: subjects.flatMap((s) => s.locations) };
}

/** The banner element containing el, else null. */
const bannerOf = (el) => ancestorWithClass(el, BANNER_CLASS);

/** run(banner, subject) for every banner on screen (subject null when unmatched); returns the banner count. */
function forEachBanner(run) {
  const banners = document.querySelectorAll('.' + BANNER_CLASS);
  for (const banner of banners) run(banner, bannerSubject(banner));
  return banners.length;
}

engine.whenReady.then(() => {
  for (const event of INDEX_EVENTS) engine.on(event, resetIndex);
  engine.on('ConstructibleAddedToMap', (data) => {   // a new independent village (only those: improvements are added all the time)
    if (VILLAGE_TYPES.includes(GameInfo.Constructibles.lookup(data?.constructibleType)?.ConstructibleType)) resetIndex();
  });
  engine.on('TurnBegin', () => { misses.clear(); missRebuilt = false; });
});

export { bannerOf, bannerSubject, forEachBanner };
