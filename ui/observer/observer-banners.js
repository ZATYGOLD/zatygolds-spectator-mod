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
 * The ui-next CityBanner reads its data through this override, which changes
 * it for the Observer seat only:
 *   - visibility: on tiles the Observer, or the Perspective's leader, has
 *     explored (observer-perspective.js);
 *   - towns: the town's focus icon where a city shows its leader, its name in
 *     that portrait's tooltip;
 *   - independents and city-states: the type icon's tooltip adds the
 *     suzerain's chosen bonus and its effect.
 */
import { mergeProps } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';
import 'fs://game/base-standard/ui-next/screens/city-banners/city-banner.js';
import { createLogger, setStyle } from '../shared/zom-util.js';
import { isObserverSeat } from './observer-core.js';
import { bannerVisible } from './observer-perspective.js';
import { cityStateBonus, townFocus } from './observer-settlement-info.js';

const log = createLogger('observer-banners');
const OVERRIDE_PRIORITY = 1;
const STYLE_ID = 'zom-banner-style';
// A town's portrait as a city's, its focus icon whole inside the hex.
const TOWN_PORTRAIT_STYLE = [
  '.city-banner.city-banner--town .city-banner__portrait { top: -0.1666666667rem; width: 1.3333333333rem; height: 2rem; display: flex; }',
  '.city-banner.city-banner--town .city-banner__portrait-img { left: 0.1rem !important; right: 0.1rem !important; top: 0.2rem !important; bottom: 0.2rem !important; background-size: contain !important; }'
].join('\n');

/** An object reading through to target, with some keys answered by getters. */
function readThrough(target, getters) {
  return new Proxy({}, { get: (_, key) => (key in getters ? getters[key]() : target()[key]) });
}

function townFocusOf(props) {
  if (!isObserverSeat() || props.data.identity.bannerType !== 'town') return null;
  void props.data.status;   // re-read when the town's status (growth mode included) changes
  try { return townFocus(Cities.get(props.cityID)); } catch (e) { return null; }
}

/** The type icon's tooltip: the type, then the chosen suzerain bonus and its effect. */
function cityStateTooltip(props) {
  const identity = props.data.identity;
  const bonus = isObserverSeat() && identity.cityStateBonusName ? cityStateBonus(props.cityID.owner) : null;
  if (!bonus) return identity.cityStateTypeName;
  return `${Locale.compose(identity.cityStateTypeName)}[N][B]${Locale.compose(bonus.name)}[/B][N]${Locale.compose(bonus.description)}`;
}

function observerBannerData(props) {
  const identity = readThrough(() => props.data.identity, {
    portraitIcon: () => townFocusOf(props)?.icon ?? props.data.identity.portraitIcon,
    cityStateBonusName: () => {
      const focus = townFocusOf(props);
      return focus ? Locale.compose(focus.name) : props.data.identity.cityStateBonusName;
    },
    cityStateTypeName: () => cityStateTooltip(props)
  });
  const status = readThrough(() => props.data.status, {
    visible: () => bannerVisible(props.location ?? props.data.identity?.location, props.data.status.visible)
  });
  return readThrough(() => props.data, { identity: () => identity, status: () => status });
}

function install() {
  const banner = ComponentRegistry.get('CityBanner')?.factory();
  if (!banner) { log('CityBanner is not registered'); return; }
  ComponentRegistry.register('CityBanner', (props) => {
    const data = observerBannerData(props);
    return banner(mergeProps(props, { get data() { return data; } }));
  }, OVERRIDE_PRIORITY);
  engine.whenReady.then(() => { if (isObserverSeat()) setStyle(STYLE_ID, TOWN_PORTRAIT_STYLE); });
}

try { install(); } catch (e) { log(`install failed: ${e}`); }
