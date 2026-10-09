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
 * (produced or purchased) and a rural one the improvement, each in the
 * colour of its main yield (its dot gold for urban, silver for rural), a
 * specialist one on a glowing gold pin naming the buildings it was placed
 * with - the leader's population as the Total (each kind on hover) and a card
 * of its specialists at the end of the view (now, for the current Age), on
 * hover each settlement's quarters and other tiles with specialists.
 */
import { currentAgeChronology } from '../shared/zom-util.js';
import { leaderDetails, POPULATION_KINDS, specialistTiles } from './observer-empire.js';
import { yieldColor } from './observer-graph-yields.js';
import { byCount, sumBy } from './observer-graph-timelines.js';
import { TRAIN_METHODS } from './observer-unit-log.js';

const SPECIALIST = POPULATION_KINDS.findIndex((k) => k.id === 'specialist');

const kindLabel = (source) => Locale.compose(POPULATION_KINDS[source.category]?.label ?? '');
const constructibleName = (type) => Locale.compose(GameInfo.Constructibles.lookup(type)?.Name ?? '');
/** The thing that brought the citizen: a building or an improvement (a specialist is shown as one). */
const shownType = (source) => (source.category === SPECIALIST ? '' : source.type);

/** The building's or improvement's icon, else the kind of citizen's. */
const iconOf = (source) => (shownType(source) ? UI.getIconCSS(source.type) : POPULATION_KINDS[source.category]?.icon ?? '');

/** The yield each improvement works, by its type without "_RESOURCE" (its warehouse building's). */
const IMPROVEMENT_YIELDS = {
  IMPROVEMENT_FARM: 'YIELD_FOOD',
  IMPROVEMENT_PASTURE: 'YIELD_FOOD',
  IMPROVEMENT_PLANTATION: 'YIELD_FOOD',
  IMPROVEMENT_FISHING_BOAT: 'YIELD_FOOD',
  IMPROVEMENT_MINE: 'YIELD_PRODUCTION',
  IMPROVEMENT_QUARRY: 'YIELD_PRODUCTION',
  IMPROVEMENT_CLAY_PIT: 'YIELD_PRODUCTION',
  IMPROVEMENT_WOODCUTTER: 'YIELD_PRODUCTION',
  IMPROVEMENT_CAMP: 'YIELD_PRODUCTION',
  IMPROVEMENT_OIL_RIG: 'YIELD_PRODUCTION'
};
const baseType = (type) => type.replace(/_RESOURCE$/, '');

let mainYields = null;
/**
 * Each constructible's main yield type: an improvement's (IMPROVEMENT_YIELDS),
 * else a building's largest base yield, else the most common yield the game
 * adds to it.
 */
function mainYield(type) {
  if (IMPROVEMENT_YIELDS[baseType(type)]) return IMPROVEMENT_YIELDS[baseType(type)];
  if (!mainYields) {
    mainYields = new Map();
    const best = new Map();   // type -> Map<yield, weight>
    const weigh = (constructible, yieldType, weight) => {
      if (!constructible || !yieldType || !(weight > 0)) return;
      const weights = best.get(constructible) ?? new Map();
      weights.set(yieldType, Math.max(weights.get(yieldType) ?? 0, 0) + weight);
      best.set(constructible, weights);
    };
    try { for (const row of GameInfo.Constructible_YieldChanges ?? []) weigh(row.ConstructibleType, row.YieldType, Number(row.YieldChange)); } catch (e) { /* none */ }
    try { for (const row of GameInfo.Warehouse_YieldChanges ?? []) weigh(row.ConstructibleInCity, row.YieldType, 1); } catch (e) { /* none */ }
    for (const [constructible, weights] of best) mainYields.set(constructible, [...weights].sort(byCount)[0][0]);
  }
  return mainYields.get(type) ?? mainYields.get(baseType(type));
}

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

const SPECIALIST_KIND = POPULATION_KINDS[SPECIALIST];

/** A tile's row: its buildings ("Library, Barracks"), "Quarter" under them when there are two or more, and its specialists. */
function tileRow(buildings, count) {
  const types = buildings ? buildings.split('+') : [];
  return {
    icon: SPECIALIST_KIND.icon,
    label: types.map(constructibleName).join(', ') || Locale.compose(SPECIALIST_KIND.label),
    detail: types.length > 1 ? Locale.compose('LOC_PLOT_TOOLTIP_QUARTER') : '',
    value: count
  };
}

/**
 * The card's hover: each settlement's tiles with specialists now (the current
 * Age), else the tiles the view's specialists were placed on.
 */
function specialistGroups(playerId, events, current) {
  if (current) {
    try { return specialistTiles(playerId).map((s) => ({ title: s.name, rows: s.tiles.map((t) => tileRow(t.buildings, t.count)) })); } catch (e) { /* the log below */ }
  }
  const placed = [...sumBy(events.filter((e) => e.category === SPECIALIST), (e) => e.type)].sort(byCount);
  return [{ title: Locale.compose(SPECIALIST_KIND.label), rows: placed.map(([buildings, count]) => tileRow(buildings, count)) }];
}

const POPULATION_SUBJECT = {
  looks: { population: { color: '#e3a868', background: 'bg_victory_economic3' } },
  categories: POPULATION_KINDS,
  pinIcon: iconOf,
  pinColor: (source) => (shownType(source) ? yieldColor(mainYield(source.type)) : null),
  icon: iconOf,
  name: (source) => (shownType(source) ? constructibleName(source.type) : kindLabel(source)),
  detail: populationDetail,
  sourceOf: (event) => ({ how: event.how }),
  value: (playerId, { lastAge }) => citizenCounts(playerId, lastAge).reduce((a, b) => a + b, 0),
  totalGroups: (entry) => [POPULATION_KINDS.map((k, i) => ({ icon: k.icon, label: Locale.compose(k.label), value: entry?.card.counts[i] ?? 0 }))],
  card: (playerId, { events, lastAge }) => {
    const counts = citizenCounts(playerId, lastAge);
    const groups = specialistGroups(playerId, events, lastAge === currentAgeChronology());
    return {
      counts,
      cells: [{ icon: SPECIALIST_KIND.icon, count: counts[SPECIALIST] }],
      groups: groups.some((g) => g.rows.length) ? groups : [[{ icon: SPECIALIST_KIND.icon, label: Locale.compose(SPECIALIST_KIND.label), value: counts[SPECIALIST] }]]
    };
  },
  tieBreak: (entry) => entry.card.counts[SPECIALIST]
};

export { POPULATION_SUBJECT };
