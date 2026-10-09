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
 * Zatygold's Spectator - Promotions timeline (in-game scope).
 *
 * The Military view's Promotions tab (observer-graph-military.js) of the
 * promotion log (observer-promotion-log.js): each leader's commanders'
 * promotions (the tree's icon on a pin in its colour) and commendations (on a
 * glowing gold pin), each commander's joined by a dashed arc; both as the
 * Total and the most earned commendation and tree on the card.
 */
import { detailText, unitFlagIcon, unitTypeName } from './observer-graph-parts.js';
import { byCount, categoryRows, emptyCard, rankedCells, sumBy } from './observer-graph-timelines.js';
import { PROMOTION_CATEGORIES } from './observer-promotion-log.js';

const COMMENDATION = PROMOTION_CATEGORIES.findIndex((c) => c.id === 'commendation');

/** Each discipline (tree) by its name: its icon, as the promotion tree shows it (model-unit-promotion.js), and its pin colour. */
const DISCIPLINES = {
  LOC_DISCIPLINE_ARMY_BASTION_NAME: { icon: 'cPromo_bastion', color: '#5fd06a' },
  LOC_DISCIPLINE_ARMY_ASSAULT_NAME: { icon: 'cPromo_assault', color: '#ff5a52' },
  LOC_DISCIPLINE_LOGISTICS_NAME: { icon: 'cPromo_logistics', color: '#ffd84a' },
  LOC_DISCIPLINE_MANEUVER_NAME: { icon: 'cPromo_manuver', color: '#ff9a3a' },
  LOC_DISCIPLINE_LEADERSHIP_NAME: { icon: 'cPromo_leadership', color: '#4a9aff' },
  LOC_DISCIPLINE_FLEET_BOMBARDMENT_NAME: { icon: 'cPromo_bombardment', color: '#ff6f91' },
  LOC_DISCIPLINE_FLEET_ENGAGEMENT_NAME: { icon: 'cPromo_engagement', color: '#3fd0c9' },
  LOC_DISCIPLINE_SQUADRON_DOGFIGHTING_NAME: { icon: 'cPromo_dogfighting', color: '#9ad0ff' },
  LOC_DISCIPLINE_SQUADRON_RAIDS_NAME: { icon: 'cPromo_raids', color: '#e07ad0' },
  LOC_DISCIPLINE_AIRLIFT_OPERATIONS_NAME: { icon: 'cPromo_airflift_operations', color: '#c0c6d0' },
  LOC_DISCIPLINE_CARRIER_OPERATIONS_NAME: { icon: 'cPromo_carrier_operations', color: '#8a8aff' },
  LOC_DISCIPLINE_ARMY_TRUNG_NHI_NAME: { icon: 'cPromo_trung_nhi', color: '#ff8ac0' }
};

/** A commander type still in the database, else (an earlier Age's unique commander) the army commander it stood for. */
const knownCommander = (type) => (GameInfo.Units.lookup(type) ? type : 'UNIT_ARMY_COMMANDER');
const disciplineName = (type) => GameInfo.UnitPromotionDisciplines.lookup(type)?.Name;
const promotionName = (type) => Locale.compose(GameInfo.UnitPromotions.lookup(type)?.Name ?? '');
const commanderName = (type) => unitTypeName(type) || unitTypeName(knownCommander(type));

/** A hover group: { title, rows } of the events summed by key, most first, each row from its first event. */
function countGroup(title, events, keyOf, rowOf) {
  const rows = [...sumBy(events, keyOf)].sort(byCount).map(([key, value]) => ({ ...rowOf(events.find((e) => keyOf(e) === key)), value }));
  return { title: Locale.compose(title), rows };
}

const disciplineOf = (source) => (source.category === COMMENDATION ? null : DISCIPLINES[disciplineName(source.discipline)]);

const COMMENDATION_ICON = 'url(blp:cPromo_commendation)';   // every commendation's, as the promotion panel shows it
const NO_PROMOTIONS_TYPE = 'UNIT_ARMY_COMMANDER';   // an empty card's flag
/** Each of a leader's commanders' dot colour, in the order first promoted (repeating past the last). */
const COMMANDER_COLORS = ['#ffffff', '#4a9aff', '#ff9a3a', '#5fd06a', '#e07ad0', '#ffd84a', '#3fd0c9', '#ff5a52'];

/** Each commander's promotions joined in order: [[from, to]]. */
function commanderLinks(events) {
  const last = new Map();
  const links = [];
  for (const e of events) {
    if (last.has(e.unit)) links.push([last.get(e.unit), e]);
    last.set(e.unit, e);
  }
  return links;
}

/** The discipline's icon, else the commendation's. */
function iconOf(source) {
  const discipline = disciplineOf(source);
  return discipline ? `url(blp:${discipline.icon})` : COMMENDATION_ICON;
}

/** The commander with which of its promotions this was, and the discipline: "Legatus, promotion 3 · Bastion". */
function promotionDetail(source) {
  const commander = Locale.compose('LOC_ZOM_GRAPH_COMMANDER_PROMOTION', commanderName(source.commander), source.nth);
  const discipline = disciplineName(source.discipline);
  return detailText(commander, discipline && Locale.compose(discipline));
}

const PROMOTIONS_SUBJECT = {
  looks: { promotions: { color: '#d9a21e', background: 'bg_victory_military' } },
  categories: PROMOTION_CATEGORIES,
  priority: [COMMENDATION, 0],   // a pin with a commendation shows it
  pinIcon: iconOf,
  pinColor: (source) => disciplineOf(source)?.color,
  dotColor: (source) => COMMANDER_COLORS[source.which % COMMANDER_COLORS.length],
  icon: iconOf,
  name: (source) => promotionName(source.type),
  detail: promotionDetail,
  sourceOf: (event) => ({ discipline: event.discipline, commander: event.commander, nth: event.nth, which: event.which }),
  links: commanderLinks,
  card: (playerId, { events }) => {
    const promotions = events.filter((e) => e.category !== COMMENDATION);
    const commendations = events.filter((e) => e.category === COMMENDATION);
    const cells = [
      ...rankedCells(sumBy(commendations, (e) => e.type), () => COMMENDATION_ICON, { max: 1 }),
      ...rankedCells(sumBy(promotions, (e) => e.discipline), (discipline) => iconOf(promotions.find((e) => e.discipline === discipline)), { max: 1 })
    ];
    if (!cells.length) return emptyCard(unitFlagIcon(NO_PROMOTIONS_TYPE), 'LOC_ZOM_GRAPH_NO_PROMOTIONS');
    return {
      cells,
      groups: [
        countGroup('LOC_ZOM_GRAPH_COMMENDATIONS', commendations, (e) => e.type, (e) => ({ icon: COMMENDATION_ICON, label: promotionName(e.type) })),
        countGroup('LOC_ZOM_GRAPH_PROMOTIONS', promotions, (e) => e.discipline, (e) => ({ icon: iconOf(e), label: Locale.compose(disciplineName(e.discipline) ?? '') }))
      ]
    };
  },
  totalGroups: (entry) => categoryRows(PROMOTION_CATEGORIES, entry),
  tieBreak: (entry) => entry.totals[0]
};

export { PROMOTIONS_SUBJECT };
