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
 * Zatygold's Spectator - Observer settlement banners (in-game scope).
 *
 * The live banners are ui-next components created before mod scripts run, so
 * they are extended from outside: a town's focus icon in the name row (DOM),
 * and the suzerain bonus in a city-state type icon's tooltip (through the
 * registered Stylize component, which tooltip content creates on hover).
 */
import { mergeProps } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ancestorWithClass, createLogger, deferOnce, overrideComponent } from '../shared/zom-util.js';
import { onObserverReady } from './observer-core.js';
import { bannerOf, bannerSubject, cityStateBonus, cityStateType, forEachBanner, townFocus } from './observer-settlement-info.js';

const log = createLogger('observer-banners');
const ICON_CLASS = 'zom-settlement-icon';
const ICON_SHADOW = 'drop-shadow(0.0277777778rem 0.0555555556rem 0.0555555556rem #000000)';
const TYPE_ICON_CLASS = 'city-banner__city-state-container';
// The game's own town-star classes: its size and margins in the name row.
const ICON_CLASSES = `${ICON_CLASS} city-banner__original-capital-star city-banner__town-original-capital-star w-6 h-6 bg-cover bg-no-repeat pointer-events-auto`;
const REFRESH_EVENTS = ['CityInitialized', 'CityGovernmentLevelChanged', 'CityGrowthModeChanged', 'CityNameChanged', 'PlayerTurnActivated'];
const FIRST_PASS_RETRY_MS = 500;
const FIRST_PASS_TRIES = 20;   // the banners mount shortly after the game is ready

const seen = new Set();          // breadcrumbs already logged this game load
let hoveredTypeIcon = null;      // the city-state type icon under the mouse

/** Log a breadcrumb once per game load. */
function once(key, message) {
  if (seen.has(key)) return;
  seen.add(key);
  log(message);
}

// ============================ Town focus ============================

/** A major's town banner shows its focus at the start of the name row; any other banner drops it. */
function refreshFocusIcon(banner, subject) {
  const owner = subject?.city ? Players.get(subject.owner) : null;
  const focus = owner?.isMajor ? townFocus(subject.city) : null;
  let icon = banner.querySelector('.' + ICON_CLASS);
  if (!focus) { icon?.remove(); return false; }
  if (!icon) {
    const row = banner.querySelector('.city-banner__name')?.parentElement;
    if (!row) return false;
    icon = document.createElement('div');
    icon.classList.value = ICON_CLASSES;
    icon.style.filter = ICON_SHADOW;
    row.insertBefore(icon, row.firstChild);
  }
  icon.style.backgroundImage = `url('${focus.icon}')`;
  icon.setAttribute('data-tooltip-content', Locale.compose(focus.name));
  return true;
}

/** Refresh every banner's icon; returns the banner count. */
function refreshIcons() {
  try {
    let icons = 0;
    const banners = forEachBanner((banner, subject) => { if (refreshFocusIcon(banner, subject)) icons++; });
    if (banners) once('pass', `banner pass: ${banners} banners, ${icons} town focus icons`);
    return banners;
  } catch (e) {
    log(`banner refresh failed: ${e}`);
    return 0;
  }
}

const refreshAll = deferOnce(refreshIcons);

function firstPass(tries = FIRST_PASS_TRIES) {
  if (!refreshIcons() && tries > 1) setTimeout(() => firstPass(tries - 1), FIRST_PASS_RETRY_MS);
}

// ============================ Suzerain bonus ============================

/** The type icon's tooltip text with the chosen bonus, for the hovered city-state; null to keep the base text. */
function bonusText(text) {
  const subject = bannerSubject(bannerOf(hoveredTypeIcon));
  const owner = Players.get(subject?.owner ?? -1);
  const type = cityStateType(owner);
  const bonus = owner ? cityStateBonus(owner.id) : null;
  if (!type || !bonus || text !== type.name) return null;
  return `${Locale.compose(type.name)}[N][B]${Locale.compose(bonus.name)}[/B][N]${Locale.compose(bonus.description)}`;
}

const withBonus = (base) => (props) => {
  if (!hoveredTypeIcon) return base(props);
  try {
    const text = bonusText(props.text);
    if (text) {
      once('bonus', 'suzerain bonus tooltip shown');
      return base(mergeProps(props, { text, args: [] }));
    }
  } catch (e) { log(`bonus tooltip failed: ${e}`); }
  return base(props);
};

// ============================ Installation ============================

function install() {
  if (!overrideComponent('Stylize', withBonus)) log('Stylize is not registered');
  onObserverReady(() => {
    document.addEventListener('mouseover', (ev) => {
      hoveredTypeIcon = ancestorWithClass(ev.target, TYPE_ICON_CLASS);
    }, true);
    for (const event of REFRESH_EVENTS) engine.on(event, refreshAll);
    firstPass();
  });
  log('ui-next banner patches installed');
}

try { install(); } catch (e) { log(`install failed: ${e}`); }
