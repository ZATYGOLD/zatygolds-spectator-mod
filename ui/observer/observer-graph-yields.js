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
 * Zatygold's Spectator - Yields graphs (in-game scope).
 *
 * The Yields line view (observer-graph-lines.js) of the yield history
 * (observer-history.js): a tab per recorded yield, each leader's yield per turn.
 */
import { HISTORY_EVENT, HISTORY_YIELDS, yieldHistory } from './observer-history.js';

/** Title colour and panel background (the Victories screen's art) per yield. */
const YIELD_LOOK = {
  science: { color: '#6fa6d6', background: 'bg_victory_scientific2' },
  culture: { color: '#b48ee0', background: 'bg_victory_culture' },
  gold: { color: '#ffd553', background: 'bg_victory_economic3' },
  happiness: { color: '#f2a74b', background: 'bg_victory_culture' },
  influence: { color: '#8fd1b0', background: 'bg_victory_economic' },
  food: { color: '#9bd06a', background: 'bg_victory_culture' },
  production: { color: '#d99a5b', background: 'bg_victory_military' }
};

const YIELDS_VIEW = {
  id: 'yields',
  kind: 'line',
  label: 'LOC_ZOM_GRAPH_YIELDS',
  read: yieldHistory,
  changeEvents: [HISTORY_EVENT],
  get tabs() {
    return HISTORY_YIELDS.map((y) => {
      const label = Locale.compose(y.label);
      return {
        id: y.id,
        slot: y.slot,
        label: y.label,
        look: YIELD_LOOK[y.id],
        description: Locale.compose('LOC_ZOM_GRAPH_DESCRIPTION', label),
        valueLabel: Locale.compose('LOC_ZOM_GRAPH_PER_TURN_COLUMN'),
        axisLabel: Locale.compose('LOC_ZOM_GRAPH_PER_TURN', label)
      };
    });
  }
};

export { YIELDS_VIEW };
