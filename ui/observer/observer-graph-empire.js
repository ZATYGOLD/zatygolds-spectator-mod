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
 * The Empire timeline view (observer-graph-timelines.js): a Settlements tab
 * (observer-graph-settlements.js) and a Population tab
 * (observer-graph-population.js), each with its own subject.
 */
import { EMPIRE_EVENT, populationLog } from './observer-empire.js';
import { POPULATION_SUBJECT } from './observer-graph-population.js';
import { SETTLEMENTS_SUBJECT } from './observer-graph-settlements.js';
import { SETTLEMENT_LOG_EVENT, settlementLog } from './observer-settlement-log.js';

const EMPIRE_VIEW = {
  id: 'empire',
  kind: 'timeline',
  label: 'LOC_ZOM_GRAPH_EMPIRE',
  tabs: [
    { id: 'settlements', label: 'LOC_ZOM_GRAPH_SETTLEMENTS', description: 'LOC_ZOM_GRAPH_SETTLEMENTS_DESC', info: 'LOC_ZOM_GRAPH_SETTLEMENTS_INFO', subject: SETTLEMENTS_SUBJECT },
    { id: 'population', label: 'LOC_ZOM_GRAPH_POPULATION', description: 'LOC_ZOM_GRAPH_POPULATION_DESC', info: 'LOC_ZOM_GRAPH_POPULATION_INFO', subject: POPULATION_SUBJECT }
  ],
  read: () => [...settlementLog(), ...populationLog()],
  changeEvents: [SETTLEMENT_LOG_EVENT, EMPIRE_EVENT]
};

export { EMPIRE_VIEW };
