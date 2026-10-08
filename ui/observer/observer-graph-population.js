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
 * Zatygold's Spectator - Population timeline (in-game scope).
 *
 * The Empire view's Population tab (observer-graph-empire.js) of the
 * population log (observer-empire.js): each leader's growth in urban, rural
 * and specialist citizens on one bar - an urban pin showing the building
 * (produced or purchased), a rural one the improvement, a specialist one
 * naming the buildings it was placed with - the leader's
 * population as the Total and a card of each kind at the end of the view
 * (now, for the current Age).
 */
import { leaderDetails, POPULATION_KINDS } from './observer-empire.js';
import { TRAIN_METHODS } from './observer-unit-log.js';

const [URBAN, SPECIALIST] = [0, 2];

const kindLabel = (source) => Locale.compose(POPULATION_KINDS[source.category]?.label ?? '');
const constructibleName = (type) => Locale.compose(GameInfo.Constructibles.lookup(type)?.Name ?? '');
/** The thing that brought the citizen: a building or an improvement (a specialist is shown as one). */
const shownType = (source) => (source.category === SPECIALIST ? '' : source.type);

/** The building's or improvement's icon, else the kind of citizen's. */
const iconOf = (source) => (shownType(source) ? UI.getIconCSS(source.type) : POPULATION_KINDS[source.category]?.icon ?? '');

/**
 * Under the name: a specialist's buildings ("Library, Academy"), else the kind
 * of citizen with how its building came about ("Urban Population · Purchased").
 */
function populationDetail(source) {
  if (source.category === SPECIALIST) return source.type ? source.type.split('+').map(constructibleName).join(', ') : '';
  if (!source.type) return '';
  const how = TRAIN_METHODS.find((m) => m.id === source.how)?.label;
  return how ? Locale.compose('LOC_ZOM_GRAPH_UNIT_SOURCE', kindLabel(source), Locale.compose(how)) : kindLabel(source);
}

/** The leader's citizens of each kind at the end of the view. */
const citizenCounts = (playerId, lastAge) => {
  const own = leaderDetails(playerId, lastAge);
  return POPULATION_KINDS.map((k) => own.get(k.id) ?? 0);
};

const POPULATION_SUBJECT = {
  looks: { population: { color: '#e3a868', background: 'bg_victory_economic3' } },
  categories: POPULATION_KINDS,
  pinIcon: iconOf,
  icon: iconOf,
  name: (source) => (shownType(source) ? constructibleName(source.type) : kindLabel(source)),
  detail: populationDetail,
  sourceOf: (event) => ({ how: event.how }),
  value: (playerId, { lastAge }) => citizenCounts(playerId, lastAge).reduce((a, b) => a + b, 0),
  card: (playerId, { lastAge }) => {
    const counts = citizenCounts(playerId, lastAge);
    return { urban: counts[URBAN], cells: POPULATION_KINDS.map((k, i) => ({ icon: k.icon, count: counts[i] })) };
  },
  cardHover: false,
  tieBreak: (entry) => entry.card.urban
};

export { POPULATION_SUBJECT };
