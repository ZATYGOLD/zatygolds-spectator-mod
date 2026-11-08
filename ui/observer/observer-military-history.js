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
 * Zatygold's Spectator - Observer military history (in-game scope).
 *
 * Each turn, and as units change, each watched leader's military strength
 * (militaryStrength, observer-core.js), recorded as a history
 * (observer-history.js) for the graphs.
 */
import { militaryStrength } from './observer-core.js';
import { createSampleHistory } from './observer-history.js';

const MILITARY_EVENT = 'zom-military-history-changed';

const militaryHistory = createSampleHistory({
  keyPrefix: 'ZOM_MILITARY_HISTORY_',
  changeEvent: MILITARY_EVENT,
  measure: (player) => [militaryStrength(player)],
  liveEvents: ['UnitAddedToMap', 'UnitRemovedFromMap', 'UnitPromoted', 'Combat']   // this turn's strength follows its units
});

export { MILITARY_EVENT, militaryHistory };
