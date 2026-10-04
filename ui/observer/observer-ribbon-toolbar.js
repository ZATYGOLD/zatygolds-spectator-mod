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
 * Zatygold's Spectator - Observer ribbon view buttons (in-game scope).
 *
 * The Observer's own card has no stats; its stat area holds round buttons
 * (the game's mini-map lens button with its own yield glyphs) that switch
 * every other card between Yields | Production, Research and Victories. The
 * card's banner, between the portrait and the civ symbol, holds the Auto End
 * Turn toggle (observer-turn.js); the civ symbol, smaller, sits under it.
 * The buttons form one column; the Perspective toggle (observer-perspective.js)
 * comes last, under Victories.
 * Right-clicking the card's portrait hides or shows every card's details
 * (observer-navigation.js); its tooltip says so.
 */
import { ICONS, OBSERVER_VIEW } from './observer-config.js';
import { isDetailsHidden, markOwnCard } from './observer-ribbon-style.js';
import { isPerspectiveMode, PERSPECTIVE_CHANGED_EVENT, perspectivePlayer, setPerspectiveMode } from './observer-perspective.js';
import { isAutoEndTurn, setAutoEndTurn } from './observer-turn.js';

const BUTTONS_CLASS = 'zom-observer-view-buttons';
const BANNER_CLASS = 'zom-observer-banner-toggles';
const BUTTON_SIZE = '1.6rem';
const BUTTON_MARGIN = '0.2rem 0';
const TOGGLE_SIZE_REM = 1.4;
const TOGGLE_GLYPH_INSET = '0.12rem';
const SYMBOL_SIZE = '2rem';
const SYMBOL_GAP_REM = 0.25;
const DOUBLE_ACTIVATION_MS = 150;   // a click fires both action-activate and click
const COLUMN_TOP_REM = 2.8;   // clear of the portrait hex on the white banner
const BANNER_TOP = `${COLUMN_TOP_REM}rem`;
// The civ symbol sits right under the toggle, about where the base places it (mt-20, 5rem).
const SYMBOL_TOP = `${COLUMN_TOP_REM + TOGGLE_SIZE_REM + SYMBOL_GAP_REM}rem`;
const GLYPH_INSET = '0.2rem';   // same glyph area on every button (the lens button's own inset is larger)

function iconDiv(url, cssText) {
  const d = document.createElement('div');
  d.style.cssText = `position: absolute; background-image: url("${url}"); background-size: contain; background-repeat: no-repeat; background-position: center; ${cssText}`;
  return d;
}

/** Five yield glyphs on the points of a pentagram: gold, science, happiness, influence, culture. */
function yieldsGlyph(icon) {
  const size = 38;   // percent of the button
  const points = [[ICONS.gold, 50, 12], [ICONS.science, 86, 40], [ICONS.happiness, 72, 84], [ICONS.influence, 28, 84], [ICONS.culture, 14, 40]];
  for (const [url, cx, cy] of points) icon.appendChild(iconDiv(url, `width: ${size}%; height: ${size}%; left: ${cx - size / 2}%; top: ${cy - size / 2}%;`));
}

/** The tech and civic glyphs side by side. */
function researchGlyph(icon) {
  icon.appendChild(iconDiv(ICONS.tech, 'width: 58%; height: 58%; left: -4%; top: 21%;'));
  icon.appendChild(iconDiv(ICONS.civic, 'width: 58%; height: 58%; right: -4%; top: 21%;'));
}

const GLYPHS = {
  [OBSERVER_VIEW.YIELDS]: yieldsGlyph,
  [OBSERVER_VIEW.RESEARCH]: researchGlyph,
  [OBSERVER_VIEW.PRODUCTION]: (icon) => { icon.style.backgroundImage = `url("${ICONS.production}")`; },
  [OBSERVER_VIEW.SCORE]: (icon) => { icon.style.backgroundImage = `url("${ICONS.victories}")`; }
};

/** The Perspective toggle's tooltip: off, waiting for a leader, or whose view is shown. */
function perspectiveText() {
  if (!isPerspectiveMode()) return Locale.compose('LOC_ZOM_OBSERVER_PERSPECTIVE_OFF');
  const id = perspectivePlayer();
  const name = id != null ? Players.get(id)?.name : null;
  return name ? Locale.compose('LOC_ZOM_OBSERVER_PERSPECTIVE_LEADER', Locale.compose(name)) : Locale.compose('LOC_ZOM_OBSERVER_PERSPECTIVE_PICK');
}

/** Toggles: pressed while on; text() is the tooltip for the current state. */
const AUTO_END_TOGGLE = { cls: 'zom-observer-auto-end', icon: ICONS.endTurn, isOn: isAutoEndTurn, set: setAutoEndTurn,
  text: () => Locale.compose(isAutoEndTurn() ? 'LOC_ZOM_OBSERVER_AUTO_END_TURN_ON' : 'LOC_ZOM_OBSERVER_AUTO_END_TURN_OFF') };
const PERSPECTIVE_TOGGLE = { cls: 'zom-observer-perspective', icon: ICONS.perspective, isOn: isPerspectiveMode, set: setPerspectiveMode, text: perspectiveText };

/** The banner toggles, top to bottom. */
const BANNER_TOGGLES = [AUTO_END_TOGGLE];
const ALL_TOGGLES = [AUTO_END_TOGGLE, PERSPECTIVE_TOGGLE];

/** Stat-area buttons, top to bottom: views, then toggles. */
const STAT_BUTTONS = [
  { view: OBSERVER_VIEW.YIELDS, loc: 'LOC_ZOM_OBSERVER_YIELDS' },
  { view: OBSERVER_VIEW.PRODUCTION, loc: 'LOC_ZOM_OBSERVER_PRODUCTION' },
  { view: OBSERVER_VIEW.RESEARCH, loc: 'LOC_ZOM_OBSERVER_TECHS_CIVICS' },
  { view: OBSERVER_VIEW.SCORE, loc: 'LOC_PEDIA_VICTORIES_TITLE' },
  { toggle: PERSPECTIVE_TOGGLE }
];

/** A round lens-style button; drawGlyph fills its icon. */
function roundButton(tooltip, pressed, drawGlyph, onActivate) {
  const btn = document.createElement('fxs-activatable');
  btn.classList.add('mini-map__lens-button', 'pointer-events-auto');
  btn.classList.toggle('pressed', pressed);
  btn.setAttribute('data-tooltip-content', tooltip);
  btn.style.cssText = `width: ${BUTTON_SIZE}; height: ${BUTTON_SIZE}; margin: ${BUTTON_MARGIN};`;
  const bg = document.createElement('div');
  bg.classList.add('mini-map__lens-button__bg');
  const icon = document.createElement('div');
  icon.classList.add('mini-map__lens-button__icon');
  icon.style.backgroundImage = 'none';
  for (const side of ['top', 'left', 'right', 'bottom']) icon.style[side] = GLYPH_INSET;
  drawGlyph(icon);
  btn.append(bg, icon);
  let lastActivation = 0;
  const activate = () => {
    const now = Date.now();
    if (now - lastActivation < DOUBLE_ACTIVATION_MS) return;
    lastActivation = now;
    onActivate(btn);
  };
  for (const event of ['action-activate', 'click']) btn.addEventListener(event, activate);
  return btn;
}

function viewButton(item, currentView, onSelect) {
  return roundButton(Locale.compose(item.loc), item.view === currentView, GLYPHS[item.view], () => onSelect(item.view));
}

/** Pressed while on; a state can also change by itself (Auto End Turn switches off at the end of an Age). */
function showToggleState(btn, toggle) {
  btn.classList.toggle('pressed', toggle.isOn());
  btn.setAttribute('data-tooltip-content', toggle.text());
}

/** Every toggle's state under root. */
function refreshToggles(root) {
  for (const toggle of ALL_TOGGLES) {
    Array.prototype.forEach.call(root?.querySelectorAll('.' + toggle.cls) ?? [], (btn) => showToggleState(btn, toggle));
  }
}

function toggleButton(toggle) {
  const glyph = (icon) => { icon.style.backgroundImage = `url("${toggle.icon}")`; };
  const btn = roundButton('', toggle.isOn(), glyph, () => {
    toggle.set(!toggle.isOn());
    showToggleState(btn, toggle);
  });
  btn.classList.add(toggle.cls);
  showToggleState(btn, toggle);
  return btn;
}

/** A smaller toggle for the card's banner. */
function bannerToggleButton(toggle) {
  const btn = toggleButton(toggle);
  btn.style.cssText = `width: ${TOGGLE_SIZE_REM}rem; height: ${TOGGLE_SIZE_REM}rem; margin: 0;`;
  const icon = btn.querySelector('.mini-map__lens-button__icon');
  if (icon) for (const side of ['top', 'left', 'right', 'bottom']) icon.style[side] = TOGGLE_GLYPH_INSET;
  return btn;
}

/** The toggles on the card's white banner, below the portrait hex and above the civ symbol. */
function placeBannerToggles(card) {
  const banner = card?.querySelector('.diplo-ribbon__upper-bg');
  if (!banner) return;
  if (banner.querySelector('.' + BANNER_CLASS)) return;
  const box = document.createElement('div');
  box.classList.add(BANNER_CLASS, 'pointer-events-auto');
  box.style.cssText = `position: absolute; left: 0; right: 0; top: ${BANNER_TOP}; display: flex; flex-direction: column; align-items: center; z-index: 10;`;
  for (const toggle of BANNER_TOGGLES) box.appendChild(bannerToggleButton(toggle));
  banner.appendChild(box);
  const symbol = banner.querySelector('.diplo-ribbon__symbol');
  if (symbol) Object.assign(symbol.style, { marginTop: SYMBOL_TOP, width: SYMBOL_SIZE, height: SYMBOL_SIZE });
}

/** The portrait's tooltip: the Observer's name and what a right click does now. */
function setPortraitTooltip(card) {
  const hitbox = card?.querySelector('.diplo-ribbon__portrait-hitbox');
  const name = Players.get(GameContext.localPlayerID)?.name;
  if (!hitbox || !name) return;
  const action = isDetailsHidden() ? 'LOC_ZOM_OBSERVER_SHOW_DETAILS' : 'LOC_ZOM_OBSERVER_HIDE_DETAILS';
  hitbox.setAttribute('data-tooltip-content', Locale.compose('LOC_ZOM_OBSERVER_PORTRAIT_TT', Locale.compose(name), Locale.compose(action)));
}

/** Fill the Observer's own stat area with the view buttons, centre its eye portrait in the hex and add the toggle. */
function placeViewButtons(panel, currentView, onSelect) {
  const own = panel.querySelector(`.diplo-ribbon__yields[data-leader-id="${GameContext.localPlayerID}"]`);
  if (!own) return;
  if (!own.querySelector('.' + BUTTONS_CLASS)) {
    own.innerHTML = '';
    const box = document.createElement('div');
    box.classList.add(BUTTONS_CLASS, 'pointer-events-auto');
    box.style.cssText = 'display: flex; flex-direction: column; align-items: center; padding: 0.4rem 0;';
    for (const item of STAT_BUTTONS) box.appendChild(item.toggle ? toggleButton(item.toggle) : viewButton(item, currentView, onSelect));
    own.appendChild(box);
  }
  const card = own.closest?.('.diplo-ribbon-outer');
  const portrait = card?.querySelector('.diplo-ribbon__portrait-image');
  if (portrait) Object.assign(portrait.style, { top: '0', left: '0', width: '100%', height: '100%' });
  placeBannerToggles(card);
  refreshToggles(card);
  setPortraitTooltip(card);
  markOwnCard(card);
}

window.addEventListener(PERSPECTIVE_CHANGED_EVENT, () => refreshToggles(document.querySelector('panel-diplo-ribbon')));

export { placeViewButtons };
