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
 * Zatygold's Spectator - settlement facts (in-game scope).
 *
 * A town's focus, an independent's or city-state's type and suzerain bonus, the
 * settlement at a plot, and which settlement each on-screen banner shows (banner elements carry no id, so
 * they are matched by the name they compose).
 */
import { ancestorWithClass } from '../shared/zom-util.js';

const BANNER_CLASS = 'city-banner';
const VILLAGE_TYPES = ['IMPROVEMENT_VILLAGE', 'IMPROVEMENT_ENCAMPMENT'];
const INDEX_EVENTS = ['CityInitialized', 'CityRemovedFromMap', 'CityNameChanged', 'CityTransfered', 'DistrictAddedToMap', 'DistrictRemovedFromMap'];

/** City-state types as the base banner draws them (icon, tint, name). */
const CITY_STATE_TYPES = {
  MILITARISTIC: { name: 'LOC_ATTRIBUTE_MILITARISTIC', icon: 'blp:bonustype_militaristic.png', color: '#AF1B1C' },
  SCIENTIFIC: { name: 'LOC_ATTRIBUTE_SCIENTIFIC', icon: 'blp:bonustype_scientific.png', color: '#4D7C96' },
  ECONOMIC: { name: 'LOC_ATTRIBUTE_ECONOMIC', icon: 'blp:bonustype_economic.png', color: '#FFD553' },
  CULTURAL: { name: 'LOC_ATTRIBUTE_CULTURAL', icon: 'blp:bonustype_cultural.png', color: '#892BB3' },
  DIPLOMATIC: { name: 'LOC_ATTRIBUTE_POLITICAL', icon: 'blp:bonustype_diplomatic.png', color: '#255BE4' },
  EXPANSIONIST: { name: 'LOC_ATTRIBUTE_EXPANSIONIST', icon: 'blp:bonustype_expansionist.png', color: '#00A717' },
  CIVILIZATION_INDEPENDENT: { name: 'LOC_IMPROVEMENT_ENCAMPMENT_NAME', icon: 'blp:bonustype_crisis.png', color: '#AF1B1C' }
};

let independentTypes = null;   // CityStateName -> CityStateType (the last row wins, as the base banner reads it)

/** An independent's or city-state's type: { name, icon, color } (text key, image url, tint), else null. */
function cityStateType(player) {
  if (!player) return null;
  if (!independentTypes) {
    independentTypes = new Map();
    GameInfo.Independents.forEach((def) => independentTypes.set(def.CityStateName, def.CityStateType));
  }
  const type = independentTypes.get(player.civilizationAdjective) ?? GameInfo.Civilizations.lookup(player.civilizationType)?.CivilizationType;
  return CITY_STATE_TYPES[type] ?? null;
}

/** The suzerain bonus chosen for a city-state: { name, description } (text keys), else null. */
function cityStateBonus(playerId) {
  try {
    const hash = Game.CityStates.getBonusType(playerId);
    const def = GameInfo.CityStateBonuses.find((row) => row.$hash == hash);   // loose, as the base banner compares it
    return def ? { name: def.Name, description: def.Description } : null;
  } catch (e) { return null; }
}

/** A city-state's suzerain id, else null. */
function suzerainOf(player) {
  return player?.isMinor && player.Influence?.hasSuzerain ? player.Influence.getSuzerain() : null;
}

/** A town's focus: { name, description, icon } (text keys, image url); null for a city. */
function townFocus(city) {
  if (!city?.isTown || !city.Growth) return null;
  if (city.Growth.growthType === GrowthTypes.EXPAND) {
    return { name: 'LOC_UI_FOOD_CHOOSER_FOCUS_GROWTH', description: 'LOC_PROJECT_TOWN_FOOD_INCREASE_DESCRIPTION', icon: UI.getIconURL('PROJECT_GROWTH') };
  }
  const project = GameInfo.Projects.lookup(city.Growth.projectType);
  return project ? { name: project.Name, description: project.Description, icon: UI.getIconURL(project.ProjectType) } : null;
}

/** The settlement whose centre is a plot, else null (one gone from the map, razed). */
function cityAt(plot) {
  const at = GameplayMap.getLocationFromIndex(plot);
  const id = at && MapCities.getCity(at.x, at.y);
  return (id && Cities.get(id)) ?? null;
}

// ============================ Banners ============================

let cachedIndex = null;

/** Every settlement a banner can show, by composed name: { owner, city (null for a village), locations }. */
function buildIndex() {
  const index = new Map();
  const add = (name, entry) => {
    const key = Locale.compose(name);
    if (!index.has(key)) index.set(key, entry);
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

/** The settlement index, rebuilt when settlements change (or fresh). */
function settlementIndex(fresh = false) {
  if (fresh || !cachedIndex) cachedIndex = buildIndex();
  return cachedIndex;
}

/** The settlement a banner element shows, else null (a miss rebuilds the index once). */
function bannerSubject(banner) {
  const name = banner?.querySelector('.city-banner__name')?.textContent?.trim();
  if (!name) return null;
  return settlementIndex().get(name) ?? settlementIndex(true).get(name) ?? null;
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
  for (const event of INDEX_EVENTS) engine.on(event, () => { cachedIndex = null; });
});

export { bannerOf, bannerSubject, cityAt, cityStateBonus, cityStateType, forEachBanner, suzerainOf, townFocus };
