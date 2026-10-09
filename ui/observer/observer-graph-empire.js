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
 * Zatygold's Spectator - Empire graphs (in-game scope).
 *
 * The Empire view: a Territory line graph of each leader's share of the
 * world's tiles (observer-territory-history.js), then the Settlements and
 * Population timelines (observer-graph-settlements.js, observer-graph-population.js),
 * each with its own subject.
 */
import { EMPIRE_EVENT, POPULATION_KINDS, populationLog } from './observer-empire.js';
import { POPULATION_SUBJECT } from './observer-graph-population.js';
import { SETTLEMENTS_SUBJECT } from './observer-graph-settlements.js';
import { SETTLEMENT_LOG_EVENT, settlementLog } from './observer-settlement-log.js';
import { TERRITORY_EVENT, TERRITORY_SLOTS, territoryHistory } from './observer-territory-history.js';

const UNIMPROVED_COLOR = '#8a8578';
const iconOf = (id) => POPULATION_KINDS.find((k) => k.id === id).icon;

/** A leader's tiles on hover: urban, rural and unimproved. */
function territoryGroups(entry) {
  const [tiles, urban, rural] = ['tiles', 'urban', 'rural'].map((key) => entry?.values?.[TERRITORY_SLOTS[key]] ?? 0);
  return [[
    { icon: iconOf('urban'), label: Locale.compose('LOC_DISTRICT_URBAN_NAME'), value: urban },
    { icon: iconOf('rural'), label: Locale.compose('LOC_DISTRICT_RURAL_NAME'), value: rural },
    { color: UNIMPROVED_COLOR, label: Locale.compose('LOC_DISTRICT_UNIMPROVED_NAME'), value: Math.max(0, tiles - urban - rural) }
  ]];
}

const EMPIRE_VIEW = {
  id: 'empire',
  kind: 'timeline',
  label: 'LOC_ZOM_GRAPH_EMPIRE',
  get tabs() {
    return [
      {
        id: 'territory',
        slot: TERRITORY_SLOTS.tiles,
        label: 'LOC_ZOM_GRAPH_TERRITORY',
        look: { color: '#9cc27a', background: 'bg_victory_economic3' },
        description: Locale.compose('LOC_ZOM_GRAPH_TERRITORY_DESC'),
        valueLabel: Locale.compose('LOC_ZOM_GRAPH_TOTAL_COLUMN'),
        axisLabel: Locale.compose('LOC_ZOM_GRAPH_TERRITORY_SHARE'),
        share: true,
        totalGroups: territoryGroups,
        source: { kind: 'line', read: territoryHistory, changeEvents: [TERRITORY_EVENT] }
      },
      { id: 'settlements', label: 'LOC_ZOM_GRAPH_SETTLEMENTS', description: 'LOC_ZOM_GRAPH_SETTLEMENTS_DESC', info: 'LOC_ZOM_GRAPH_SETTLEMENTS_INFO', subject: SETTLEMENTS_SUBJECT },
      { id: 'population', label: 'LOC_ZOM_GRAPH_POPULATION', description: 'LOC_ZOM_GRAPH_POPULATION_DESC', info: 'LOC_ZOM_GRAPH_POPULATION_INFO', subject: POPULATION_SUBJECT }
    ];
  },
  read: () => [...settlementLog(), ...populationLog()],
  changeEvents: [SETTLEMENT_LOG_EVENT, EMPIRE_EVENT]
};

export { EMPIRE_VIEW };
