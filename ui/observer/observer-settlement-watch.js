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
 * Zatygold's Spectator - settlement watch (in-game scope).
 *
 * Every settlement on the map by plot, as last seen, for the logs: each one
 * founded, changing hands (CityTransfered names the last owner as fromPlayer),
 * upgraded from a town to a city, or gone from the map (razed). Settlements
 * already on the map when the game loads are only noted.
 */
import { createLogger } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { onObserverReady } from './observer-core.js';
import { payloadLogger } from './observer-event-log.js';
import { cityAt } from './observer-settlement-info.js';

const log = createLogger('observer-settlement-watch', CONFIG.debug);
const showPayload = payloadLogger(log);

const plotOf = (city) => GameplayMap.getIndexFromLocation(city.location);

/** A settlement as seen now: { plot, owner, name, town, from (who it was taken from, else null) }. */
const snapshot = (city) => ({ plot: plotOf(city), owner: city.owner, name: city.name, town: city.isTown, from: city.originalOwner !== city.owner ? city.originalOwner : null });

const settlements = new Map();   // plot -> snapshot, for every settlement on the map
const listeners = { founded: [], transferred: [], upgraded: [], razed: [] };
const emit = (name, ...args) => listeners[name].forEach((run) => run(...args));

/**
 * Listens to settlement changes: { founded(settlement), transferred(settlement,
 * { from, to, incorporated }), upgraded(settlement), razed(settlement) }, each
 * settlement a snapshot (as it was before changing hands or going, as it is
 * once founded or upgraded).
 */
function watchSettlements(handlers) {
  for (const [name, run] of Object.entries(handlers)) listeners[name].push(run);
}

/** A settlement noted as it is now, keeping who it was taken from while its owner is the same. */
function note(city) {
  const last = settlements.get(plotOf(city));
  const now = snapshot(city);
  if (last) now.from = last.owner === now.owner ? last.from : last.owner;
  settlements.set(now.plot, now);
}

const allSettlements = () => Players.getAlive().flatMap((player) => player.Cities?.getCities?.() ?? []);

function onInitialized(data) {
  showPayload('CityInitialized', data);
  const city = data?.cityID && Cities.get(data.cityID);
  if (!city || settlements.has(plotOf(city))) return;
  note(city);
  emit('founded', settlements.get(plotOf(city)));
}

/** The plot of a settlement a player just lost: one of its own no longer held by it. */
function plotLostBy(owner) {
  return [...settlements].find(([plot, last]) => last.owner === owner && cityAt(plot)?.owner !== owner)?.[0];
}

/** A settlement changing hands, known even when it is gone at once (razed on capture). */
function onTransfered(data) {
  showPayload('CityTransfered', data);
  const from = data?.fromPlayer;
  const to = data?.cityID?.owner;
  const city = data?.cityID && Cities.get(data.cityID);
  const plot = city ? plotOf(city) : plotLostBy(from);
  const known = plot == null ? null : (settlements.get(plot) ?? (city && snapshot(city)));
  log.debug(`transfer: ${known?.name ?? '?'} ${from} -> ${to}`);
  if (known && from != null && to != null && from !== to) {
    settlements.set(plot, { ...known, owner: to, from });
    emit('transferred', known, { from, to, incorporated: data.transferType === CityTransferTypes.BY_INCORPORATE_CITY_STATE });
  }
  sweepSoon();
}

/** Settlements gone from the map: razed. */
function sweep() {
  for (const [plot, last] of settlements) {
    if (cityAt(plot)) continue;
    settlements.delete(plot);
    emit('razed', last);
  }
}
const sweepSoon = () => setTimeout(sweep, 0);   // once the map has settled

/** Towns that became cities since last seen (a city becoming a town is only noted). */
function checkUpgrades() {
  for (const city of allSettlements()) {
    const last = settlements.get(plotOf(city));
    if (!last) continue;
    note(city);
    if (last.owner === city.owner && last.town && !city.isTown) emit('upgraded', settlements.get(last.plot));
  }
}

onObserverReady(() => {
  try { allSettlements().forEach(note); } catch (e) { log(`settlements not seeded: ${e}`); }
  engine.on('CityInitialized', onInitialized);
  engine.on('CityTransfered', onTransfered);
  engine.on('CityRemovedFromMap', sweepSoon);
  engine.on('CityGovernmentLevelChanged', (data) => { showPayload('CityGovernmentLevelChanged', data); checkUpgrades(); });
  engine.on('TurnBegin', () => { sweep(); checkUpgrades(); });
});

export { watchSettlements };
