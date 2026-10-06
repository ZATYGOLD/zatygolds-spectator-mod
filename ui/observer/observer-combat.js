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
 * Zatygold's Spectator - Observer combat preview (in-game scope).
 *
 * With another player's unit selected, hovering a target fills the game's
 * combat window from an estimate: the engine's simulation only answers for
 * the local player's own units (tested in game). The estimate uses what the
 * engine and data expose - base strengths, the health penalty, each unit's
 * flat strength and friendly-territory bonuses, and the defender's terrain
 * (feature defense, rough terrain) - listed in the window's breakdown with
 * the game's own wording, under an "Estimate" note.
 */
import 'fs://game/base-standard/ui/unit-combat-preview/panel-unit-combat-preview.js';   // defines PREVIEW_TAG
import { PlotCursor } from 'fs://game/core/ui/input/plot-cursor.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { Icon } from 'fs://game/core/ui/utilities/utilities-image.js';
import { createLogger, leaderTypeOf, wrapMethod } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { meleeStrength, rangedStrength } from './observer-core.js';
import { inspectableUnits, isForeign } from './observer-units.js';

const log = createLogger('observer-combat');
const PREVIEW_TAG = 'panel-unit-combat-preview';
const ESTIMATE_CLASS = 'zom-combat-estimate';
const DAMAGE_BASE = 30;      // the game's damage formula: 30 * e^(strength difference / 25)
const DAMAGE_SCALE = 25;
const HP_PER_STRENGTH = 10;  // -1 strength per 10 health lost
const ROUGH_DEFENSE = 3;     // Civilopedia: rough terrain gives defenders +3

let estimateCount = 0;       // tokens for estimated results

// ============================ Estimate ============================

const isRangedAttacker = (unit) => rangedStrength(unit) > meleeStrength(unit);
const signed = (value) => (value > 0 ? `+${value}` : `${value}`);

/** A unit's known strength modifiers: { total, health, terrain, other } (the breakdown's text lines). */
function knownModifiers(unit, strengthType, defending) {
  const mods = unit.Combat?.combatModifiers ?? {};
  const result = { total: 0, health: [], terrain: [], other: [] };
  const add = (list, value, text) => {
    if (!value) return;
    result.total += value;
    list.push(text);
  };
  const health = unit.Health;
  if (health && !mods.isNoReductionForDamage) {
    const penalty = -Math.floor(health.damage / HP_PER_STRENGTH);
    add(result.health, penalty, Locale.compose('LOC_COMBAT_PREVIEW_DAMAGED_UNIT_DESC', penalty));
  }
  const flat = strengthType === CombatStrengthTypes.STRENGTH_RANGED ? mods.rangedStrengthModifier : mods.combatStrengthModifier;
  add(result.other, flat ?? 0, Locale.compose('LOC_ZOM_OBSERVER_COMBAT_UNIT_BONUS', signed(flat)));
  const loc = unit.location;
  if (!loc) return result;
  const territory = mods.friendlyTerritoryCombatMod ?? 0;
  if (territory && GameplayMap.getOwner(loc.x, loc.y) === unit.owner) {
    add(result.other, territory, Locale.compose('LOC_COMBAT_PREVIEW_FRIENDLY_TERRITORY_BONUS', territory));
  }
  if (defending) {
    const feature = GameInfo.Features.lookup(GameplayMap.getFeatureType(loc.x, loc.y));
    const featureDefense = feature?.DefenseModifier ?? 0;
    add(result.terrain, featureDefense, Locale.compose(featureDefense > 0 ? 'LOC_COMBAT_PREVIEW_FEATURE_DEFENSE_BONUS' : 'LOC_COMBAT_PREVIEW_FEATURE_DEFENSE_PENALTY', featureDefense, feature?.Name ?? ''));
    if (GameInfo.Terrains.lookup(GameplayMap.getTerrainType(loc.x, loc.y))?.Hills && !mods.ignoreRough) {
      add(result.terrain, ROUGH_DEFENSE, Locale.compose('LOC_COMBAT_PREVIEW_ROUGH_TERRAIN_BONUS', ROUGH_DEFENSE));
    }
  }
  return result;
}

/** One side of the fight in the shape of a simulation result. */
function estimatedSide(unit, strength, strengthType, defending) {
  const known = knownModifiers(unit, strengthType, defending);
  return {
    ID: unit.id, CombatStrength: strength, StrengthModifier: known.total, CombatStrengthType: strengthType,
    MaxHitPoints: unit.Health?.maxDamage ?? 100, DamageTo: 0,
    PreviewTextHealth: known.health, PreviewTextTerrain: known.terrain, PreviewTextModifier: known.other
  };
}

/** An estimated simulation result for this attack, else null (districts are not estimated). */
function estimateCombat(attackerId, defenderId, location, token) {
  const attacker = Units.get(attackerId);
  const defender = Units.get(defenderId);
  if (!attacker || !defender) return null;
  const ranged = isRangedAttacker(attacker);
  const attackType = ranged ? CombatStrengthTypes.STRENGTH_RANGED : CombatStrengthTypes.STRENGTH_MELEE;
  const a = estimatedSide(attacker, ranged ? rangedStrength(attacker) : meleeStrength(attacker), attackType, false);
  const d = estimatedSide(defender, meleeStrength(defender), CombatStrengthTypes.STRENGTH_MELEE, true);
  const diff = (a.CombatStrength + a.StrengthModifier) - (d.CombatStrength + d.StrengthModifier);
  d.DamageTo = Math.round(DAMAGE_BASE * Math.exp(diff / DAMAGE_SCALE));
  a.DamageTo = ranged ? 0 : Math.round(DAMAGE_BASE * Math.exp(-diff / DAMAGE_SCALE));
  return { QueryToken: token, Location: location, CombatType: ranged ? CombatTypes.COMBAT_RANGED : CombatTypes.COMBAT_MELEE, Attacker: a, Defender: d };
}

// ============================ Window ============================

/** First unit on the hovered tile owned by neither the attacker's owner nor an Observer. */
function hoveredOpponent(attacker) {
  const plot = PlotCursor.plotCursorCoords;
  return (plot && inspectableUnits(plot.x, plot.y).find((id) => id.owner !== attacker.owner)) || ComponentID.getInvalidID();
}

/**
 * The window's portrait for a unit's owner. The base window only sets it for
 * leaders, so independents and city-states kept the previous portrait; they
 * show their civilization symbol instead, as the plot tooltip does.
 */
function setOwnerIcon(icon, unitId) {
  const unit = Units.get(unitId);
  const owner = unit ? Players.get(unit.owner) : null;
  if (!icon || !owner) return;
  if (owner.isMajor) {
    icon.style.backgroundImage = '';
    icon.setAttribute('data-icon-id', leaderTypeOf(owner.leaderType));
    return;
  }
  let civOwner = owner;
  try {
    const independentId = Game.IndependentPowers.getIndependentPlayerIDFromUnit(unit.id);
    if (independentId != PlayerIds.NO_PLAYER) civOwner = Players.get(independentId) ?? owner;
  } catch (e) { /* the unit's owner */ }
  icon.removeAttribute('data-icon-id');
  icon.style.backgroundImage = Icon.getCivSymbolCSSFromCivilizationType(civOwner.civilizationType) || '';
  icon.style.backgroundSize = 'contain';
}

/** "Estimate" note centred above the outcome box. */
function setEstimateNote(root, visible) {
  const outcome = root?.querySelector('.preview-outcome');
  if (!outcome) return;
  let note = outcome.querySelector('.' + ESTIMATE_CLASS);
  if (!note) {
    note = document.createElement('div');
    note.classList.add(ESTIMATE_CLASS, 'font-body', 'text-sm', 'text-accent-1');
    note.style.cssText = 'position: absolute; bottom: 100%; left: -2.5rem; right: -2.5rem; margin-bottom: 0.3rem; padding: 0.15rem 0.5rem; text-align: center; ' +
      'border-radius: 0.3rem; background-color: rgba(10, 10, 12, 0.85); border: 0.0555555556rem solid rgba(140, 126, 98, 0.9);';
    note.setAttribute('data-l10n-id', 'LOC_ZOM_OBSERVER_COMBAT_ESTIMATE');
    outcome.appendChild(note);
  }
  note.style.display = visible ? 'block' : 'none';
}

function patchPreview(proto) {
  wrapMethod(proto, 'getTargetAtCursor', function (base, ...args) {
    const target = base(...args);
    const attacker = isForeign(this.selectedUnitID) ? Units.get(this.selectedUnitID) : null;
    return !attacker || ComponentID.isValid(target) || this.isTargetDistrict ? target : hoveredOpponent(attacker);
  });

  // The engine does not simulate other players' attacks: the window gets the estimate directly.
  wrapMethod(proto, 'realizeCombatPreview', function (base, ...args) {
    if (!isForeign(this.selectedUnitID) || !this.location) return base(...args);
    this.queryCombatID = { owner: PlayerIds.NO_PLAYER, id: ++estimateCount, type: 0 };
    this.onSimulateCombatResult(estimateCombat(this.selectedUnitID, this.targetID, this.location, this.queryCombatID) ?? { QueryToken: this.queryCombatID });
  });

  wrapMethod(proto, 'onSimulateCombatResult', function (base, results, ...rest) {
    const ours = isForeign(this.selectedUnitID) && ComponentID.isMatch(results?.QueryToken, this.queryCombatID);
    const result = base(results, ...rest);
    if (ours) {
      this.Root.style.transform = CONFIG.combatPreviewLift;
      setEstimateNote(this.Root, results?.Attacker != void 0);
      setOwnerIcon(this.attackerLeaderIcon, this.selectedUnitID);
      setOwnerIcon(this.targetLeaderIcon, this.targetID);
    }
    return result;
  });
}

const proto = Controls.getDefinition(PREVIEW_TAG)?.createInstance?.prototype;
if (proto) patchPreview(proto);
else log('combat preview not found');
