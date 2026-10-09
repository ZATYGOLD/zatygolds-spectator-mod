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
 * Zatygold's Spectator - Observer diplomacy (in-game scope).
 *
 * The Observer has met everyone; the leader panel lists all of a leader's wars
 * and offers no actions; the independent / city-state panel shows its type,
 * suzerain and bonus, then every leader's standing and befriending progress.
 */
import DiplomacyManager from 'fs://game/base-standard/ui/diplomacy/diplomacy-manager.js';
import LeaderModelManager from 'fs://game/base-standard/ui/diplomacy/leader-model-manager.js';
import { DiplomacyActionPanel } from 'fs://game/base-standard/ui/diplomacy-actions/panel-diplomacy-actions.js';
import 'fs://game/base-standard/ui/diplomacy-actions/panel-other-diplomacy.js';   // defines PANEL_TAG
import { installAssetAliases } from '../shared/zom-assets.js';
import { clamp, clearChildren, createLogger, isObserverPlayer, wrapMethod } from '../shared/zom-util.js';
import { PANEL_COLORS, RELATIONSHIP_COLORS } from './observer-config.js';
import { isObserverSeat, leaderPortrait, watchedPlayers } from './observer-core.js';
import { cityStateBonus, cityStateType, suzerainOf } from './observer-settlement-info.js';

const log = createLogger('observer-diplomacy');
const PANEL_TAG = 'panel-other-player-diplomacy-actions';
const OMIT_CLASS = 'zom-observer-omit';
const OWN_RELATIONSHIP = '#panel-diplomacy-actions__relationship-event-container';
const OTHER_RELATIONSHIPS = '#panel-diplomacy-actions__other-relationships-container';
const RELATIONSHIP_TEXT = {
  FRIENDLY: { loc: 'LOC_INDEPENDENT_RELATIONSHIP_FRIENDLY', color: RELATIONSHIP_COLORS.friendly },
  NEUTRAL: { loc: 'LOC_INDEPENDENT_RELATIONSHIP_NEUTRAL', color: RELATIONSHIP_COLORS.neutral },
  HOSTILE: { loc: 'LOC_INDEPENDENT_RELATIONSHIP_HOSTILE', color: RELATIONSHIP_COLORS.hostile }
};
const AT_WAR_COLOR = RELATIONSHIP_TEXT.HOSTILE.color;

let metInstalled = false;

/** The Observer's own diplomacy object answers hasMet with true (requires the engine to reuse that object). */
function installMetEveryone() {
  if (metInstalled || !isObserverSeat()) return;
  const own = Players.get(GameContext.localPlayerID)?.Diplomacy;
  if (!own) return;   // tried again next turn
  metInstalled = true;
  if (Players.get(GameContext.localPlayerID)?.Diplomacy !== own) { log('diplomacy object is not stable; met-everyone skipped'); return; }
  wrapMethod(Object.getPrototypeOf(own), 'hasMet', function (base, playerId, ...rest) {
    return (this === own && playerId !== GameContext.localPlayerID) || base(playerId, ...rest);
  });
}

/** Every war the given player is part of (one entry per war). */
function warsOf(playerId) {
  const seen = new Set();
  try {
    return Game.Diplomacy.getPlayerEvents(playerId).filter((action) => {
      if (action.actionType != DiplomacyActionTypes.DIPLOMACY_ACTION_DECLARE_WAR || seen.has(action.uniqueID)) return false;
      seen.add(action.uniqueID);
      return true;
    });
  } catch (e) { return []; }
}

function header(title) {
  const el = document.createElement('fxs-header');
  el.classList.add('relative');
  el.setAttribute('title', title);
  el.setAttribute('filigree-style', 'h3');
  return el;
}

function note(loc) {
  const p = document.createElement('p');
  p.classList.value = 'font-body-base text-accent-2 text-center mt-2';
  p.setAttribute('data-l10n-id', loc);
  return p;
}

// ============================ Independents and city-states ============================

/** Each leader's befriending project with an independent: leader id -> { progress, total, perTurn }. */
function befriendingProjects(power) {
  const projects = new Map();
  if (!power.isIndependent) return projects;
  try {
    for (const action of Game.Diplomacy.getPlayerEvents(power.id)) {
      if (action.actionType != DiplomacyActionTypes.DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN || projects.has(action.initialPlayer)) continue;
      const data = Game.Diplomacy.getDiplomaticEventData(action.uniqueID);
      if (data?.completionScore > 0) projects.set(action.initialPlayer, { progress: data.progressScore, total: data.completionScore, perTurn: data.support });
    }
  } catch (e) { /* no events */ }
  return projects;
}

/** The leader's standing (a RELATIONSHIP_TEXT key), as the map banner reads it: through the suzerain for a city-state. */
function standing(power, leaderId) {
  const suzerain = suzerainOf(power);
  if (suzerain === leaderId) return 'FRIENDLY';
  try {
    const rel = Game.IndependentPowers.getIndependentRelationship(suzerain ?? power.id, leaderId);
    return Object.keys(RELATIONSHIP_TEXT).find((key) => IndependentRelationship[key] === rel) ?? null;
  } catch (e) { return null; }
}

function isAtWar(leader, powerId) {
  try { return !!leader.Diplomacy?.isAtWarWith(powerId); } catch (e) { return false; }
}

/** A text element: loc is a text key (stylized by the game), color optional. */
function textLine(loc, classes, color) {
  const el = document.createElement('div');
  el.classList.value = classes;
  if (color) el.style.color = color;
  el.setAttribute('data-l10n-id', loc);
  return el;
}

/**
 * A plain bar in the game's colours (dark track, bronze border, deep bronze
 * fill), of ordinary divs: the game's fxs-progress-bar draws beyond its box.
 */
function progressBar(fraction) {
  const track = document.createElement('div');
  track.classList.value = 'self-stretch mt-1';
  track.style.cssText = `height: 0.4444444444rem; background-color: ${PANEL_COLORS.track}; border: 0.0555555556rem solid ${PANEL_COLORS.border};`;
  const fill = document.createElement('div');
  fill.style.cssText = `height: 100%; background-color: ${RELATIONSHIP_COLORS.befriend}; width: ${Math.round(clamp(fraction, 0, 1) * 100)}%;`;
  track.appendChild(fill);
  return track;
}

/** What the power is: its type icon and name, independent or city-state, and a city-state's suzerain and chosen bonus. */
function identitySection(power) {
  const section = document.createElement('div');
  section.classList.value = 'flex flex-col items-center self-stretch mt-2 mb-4';
  const type = cityStateType(power);
  const title = document.createElement('div');
  title.classList.value = 'flex flex-row items-center justify-center mb-3';
  if (type) {
    const icon = document.createElement('div');
    icon.classList.value = 'size-10 mr-2 bg-contain bg-center bg-no-repeat';
    icon.style.backgroundImage = `url('${type.icon}')`;
    icon.style.setProperty('fxs-background-image-tint', type.color);
    title.appendChild(icon);
  }
  const names = document.createElement('div');
  names.classList.value = 'flex flex-col';
  if (type) names.appendChild(textLine(type.name, 'font-title-base text-accent-2 uppercase'));
  names.appendChild(textLine(power.isMinor ? 'LOC_CIVILIZATION_CITY_STATE_NAME' : 'LOC_PLOT_TOOLTIP_INDEPENDENT_CONQUEROR', 'font-body-sm text-accent-3'));
  title.appendChild(names);
  section.appendChild(title);
  if (!power.isMinor) return section;
  const suzerainId = suzerainOf(power);
  const suzerain = suzerainId != null ? Players.get(suzerainId) : null;
  const line = document.createElement('p');
  line.classList.value = 'font-body-sm text-accent-2 text-center mb-2';
  line.innerHTML = suzerain ? Locale.stylize('LOC_DIPLOMACY_SUZERAIN_OTHER', Locale.compose(suzerain.name)) : Locale.compose('LOC_DIPLOMACY_NO_SUZERAIN');
  section.appendChild(line);
  const bonus = cityStateBonus(power.id);
  if (bonus) {
    section.appendChild(header('LOC_ZOM_OBSERVER_SUZERAIN_BONUS'));
    section.appendChild(textLine(bonus.name, 'font-title-sm text-secondary uppercase text-center mt-2'));
    const description = textLine(bonus.description, 'font-body-sm text-accent-2 text-center mt-1 mb-1');
    description.style.cssText = 'max-width: 21rem; line-height: 1.3;';
    section.appendChild(description);
  }
  return section;
}

/** One leader's row: portrait and name, standing on the right, befriending progress under them. */
function relationshipRow(power, leader, isSuzerain, project) {
  const row = document.createElement('div');
  row.classList.value = 'flex flex-row items-center self-stretch mt-3 px-3';
  row.appendChild(leaderPortrait(leader, 'size-10 mr-2'));
  const body = document.createElement('div');
  body.classList.value = 'flex flex-col flex-auto';
  const line = document.createElement('div');
  line.classList.value = 'flex flex-row items-center justify-between';
  const name = document.createElement('div');
  name.classList.value = `font-title-sm ${isSuzerain ? 'text-secondary' : 'text-accent-2'}`;
  name.textContent = Locale.compose(leader.name);
  line.appendChild(name);
  const statuses = document.createElement('div');
  statuses.classList.value = 'flex flex-row items-center';
  const key = standing(power, leader.id);
  if (key) statuses.appendChild(textLine(RELATIONSHIP_TEXT[key].loc, 'font-body-sm ml-2', RELATIONSHIP_TEXT[key].color));
  // An independent is hostile exactly while at war; a city-state's war is shown on its own.
  if (power.isMinor && isAtWar(leader, power.id)) statuses.appendChild(textLine('LOC_PLAYER_RELATIONSHIP_AT_WAR', 'font-body-sm ml-2', AT_WAR_COLOR));
  line.appendChild(statuses);
  body.appendChild(line);
  if (project) {
    const progress = document.createElement('div');
    progress.classList.value = 'font-body-xs text-accent-3';
    progress.textContent = Locale.compose('LOC_DIPLOMACY_BEFRIEND_INDEPENDENT_PROGRESS', project.progress, project.total, project.perTurn);
    body.append(progress, progressBar(project.progress / project.total));
  }
  row.appendChild(body);
  return row;
}

/** Suzerain first, then the furthest along in befriending, then the rest. */
function rowOrder(suzerain, projects) {
  const progress = (leader) => {
    const project = projects.get(leader.id);
    return project ? project.progress / project.total : -1;
  };
  return (a, b) => (b.id === suzerain) - (a.id === suzerain) || progress(b) - progress(a);
}

/** Every leader's standing with an independent or city-state. */
function relationshipSection(power) {
  const section = document.createElement('div');
  section.classList.value = 'flex flex-col items-center self-stretch mb-4';
  section.appendChild(header('LOC_DIPLOMACY_ACTIONS_RELATIONSHIPS_HEADER'));
  const suzerain = suzerainOf(power);
  const projects = befriendingProjects(power);
  for (const leader of watchedPlayers().sort(rowOrder(suzerain, projects))) {
    section.appendChild(relationshipRow(power, leader, leader.id === suzerain, projects.get(leader.id)));
  }
  return section;
}

// ============================ Leader panel ============================

/** Drop Observer portraits (and rows left empty) and the leader's relationship with the Observer. */
function removeObserverRelationships(root) {
  root.querySelector(OWN_RELATIONSHIP)?.style.setProperty('display', 'none');
  for (const icon of root.querySelectorAll('.' + OMIT_CLASS)) icon.remove();
  const rows = root.querySelector(OTHER_RELATIONSHIPS);
  for (const row of [...(rows?.children ?? [])]) {
    if (!row.querySelector('#relationship-icon-row')?.children.length) row.remove();
  }
}

function patchPanel(proto) {
  wrapMethod(proto, 'createBorderedIcon', (base, iconURL, leaderID, ...rest) => {
    const icon = base(iconURL, leaderID, ...rest);
    if (isObserverSeat() && leaderID != null && isObserverPlayer(leaderID)) icon.classList.add(OMIT_CLASS);
    return icon;
  });

  wrapMethod(proto, 'populateRelationshipInfo', function (base, ...args) {
    const result = base(...args);
    if (isObserverSeat()) removeObserverRelationships(this.Root);
    return result;
  });

  wrapMethod(proto, 'populateAvailableActions', function (base, ...args) {
    if (!isObserverSeat()) return base(...args);
    clearChildren(this.majorActionsSlot);
  });

  wrapMethod(proto, 'populateActionsPanel', function (base, ...args) {
    if (!isObserverSeat()) return base(...args);
    const slot = this.Root.querySelector('#available-projects-slot');
    if (!slot) return;
    clearChildren(slot);
    this.firstFocusSection = null;
    const selected = Players.get(DiplomacyManager.selectedPlayerID);
    if (selected?.isIndependent || selected?.isMinor) {
      slot.append(identitySection(selected), relationshipSection(selected));
      return;
    }
    const wars = warsOf(DiplomacyManager.selectedPlayerID);
    slot.appendChild(header('LOC_DIPLOMACY_WAR_HEADER'));
    if (wars.length === 0) { slot.appendChild(note('LOC_ZOM_OBSERVER_NO_WARS')); return; }
    for (const war of wars) {
      const item = this.createWarInfoElement(war);
      item.addEventListener('action-activate', () => this.clickOngoingAction(war.uniqueID));
      slot.appendChild(item);
    }
  });
}

installAssetAliases(LeaderModelManager.leaderModelGroupLeft, LeaderModelManager.leaderModelGroupRight);

const proto = Controls.getDefinition(PANEL_TAG)?.createInstance?.prototype;
if (proto) patchPanel(proto);
else log('leader panel not found');
// Both leader panels (the local player's too) open the base befriending box, which is built around the local player.
wrapMethod(DiplomacyActionPanel.prototype, 'showBefriendIndependentDetails', (base, ...args) => (isObserverSeat() ? undefined : base(...args)));

engine.whenReady.then(() => {
  installMetEveryone();
  engine.on('LocalPlayerTurnBegin', installMetEveryone);
});
