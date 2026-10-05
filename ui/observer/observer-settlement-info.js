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
 * What the Observer's banners (observer-banners.js), settlement details
 * (observer-settlement.js) and independent / city-state panels
 * (observer-diplomacy.js) show about any leader's settlement: a town's focus,
 * and an independent's or city-state's type and its suzerain's chosen bonus.
 * Read as the base banners and production chooser read them.
 */

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

/** An independent's or city-state's type: { name, icon, color } (text key, image url, tint), else null. */
function cityStateType(player) {
  if (!player) return null;
  let type = GameInfo.Civilizations.lookup(player.civilizationType)?.CivilizationType;
  GameInfo.Independents.forEach((def) => { if (player.civilizationAdjective == def.CityStateName) type = def.CityStateType; });
  return CITY_STATE_TYPES[type] ?? null;
}

/** The suzerain bonus chosen for a city-state: { name, description } (text keys), else null. */
function cityStateBonus(playerId) {
  try {
    const hash = Game.CityStates.getBonusType(playerId);
    const def = GameInfo.CityStateBonuses.find((row) => row.$hash == hash);
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

export { cityStateBonus, cityStateType, suzerainOf, townFocus };
