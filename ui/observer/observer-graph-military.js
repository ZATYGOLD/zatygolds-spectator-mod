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
 * Zatygold's Spectator - Military graphs (in-game scope).
 *
 * The Military view, the tabs busy from the start first: a Strength line graph
 * of each leader's share of the world's (observer-military-history.js), the
 * unit timelines (observer-graph-units.js), then Promotions, Wars and Conflicts
 * (observer-graph-promotions.js, observer-graph-wars.js, observer-graph-battles.js).
 * Each tab names its source ({ kind, read, changeEvents }) and, for a timeline, its subject.
 */
import { BATTLE_LOG_EVENT, battleLog } from './observer-battle-log.js';
import { BATTLES_SUBJECT } from './observer-graph-battles.js';
import { PROMOTIONS_SUBJECT } from './observer-graph-promotions.js';
import { UNITS_SOURCE, UNITS_SUBJECT } from './observer-graph-units.js';
import { WARS_SUBJECT } from './observer-graph-wars.js';
import { MILITARY_EVENT, militaryHistory } from './observer-military-history.js';
import { PROMOTION_LOG_EVENT, promotionLog } from './observer-promotion-log.js';
import { UNIT_LOGS } from './observer-unit-log.js';
import { WAR_LOG_EVENT, warLog } from './observer-war-log.js';

const timeline = (read, changeEvent) => ({ kind: 'timeline', read, changeEvents: [changeEvent] });
const logTab = (id, subject, source, extra = {}) => {
  const key = `LOC_ZOM_GRAPH_${id.toUpperCase()}`;
  return { id, label: key, description: `${key}_DESC`, info: `${key}_INFO`, subject, source, ...extra };
};

const MILITARY_VIEW = {
  id: 'military',
  label: 'LOC_ZOM_GRAPH_MILITARY',
  get tabs() {
    return [
      {
        id: 'strength',
        slot: 0,
        label: 'LOC_ZOM_GRAPH_STRENGTH',
        look: { color: '#d99a5b', background: 'bg_victory_military' },
        description: Locale.compose('LOC_ZOM_GRAPH_STRENGTH_DESC'),
        valueLabel: Locale.compose('LOC_ZOM_GRAPH_TOTAL_COLUMN'),
        axisLabel: Locale.compose('LOC_ZOM_GRAPH_STRENGTH_SHARE'),
        share: true,
        source: { kind: 'line', read: militaryHistory, changeEvents: [MILITARY_EVENT] }
      },
      ...UNIT_LOGS.map((tab) => ({ ...tab, info: `${tab.label}_INFO`, subject: UNITS_SUBJECT, source: UNITS_SOURCE })),
      logTab('promotions', PROMOTIONS_SUBJECT, timeline(promotionLog, PROMOTION_LOG_EVENT)),
      logTab('wars', WARS_SUBJECT, timeline(warLog, WAR_LOG_EVENT), { valueLabel: 'LOC_ZOM_GRAPH_TURNS_COLUMN' }),
      logTab('battles', BATTLES_SUBJECT, timeline(battleLog, BATTLE_LOG_EVENT))
    ];
  }
};

export { MILITARY_VIEW };
