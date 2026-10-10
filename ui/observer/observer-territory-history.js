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
 * Zatygold's Spectator - Observer territory history (in-game scope).
 *
 * At the start of every turn, each watched leader's territory: the tiles of
 * all its settlements, and of them the urban and the rural (observer-empire.js),
 * recorded as a history (observer-history.js) for the graphs.
 */
import { territoryOf } from './observer-empire.js';
import { createSampleHistory } from './observer-history.js';

const TERRITORY_EVENT = 'zom-territory-history-changed';

/** A sample's value slots. */
const TERRITORY_SLOTS = { tiles: 0, urban: 1, rural: 2 };

const territoryHistory = createSampleHistory({
  keyPrefix: 'ZOM_TERRITORY_HISTORY_',
  changeEvent: TERRITORY_EVENT,
  measure: (player) => { const t = territoryOf(player); return [t.tiles, t.urban, t.rural]; },
  liveEvents: ['PlotOwnershipChanged', 'ConstructibleAddedToMap', 'ConstructibleRemovedFromMap']   // this turn's territory follows its borders and development
});

export { TERRITORY_EVENT, TERRITORY_SLOTS, territoryHistory };
