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
 * Zatygold's Spectator - Units timelines (in-game scope).
 *
 * The Military view's unit tabs (observer-graph-military.js) of the unit log
 * (observer-unit-log.js): Trained, Lost (fewest first) and Defeated, pins by
 * land, naval, civilian or commander (a pin holding a commander shows it),
 * each with the other player involved or how it was trained; each category on
 * the Total's hover and its commanders (else its most counted unit) on the card.
 */
import { detailText, opponentName, unitFlagIcon, unitTypeName as unitName } from './observer-graph-parts.js';
import { byCount, categoryRows, emptyCard, sumBy } from './observer-graph-timelines.js';
import { TRAIN_METHODS, UNIT_CATEGORIES, UNIT_LOG_EVENT, unitLog } from './observer-unit-log.js';

const COMMANDER = UNIT_CATEGORIES.findIndex((c) => c.id === 'commander');
const MILITARY = 'bg_victory_military';

const CARD_CELLS = 4;   // commanders, else the most counted other unit
const NO_UNITS_ICON = 'url(blp:fi_nar_rew_combat_64)';   // an empty card's
const CARD_ORDER = [COMMANDER, ...UNIT_CATEGORIES.keys()].filter((i, n, all) => all.indexOf(i) === n);   // the hover's categories, commanders first

/** The events' unit types, most counted first: [[type, count]]. */
const rankedTypes = (events) => [...sumBy(events, (e) => e.type)].sort(byCount);

/**
 * The card: each commander type counted in the tab (up to CARD_CELLS), else
 * its most counted other unit, else none yet (0); on hover the units of each
 * category, commanders first.
 */
function unitCard(playerId, { events }) {
  const commanders = rankedTypes(events.filter((e) => e.category === COMMANDER));
  const shown = commanders.length ? commanders.slice(0, CARD_CELLS) : rankedTypes(events).slice(0, 1);
  const row = ([type, count]) => ({ icon: UI.getIconCSS(type), label: unitName(type), value: count });
  const groups = CARD_ORDER.map((i) => ({ title: Locale.compose(UNIT_CATEGORIES[i].label), rows: rankedTypes(events.filter((e) => e.category === i)).map(row) }));
  if (!shown.length) return emptyCard(NO_UNITS_ICON);
  return { cells: shown.map(([type, count]) => ({ icon: unitFlagIcon(type), count })), groups };
}

/** The category, with the other player involved or how the unit was trained: "Land Combat Units · Augustus". */
function unitDetail(source) {
  const how = TRAIN_METHODS.find((m) => m.id === source.how)?.label;
  const detail = source.other >= 0 ? opponentName(source.other) : how && Locale.compose(how);
  return detailText(Locale.compose(UNIT_CATEGORIES[source.category]?.label ?? ''), detail);
}

const UNITS_SOURCE = { kind: 'timeline', read: unitLog, changeEvents: [UNIT_LOG_EVENT] };

const UNITS_SUBJECT = {
  looks: {
    trained: { color: '#d99a5b', background: MILITARY },
    lost: { color: '#a3a3ad', background: MILITARY },
    defeated: { color: '#e0705a', background: MILITARY }
  },
  categories: UNIT_CATEGORIES,
  priority: [COMMANDER],
  pinIcon: (source) => unitFlagIcon(source.type),
  icon: (source) => UI.getIconCSS(source.type),
  name: (source) => unitName(source.type),
  detail: unitDetail,
  sourceOf: (event) => ({ other: event.other, how: event.how }),
  card: unitCard,
  tieBreak: (entry) => entry.totals[COMMANDER],
  totalGroups: (entry) => categoryRows(UNIT_CATEGORIES, entry)
};

export { UNITS_SOURCE, UNITS_SUBJECT };
