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
 * Zatygold's Spectator - Observer configuration & constants (in-game scope).
 */
import { ART } from '../shared/zom-assets.js';

/** What every leader card on the Observer's ribbon shows. */
const OBSERVER_VIEW = {
  YIELDS: 'yields',
  RESEARCH: 'research',
  PRODUCTION: 'production',
  SCORE: 'score'
};

/** Tunable settings. */
const CONFIG = {
  enabled: true,                        // master switch for the Observer's in-game features
  debug: false,                         // extra UI.log diagnostics (e.g. the Eye's vision each turn)
  defaultView: OBSERVER_VIEW.YIELDS,
  autoEndTurn: false,                   // initial state of the auto end turn toggle
  autoEndTurnDelayMs: 1000,             // wait after the turn starts (prompts are answered first)
  autoEndTurnRetryMs: 1000,             // retry while something still blocks the turn
  historyRecordDelayMs: 500,            // wait after a turn starts before recording yields (graphs)
  ribbonSeedAttempts: 30,               // tries to populate the ribbon once the HUD exists
  ribbonSeedIntervalMs: 500,
  combatPreviewLift: 'translateY(-4.5rem)',  // keeps the combat preview above the unit panel
  zoomIn: 0.3,                          // closest zoom: 30% less of the map than the game's closest
  zoomOut: 0.55,                        // furthest zoom: 55% more of the map than the game's furthest
  zoomStepScale: 0.5,                   // zoom step per input vs. the game's (smaller = smoother)
  notificationScale: 0.75,              // notification bar size
  perspectiveUnexplored: { saturation: 0, brightness: 0 },        // Perspective: tiles the viewed leader never explored (colour filter)
  perspectiveUnexploredFill: { x: 0, y: 0, z: 0, w: 1 },          // Perspective: ground of tiles they never explored (plot overlay, linear RGBA)
  perspectiveSeenFill: { x: 0.05, y: 0.05, z: 0.06, w: 0.85 },    // Perspective: grey on tiles seen before but not seen now (plot overlay)
  perspectiveMinimapUnexplored: '#000000',                         // Perspective: minimap tiles they never explored
  perspectiveMinimapSeen: 'rgba(13, 13, 15, 0.7)',                // Perspective: minimap tiles seen before but not seen now
  perspectiveRefreshMs: 250             // Perspective: redraw delay after units move (batches an AI turn's moves)
};

/**
 * Card highlight colours: the glow of a leader at war and of a celebration,
 * one hex-border colour per alliance, and one pip colour per war pair.
 */
const HIGHLIGHT = {
  glowSize: '0.7rem',                   // glow around the portrait hex
  borderGlowSize: '0.3rem',             // tight glow on the hex border
  atWar: '#ff2a2a',
  best: 'rgba(229, 210, 172, 0.25)',    // highest value in a row
  negative: '#ff6644',                  // negative totals (bright red on the slate background)
  celebration: '#ffc21a',
  pantheon: '#d9a441',                  // pantheon badge tint, apart from the white religion icons
  pantheonHover: '#f2c977',
  pinGlow: 'rgba(255, 200, 50, 0.85)',  // Chronicle pins of commanders, commendations and specialists
  alliances: ['#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0'],
  wars: ['#e04848', '#4aa3ff', '#5cd65c', '#b36bff', '#ff8c1a', '#3de0d0', '#ff5fb0', '#f0f0f0']
};

/** Chrome of the Observer's own panels and overlays. */
const PANEL_COLORS = {
  parchment: '#e5d2ac',                         // selected borders, neutral text
  parchmentFaint: 'rgba(229, 210, 172, 0.55)',
  ribbonText: '#e7d9ac',
  border: 'rgba(140, 126, 98, 0.6)',            // bronze row and track borders
  borderStrong: 'rgba(140, 126, 98, 0.9)',
  plate: 'rgba(10, 10, 12, 0.85)',              // dark plates behind floating text
  bar: 'rgba(10, 12, 18, 0.88)',
  track: 'rgba(0, 0, 0, 0.6)',
  meterTrack: 'rgba(255, 255, 255, 0.22)',
  oddRow: 'rgba(76, 71, 61, 0.6)',
  shadow: '#000000'
};

/** An independent's standing with a leader, and befriending progress. */
const RELATIONSHIP_COLORS = { friendly: '#7ccf6e', neutral: PANEL_COLORS.parchment, hostile: '#e0604e', befriend: '#e0b96c' };

/** Value colour of each Yields row, bright against the slate background. */
const ROW_COLORS = {
  gold: '#f6ce55',
  science: '#79b3ee',
  culture: '#8d92f9',
  happiness: '#f5993d',
  diplomacy: '#afb7cf',
  trade: '#afb7cf',
  settlements: '#e5d2ac',
  food: '#80b34d',
  production: '#e87b64',
  citizens: '#f9ecd2',
  military: '#ff8080',
  techs: '#6ec8e0',
  civics: '#c89ff0',
  wonders: '#f0c040'
};

/** Progress bar colour of each Research / Production meter. */
const METER_COLORS = {
  tech: ROW_COLORS.techs,
  civic: ROW_COLORS.civics,
  production: '#7fc77f'
};

/** Game icons shared by the ribbon's rows and buttons. */
const ICONS = {
  gold: 'blp:fi_Yield_Gold_64',
  science: 'blp:fi_Yield_Science_64',
  culture: 'blp:fi_Yield_Culture_64',
  happiness: 'blp:fi_Yield_Happiness_64',
  influence: 'blp:fi_yield_diplomacy_64',
  production: 'blp:fi_Yield_Production_64',
  military: 'blp:fi_nar_rew_combat_64',
  tech: 'blp:fi_radial_tech_64',
  civic: 'blp:fi_radial_civics_64',
  wonders: 'blp:ntf_wonder_completed',
  victories: 'blp:radial_victories',
  endTurn: 'blp:fi_next_turn_64',
  perspective: ART.observerIcon
};

export { CONFIG, HIGHLIGHT, ICONS, METER_COLORS, OBSERVER_VIEW, PANEL_COLORS, RELATIONSHIP_COLORS, ROW_COLORS };
