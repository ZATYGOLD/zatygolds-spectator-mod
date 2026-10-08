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
 * Zatygold's Spectator - Units graphs (in-game scope).
 *
 * The Units timeline view (observer-graph-timelines.js) of the unit log
 * (observer-unit-log.js): Trained, Lost (ranked fewest first) and Defeated
 * tabs, pins by land combat, naval combat, civilian or commander (a pin
 * holding a commander shows it), each unit with the other player involved or
 * how it was trained, the categories on the Total's hover and a Commanders
 * card with each commander type the leader has.
 */
import { createLogger } from '../shared/zom-util.js';
import { sumBy } from './observer-graph-timelines.js';
import { TRAIN_METHODS, UNIT_CATEGORIES, UNIT_LOG_EVENT, UNIT_LOGS, unitLog } from './observer-unit-log.js';

const log = createLogger('observer-graphs');
const COMMANDER = UNIT_CATEGORIES.findIndex((c) => c.id === 'commander');
const ARMY_COMMANDER = 'UNIT_ARMY_COMMANDER';
const MILITARY = 'bg_victory_military';

const unitName = (type) => Locale.compose(GameInfo.Units.lookup(type)?.Name ?? '');
const flagIcon = (type) => UI.getIconCSS(type, 'UNIT_FLAG');

let commanderOrder = null;
/** Every commander type, in database order. */
const commanderTypes = () => (commanderOrder ??= [...GameInfo.Units].filter((u) => u.FormationClass === 'FORMATION_CLASS_COMMAND').map((u) => u.UnitType));

/** Commander types the leader owns or can train now (the production list's query). */
function currentCommanders(playerId) {
  const types = new Set();
  const player = Players.get(playerId);
  const add = (type) => { const def = GameInfo.Units.lookup(type); if (def?.FormationClass === 'FORMATION_CLASS_COMMAND') types.add(def.UnitType); };
  try {
    for (const unit of player?.Units?.getUnits?.() ?? []) add(unit.type);
    for (const city of player?.Cities?.getCities?.() ?? []) {
      for (const { index, result } of Game.CityOperations.canStartQuery(city.id, CityOperationTypes.BUILD, CityQueryType.Unit) ?? []) {
        if (result.Requirements?.FullFailure || result.Requirements?.Obsolete) continue;
        if (result.Success || result.Requirements?.MeetsRequirements) add(index);
      }
    }
  } catch (e) { log(`commanders of ${playerId} unavailable: ${e}`); }
  return types;
}

/**
 * The Commanders card: a cell per commander type the leader has (logged in
 * the view, or owned or trainable when the view includes the current Age),
 * counted in the tab; each type on hover.
 */
function commanderCard(playerId, { viewEvents, events, totals, current }) {
  const types = current ? currentCommanders(playerId) : new Set();
  for (const e of viewEvents) if (e.category === COMMANDER) types.add(e.type);
  const counts = sumBy(events.filter((e) => e.category === COMMANDER), (e) => e.type);
  const commanders = commanderTypes().filter((type) => types.has(type)).map((type) => ({ type, count: counts.get(type) ?? 0 }));
  if (!commanders.length) {
    const commander = UNIT_CATEGORIES[COMMANDER];
    return {
      cells: [{ icon: flagIcon(ARMY_COMMANDER), count: totals[COMMANDER] }],
      rows: [{ color: commander.color, label: Locale.compose(commander.label), value: totals[COMMANDER] }]
    };
  }
  return {
    cells: commanders.map((c) => ({ icon: flagIcon(c.type), count: c.count })),
    rows: commanders.map((c) => ({ icon: UI.getIconCSS(c.type), label: unitName(c.type), value: c.count }))
  };
}

/** The category, with the other player involved or how the unit was trained: "Land Combat · <player>". */
function unitDetail(source) {
  const category = Locale.compose(UNIT_CATEGORIES[source.category]?.label ?? '');
  const other = source.other >= 0 ? Players.get(source.other)?.name : null;
  const detail = other ?? TRAIN_METHODS.find((m) => m.id === source.how)?.label;
  return detail ? Locale.compose('LOC_ZOM_GRAPH_UNIT_SOURCE', category, Locale.compose(detail)) : category;
}

const UNITS_VIEW = {
  id: 'units',
  kind: 'timeline',
  label: 'LOC_ZOM_GRAPH_UNITS',
  tabs: UNIT_LOGS,
  looks: {
    trained: { color: '#d99a5b', background: MILITARY },
    lost: { color: '#a3a3ad', background: MILITARY },
    defeated: { color: '#e0705a', background: MILITARY }
  },
  categories: UNIT_CATEGORIES,
  featured: COMMANDER,
  read: unitLog,
  changeEvents: [UNIT_LOG_EVENT],
  pinIcon: (source) => flagIcon(source.type),
  icon: (source) => UI.getIconCSS(source.type),
  name: (source) => unitName(source.type),
  detail: unitDetail,
  sourceOf: (event) => ({ other: event.other, how: event.how }),
  card: commanderCard,
  tieBreak: (entry) => entry.totals[COMMANDER],
  totalRows: (entry) => UNIT_CATEGORIES.map((c, i) => ({ color: c.color, label: Locale.compose(c.label), value: entry?.totals[i] ?? 0 }))
};

export { UNITS_VIEW };
