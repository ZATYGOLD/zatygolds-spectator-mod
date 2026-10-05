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
 * The live banners are the ui-next (Solid) ones, created before any mod
 * script runs, so nothing can be patched into their components. For the
 * Observer seat only:
 *   - towns: the town's focus icon (as the settlement details show it) is
 *     placed in the banner's name row, where a city's capital star sits,
 *     named in its tooltip; refreshed on growth-mode, government and turn
 *     changes;
 *   - city-states: the type icon's tooltip adds the suzerain's chosen bonus
 *     and its effect. Tooltip content is created on hover through the
 *     registered Stylize component, so overriding it reaches every banner;
 *     the hovered type icon says which city-state it is for.
 * Visibility in a Perspective is handled by observer-perspective.js.
 */
import { mergeProps } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { createLogger, deferOnce, findAncestor, overrideComponent } from '../shared/zom-util.js';
import { isObserverSeat } from './observer-core.js';
import { bannerOf, bannerSubject, cityStateBonus, cityStateType, forEachBanner, townFocus } from './observer-settlement-info.js';

const log = createLogger('observer-banners');
const ICON_CLASS = 'zom-settlement-icon';
const ICON_SHADOW = 'drop-shadow(0.0277777778rem 0.0555555556rem 0.0555555556rem #000000)';
const TYPE_ICON_CLASS = 'city-banner__city-state-container';
const REFRESH_EVENTS = ['CityInitialized', 'CityGovernmentLevelChanged', 'CityGrowthModeChanged', 'CityNameChanged', 'PlayerTurnActivated'];

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
    icon.classList.value = `${ICON_CLASS} size-6 self-center bg-cover bg-no-repeat pointer-events-auto`;
    icon.style.filter = ICON_SHADOW;
    row.insertBefore(icon, row.firstChild);
  }
  icon.style.backgroundImage = `url('${focus.icon}')`;
  icon.setAttribute('data-tooltip-content', Locale.compose(focus.name));
  return true;
}

const refreshAll = deferOnce(() => {
  if (!isObserverSeat()) return;
  try {
    let banners = 0;
    let icons = 0;
    forEachBanner((banner, subject) => {
      banners++;
      if (refreshFocusIcon(banner, subject)) icons++;
    });
    once('pass', `banner pass: ${banners} banners, ${icons} town focus icons`);
  } catch (e) { log(`banner refresh failed: ${e}`); }
});

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
  if (!hoveredTypeIcon || !isObserverSeat()) return base(props);
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
  document.addEventListener('mouseover', (ev) => {
    hoveredTypeIcon = findAncestor(ev.target, (el) => el.classList?.contains(TYPE_ICON_CLASS));
  }, true);
  engine.whenReady.then(() => {
    for (const event of REFRESH_EVENTS) engine.on(event, refreshAll);
    refreshAll();
  });
  log('ui-next banner patches installed');
}

try { install(); } catch (e) { log(`install failed: ${e}`); }
