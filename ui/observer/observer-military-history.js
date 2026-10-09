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
 * At the start of every turn, each watched leader's military strength: the
 * combat strength of all its combat units (each unit's best of melee, ranged
 * and bombard), recorded as a history (observer-history.js) for the graphs.
 */
import { unitStrength } from './observer-core.js';
import { createSampleHistory } from './observer-history.js';

const MILITARY_EVENT = 'zom-military-history-changed';

/** A combat unit's strength (0 for any other). */
const combatStrength = (unit) => (unit.Combat?.isCombat ? Number(unitStrength(unit)) || 0 : 0);

const militaryHistory = createSampleHistory({
  keyPrefix: 'ZOM_MILITARY_HISTORY_',
  changeEvent: MILITARY_EVENT,
  measure: (player) => [(player.Units?.getUnits?.() ?? []).reduce((sum, unit) => sum + combatStrength(unit), 0)],
  liveEvents: ['UnitAddedToMap', 'UnitRemovedFromMap', 'UnitPromoted', 'Combat']   // this turn's strength follows its units
});

export { MILITARY_EVENT, militaryHistory };
