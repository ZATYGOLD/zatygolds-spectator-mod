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
 * Zatygold's Spectator - Observer promotion log (in-game scope).
 *
 * Records, per leader, each promotion and commendation its commanders earn: one
 * a commander did not have when first seen. An event log (observer-event-log.js)
 * with the fields "<UnitPromotionType>,<UnitPromotionDisciplineType>,<UnitType>,<unitId>,<category>"
 * (the PROMOTION_CATEGORIES index, missing in older entries).
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG, HIGHLIGHT } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { createEventLog, payloadLogger } from './observer-event-log.js';
import { isCommander, unitKey } from './observer-unit-log.js';

const log = createLogger('observer-promotion-log', CONFIG.debug);
const showPayload = payloadLogger(log);
const PROMOTION_LOG_EVENT = 'zom-promotion-log-changed';

/** Promotions and commendations: pin and dot colour. */
const PROMOTION_CATEGORIES = [
  { id: 'promotion', label: 'LOC_ZOM_GRAPH_PROMOTIONS', color: '#c9ccd6' },
  { id: 'commendation', label: 'LOC_ZOM_GRAPH_COMMENDATIONS', color: '#e3b341', glow: HIGHLIGHT.pinGlow }
];
const COMMENDATION = PROMOTION_CATEGORIES.findIndex((c) => c.id === 'commendation');

const categoryOf = (type) => {
  const row = GameInfo.UnitPromotions.lookup(type);
  return row ? (row.Commendation ? COMMENDATION : 0) : null;
};

/** A saved entry as a promotion, its category as saved (else looked up); null when unknown. */
function decode({ fields: [type, discipline, commander, unit, saved], ...entry }) {
  const category = saved ? Number(saved) : categoryOf(type);
  return PROMOTION_CATEGORIES[category] ? { ...entry, kind: 'promotions', category, type, discipline, commander, unit } : null;
}

/** Each promotion with which of its commander's it is (`nth`) and which of the leader's commanders (`which`, from 0, in the order first promoted). */
function derive(all) {
  const earnedSoFar = new Map();   // "player:unit" -> promotions so far
  const commanders = new Map();     // player -> [units, in the order first promoted]
  return all.map((e) => {
    const key = `${e.playerId}:${e.unit}`;
    const nth = (earnedSoFar.get(key) ?? 0) + 1;
    earnedSoFar.set(key, nth);
    const own = commanders.get(e.playerId) ?? [];
    if (!own.includes(e.unit)) own.push(e.unit);
    commanders.set(e.playerId, own);
    return { ...e, nth, which: own.indexOf(e.unit) };
  });
}

const events = createEventLog({ keyPrefix: 'ZOM_PROMOTION_EVENTS_', fieldCount: 5, minFieldCount: 4, changeEvent: PROMOTION_LOG_EVENT, log, decode, derive });

/** Every logged promotion, oldest first: [{ age, turn, progress, playerId, kind, category, type, discipline, commander, unit, nth, which, count }]. */
const promotionLog = events.read;

const earned = new Map();   // commander "owner:id" -> Set<"discipline:promotion">

/** The commander's promotions: Set<"discipline:promotion">. */
function promotionsOf(unit) {
  const has = new Set();
  for (const row of GameInfo.UnitPromotionDisciplineDetails) {
    if (unit.Experience?.hasPromotion?.(row.UnitPromotionDisciplineType, row.UnitPromotionType)) has.add(`${row.UnitPromotionDisciplineType}:${row.UnitPromotionType}`);
  }
  return has;
}

/** A commander's promotions when first seen. */
function remember(id) {
  const unit = id && Units.get(id);
  if (unit && isCommander(unit.type) && !earned.has(unitKey(id))) earned.set(unitKey(id), promotionsOf(unit));
}

/** Each promotion the commander did not have before. */
function onPromoted(data) {
  showPayload('UnitPromoted', data);
  const unit = data?.unit && Units.get(data.unit);
  if (!unit || !isCommander(unit.type)) return;
  const key = unitKey(data.unit);
  const before = earned.get(key) ?? new Set();
  const now = promotionsOf(unit);
  earned.set(key, now);
  const commander = GameInfo.Units.lookup(unit.type).UnitType;
  for (const entry of now) {
    if (before.has(entry)) continue;
    const [discipline, promotion] = entry.split(':');
    events.record(unit.owner, [promotion, discipline, commander, data.unit.id, categoryOf(promotion) ?? '']);
  }
}

onObserverReady(() => {
  try {
    for (const player of Players.getAlive()) for (const unit of player.Units?.getUnits?.() ?? []) remember(unit.id);
  } catch (e) { log(`commanders not seeded: ${e}`); }
  engine.on('UnitAddedToMap', (data) => remember(data?.unit));
  engine.on('UnitPromoted', onPromoted);
});

export { PROMOTION_CATEGORIES, PROMOTION_LOG_EVENT, promotionLog };
