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
 * Zatygold's Spectator - Observer ribbon stat rows (in-game scope).
 *
 * Builds each leader card's rows for every view in the base ribbon's
 * displayItems shape (the Yields view extends the base rows and remembers the
 * values for the best-in-category highlight). Meters and score rows live in the
 * item's `img` HTML so they fit the narrow card column; they use only markup
 * the Gameface renderer supports (plain <img>, width-based bars).
 */
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { clamp, isAgeTransitionInProgress } from '../shared/zom-util.js';
import { ICONS, METER_COLORS } from './observer-config.js';
import { unitStrength } from './observer-core.js';

const TEXT_COLOR = '#e7d9ac';

/** A stat row: everything is drawn by `img`, the rest feeds tooltips and sorting. */
function displayItem(type, label, img, details, rawValue) {
  return { type, label, value: '', img, details, rawValue, warningThreshold: Infinity };
}

/** Icon, label and a progress bar stacked in one column; pct is 0..100. */
function meterHTML(iconUrl, label, pct, barColor) {
  const p = clamp(Math.round(pct ?? 0), 0, 100);
  const icon = iconUrl ? `<img src='${iconUrl}' style='width:1.7rem;height:1.7rem;'>` : '';
  const name = label
    ? `<div style='font-size:0.66rem;line-height:0.85rem;color:${TEXT_COLOR};text-align:center;margin-top:0.15rem;width:3.8rem;overflow:hidden;'>${label}</div>`
    : '';
  return `<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0.4rem 0.2rem;width:3.95rem;overflow:hidden;'>` +
    icon + name +
    `<div style='width:2.4rem;height:0.22rem;border-radius:0.11rem;background-color:rgba(255,255,255,0.22);margin-top:0.25rem;'>` +
    `<div style='height:100%;border-radius:0.11rem;background-color:${barColor};width:${p}%;'></div></div></div>`;
}

// ============================ Yields ============================

const SIGNED_TYPES = new Set(['gold', 'science', 'culture', 'happiness', 'diplomacy', 'food', 'production']);

/** Full numbers with thousands separators; one decimal under 100. */
function formatCompact(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs < 100) return sign + String(Math.trunc(abs * 10) / 10);
  if (abs < 1000) return sign + String(Math.trunc(abs));
  return sign + Locale.compose('LOC_ZOM_GROUPED_DIGITS', Math.trunc(abs));
}

const formatSigned = (value) => (value >= 0 ? '+' : '') + formatCompact(value);

/** A plain value row in the base ribbon's look. */
function valueRow(type, labelLoc, iconUrl, rawValue) {
  const value = SIGNED_TYPES.has(type) ? formatSigned(rawValue) : formatCompact(rawValue);
  return { type, label: Locale.compose(labelLoc), value, img: `<img src='${iconUrl}'>`, details: '', rawValue, warningThreshold: Infinity };
}

const yieldValue = (player, yieldType) => player.Stats?.getNetYield?.(YieldTypes[yieldType]) ?? 0;

const strengthCache = new Map();   // player id -> military strength, dropped when one of its units changes
const STRENGTH_EVENTS = ['UnitAddedToMap', 'UnitRemovedFromMap', 'UnitDamageChanged', 'UnitPromoted'];

/** Sum of every unit's current base strength (cached until a unit changes). */
function militaryStrength(player) {
  if (strengthCache.has(player.id)) return strengthCache.get(player.id);
  let total = 0;
  try { for (const unit of player.Units?.getUnits?.() ?? []) total += unitStrength(unit); } catch (e) { /* keep the partial sum */ }
  strengthCache.set(player.id, total);
  return total;
}

for (const event of STRENGTH_EVENTS) {
  engine.on(event, (data) => {
    const owner = data?.unit?.owner;
    if (owner == null) strengthCache.clear(); else strengthCache.delete(owner);
  });
}
engine.on('LocalPlayerTurnBegin', () => strengthCache.clear());

/** Civics completed, each mastery level counted. */
function civicsCompleted(player) {
  return (player.Culture?.getResearched?.() ?? []).reduce((sum, node) => sum + (node?.depth ?? 0), 0);
}

function wondersBuilt(player) {
  return (player.Cities?.getCities?.() ?? []).reduce((sum, city) => sum + (city?.Constructibles?.getNumWonders?.() ?? 0), 0);
}

/** Rows added after the base ones, in card order. */
const EXTRA_ROWS = [
  { type: 'food', label: 'LOC_YIELD_FOOD', icon: () => UI.getIconURL('YIELD_FOOD', 'YIELD'), value: (p) => yieldValue(p, 'YIELD_FOOD') },
  { type: 'production', label: 'LOC_YIELD_PRODUCTION', icon: () => UI.getIconURL('YIELD_PRODUCTION', 'YIELD'), value: (p) => yieldValue(p, 'YIELD_PRODUCTION') },
  { type: 'citizens', label: 'LOC_ZOM_OBSERVER_CITIZENS', icon: () => UI.getIconURL('YIELD_POPULATION', 'YIELD'), value: (p) => p.Stats?.totalPopulation ?? 0 },
  { type: 'military', label: 'LOC_ZOM_OBSERVER_MILITARY_STRENGTH', icon: () => ICONS.military, value: militaryStrength },
  { type: 'techs', label: 'LOC_ZOM_OBSERVER_TECHS_COMPLETED', icon: () => ICONS.tech, value: (p) => p.Techs?.getNumTechsUnlocked?.() ?? 0 },
  { type: 'civics', label: 'LOC_ZOM_OBSERVER_CIVICS_COMPLETED', icon: () => ICONS.civic, value: civicsCompleted },
  { type: 'wonders', label: 'LOC_ZOM_OBSERVER_WONDERS_BUILT', icon: () => ICONS.wonders, value: wondersBuilt }
];

/** Latest value per row type and player, for the best-in-category highlight. */
const rowValues = new Map();

function recordValues(playerId, items) {
  for (const item of items) {
    if (!rowValues.has(item.type)) rowValues.set(item.type, new Map());
    rowValues.get(item.type).set(playerId, item.rawValue);
  }
}

/**
 * The base Yields rows (from baseItems()) in compact form, without trade
 * routes (always 0/0 with the Observer), plus food, production, citizens,
 * military strength and techs / civics / wonders completed.
 */
const OWN_ROW_TYPES = new Set(['trade', 'combat', ...EXTRA_ROWS.map((row) => row.type)]);   // rows we drop or build ourselves (also when another mod adds them)

function yieldsItems(player, baseItems) {
  const base = baseItems().filter((item) => !OWN_ROW_TYPES.has(item.type)).map((item) =>
    (SIGNED_TYPES.has(item.type) ? { ...item, value: formatSigned(item.rawValue ?? 0) } : item));
  const extra = EXTRA_ROWS.map((row) => {
    let value = 0;
    try { value = row.value(player) ?? 0; } catch (e) { value = 0; }
    return valueRow(row.type, row.label, row.icon(), value);
  });
  const items = [...base, ...extra];
  recordValues(player.id, items);
  return items;
}

/** Row type -> ids of the leaders holding the marked value; nothing where every leader ties. */
function leadersByType(playerIds, marked) {
  const marks = new Map();
  for (const [type, values] of rowValues) {
    const held = playerIds.filter((id) => values.has(id)).map((id) => [id, values.get(id)]);
    if (!held.length) continue;
    const low = Math.min(...held.map(([, value]) => value));
    const high = Math.max(...held.map(([, value]) => value));
    const top = marked(low, high);
    if (top == null || low === high) continue;
    marks.set(type, new Set(held.filter(([, value]) => value === top).map(([id]) => id)));
  }
  return marks;
}

/** Row type -> ids of the leaders with the highest value (ties included; nothing when the best is 0). */
const bestByType = (playerIds) => leadersByType(playerIds, (low, high) => (high > 0 ? high : null));

/** Row type -> ids of the leaders with the lowest value (only from four leaders up). */
const worstByType = (playerIds) => (playerIds.length < 4 ? new Map() : leadersByType(playerIds, (low) => low));

// ============================ Research ============================

/**
 * The node a player is researching in a tree, mirroring the sub-system dock:
 * { name, turns, icon, progress 0..1 } or null.
 */
function activeResearch(playerID, treeType, tree, isTech) {
  try {
    if (treeType == null) return null;
    const treeObject = Game.ProgressionTrees.getTree(playerID, treeType);
    const activeNode = treeObject?.activeNodeIndex >= 0 ? treeObject.nodes[treeObject.activeNodeIndex] : null;
    const nodeInfo = activeNode ? GameInfo.ProgressionTreeNodes.lookup(activeNode.nodeType) : null;
    if (!nodeInfo) return null;
    let name = Locale.compose(nodeInfo.Name ?? nodeInfo.ProgressionTreeNodeType);
    const nodeData = Game.ProgressionTrees.getNode(playerID, activeNode.nodeType);
    const numeral = nodeData?.depthUnlocked >= 1 ? Locale.toRomanNumeral(nodeData.depthUnlocked + 1) : '';
    if (numeral) name += ' ' + numeral;
    // getNodeCost is only safe with a valid researching type (as the dock guards it).
    let progress = 0;
    try {
      const researching = tree?.getResearching?.();
      const cost = researching?.type != null && nodeData ? tree.getNodeCost?.(researching.type) : 0;
      if (cost > 0) progress = clamp(nodeData.progress / cost, 0, 1);
    } catch (e) { /* leave 0 */ }
    const icon = isTech ? Icon.getTechIconFromProgressionTreeNodeDefinition(nodeInfo) : Icon.getCultureIconFromProgressionTreeNodeDefinition(nodeInfo);
    return { name, turns: tree?.getTurnsLeft?.() ?? 0, icon, progress };
  } catch (e) { return null; }
}

function researchRow(type, labelLoc, research, barColor) {
  if (!research) return displayItem(type, Locale.compose(labelLoc), '', Locale.compose('LOC_ZOM_OBSERVER_NONE'), 0);
  const details = research.turns > 0 ? `${research.name} (${research.turns})` : research.name;
  return displayItem(type, research.name, meterHTML(research.icon, research.name, research.progress * 100, barColor), details, research.turns);
}

/** Current tech and civic meters (none while an Age transition processes: the trees are in flux). */
function researchItems(player) {
  const busy = isAgeTransitionInProgress();
  const tech = busy ? null : activeResearch(player.id, player.Techs?.getTreeType?.(), player.Techs, true);
  const civic = busy ? null : activeResearch(player.id, player.Culture?.getActiveTree?.(), player.Culture, false);
  return [
    researchRow('science', 'LOC_ZOM_OBSERVER_RESEARCH_TECH', tech, METER_COLORS.tech),
    researchRow('culture', 'LOC_ZOM_OBSERVER_RESEARCH_CIVIC', civic, METER_COLORS.civic)
  ];
}

// ============================ Production ============================

/** Localized name of a production item from its type hash, or null. */
function productionName(hash) {
  for (const table of [GameInfo.Units, GameInfo.Constructibles, GameInfo.Buildings, GameInfo.Projects]) {
    const def = table?.lookup?.(hash);
    if (def?.Name) return Locale.compose(def.Name);
  }
  return null;
}

/** One meter per city (towns have no production queue): icon = item, label = city. */
function productionItems(player) {
  const items = [];
  try {
    for (const city of player.Cities?.getCities?.() ?? []) {
      if (!city || city.isTown) continue;
      const cityName = Locale.compose(city.name || 'LOC_ZOM_OBSERVER_NONE');
      const queue = city.BuildQueue;
      const hash = queue?.currentProductionTypeHash;
      const producing = hash != null && hash !== -1;
      const pct = producing ? (queue.getPercentComplete?.(hash) ?? 0) : 0;
      const itemName = producing ? productionName(hash) : null;
      items.push(displayItem('production', itemName ? `${cityName} - ${itemName}` : cityName,
        meterHTML(producing ? Icon.getProductionIconFromHash(hash) : '', cityName, pct, METER_COLORS.production), itemName ?? cityName, pct));
    }
  } catch (e) { /* keep what was built */ }
  return items;
}

// ============================ Score ============================

/** Victory classes shown, in order; emblem classes show the Victories screen's own emblem. */
const VICTORY_CLASSES = [
  { type: 'VICTORY_CLASS_CULTURE', emblem: 'img-emblem-cultural' },
  { type: 'VICTORY_CLASS_ECONOMIC', emblem: 'img-emblem-economic' },
  { type: 'VICTORY_CLASS_MILITARY', emblem: 'img-emblem-military' },
  { type: 'VICTORY_CLASS_SCIENCE', emblem: 'img-emblem-scientific' },
  { type: 'VICTORY_CLASS_SCORE', label: 'LOC_ZOM_OBSERVER_SCORE' }
];

/** Icon (or name) on the left, score on the right. */
function scoreRow(victoryClass, score) {
  const icon = victoryClass.emblem
    ? `<div class='${victoryClass.emblem}' style='width:1.6rem;height:1.6rem;background-size:contain;background-repeat:no-repeat;background-position:center;'></div>`
    : '';
  const name = victoryClass.label ? Locale.compose(victoryClass.label) : '';
  const nameSpan = name
    ? `<span style='font-size:0.62rem;line-height:0.8rem;color:${TEXT_COLOR};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:3.6rem;'>${name}</span>`
    : '';
  const img = `<div style='display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;padding:0.2rem 0;'>` +
    `<div style='display:flex;flex-direction:column;align-items:center;min-width:0;'>${icon}${nameSpan}</div>` +
    `<span style='font-size:0.9rem;color:${TEXT_COLOR};margin-left:0.3rem;flex-shrink:0;'>${score}</span></div>`;
  // One row type per victory class, so each class has its own best leader.
  const type = victoryClass.type ? victoryClass.type.toLowerCase().replace('victory_class_', 'victory-') : 'victory';
  return displayItem(type, name, img, name, score);
}

/** Points per victory class from player.Victories (the active Age's definition wins). */
function scoreItems(player) {
  const points = new Map();
  try {
    for (const def of GameInfo.Victories) {
      if (!VICTORY_CLASSES.some((c) => c.type === def.VictoryClassType)) continue;
      let pts = 0;
      try { pts = player.Victories?.getPointsForVictoryType?.(def.$hash) ?? 0; } catch (e) { pts = 0; }
      points.set(def.VictoryClassType, Math.max(points.get(def.VictoryClassType) ?? 0, pts));
    }
  } catch (e) { /* keep what was read */ }
  const items = VICTORY_CLASSES.filter((c) => points.has(c.type)).map((c) => scoreRow(c, points.get(c.type)));
  recordValues(player.id, items);
  return items.length ? items : [scoreRow({ label: 'LOC_ZOM_OBSERVER_NONE' }, 0)];
}

export { bestByType, worstByType, yieldsItems, researchItems, productionItems, scoreItems };
