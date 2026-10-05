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
 * Zatygold's Spectator - Observer settlement details (in-game scope).
 *
 * Clicking a settlement (observer-navigation.js) opens this panel: the
 * settlement's details for any leader, read directly from the game, in the
 * spirit of the City Hall mod's overview - population, growth, connections
 * (click one to open it), warehouse yields, a town's focus choices (the
 * current one highlighted) and the buildings and wonders standing. The
 * game's own City Details panel is not used: it, and the mods that decorate
 * it, follow the head selected city inside the city view, which the
 * Observer (owning no city) never enters. The arrows step through the
 * owner's settlements. It only shows; nothing in it changes the game.
 */
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { InputEngineEventName } from 'fs://game/core/ui/input/input-support.js';
import Panel from 'fs://game/core/ui/panel-support.js';
import { ComponentID } from 'fs://game/core/ui/utilities/utilities-component-id.js';
import { FocusManager } from 'fs://game/core/ui-next/services/focus-manager.js';
import { clearChildren, createLogger, deferOnce } from '../shared/zom-util.js';
import { CONFIG } from './observer-config.js';
import { isObserverSeat, SCREEN_PROPS } from './observer-core.js';
import { townFocus } from './observer-settlement-info.js';

const HOST_TAG = 'zom-observer-settlement';
const DETAILS_STYLES = 'fs://game/base-standard/ui/city-details/panel-city-details.css';

// The City Hall mod's look: striped pill rows, a small table per section.
const ROW_HEIGHT = '1.5rem';
const ROW_RADIUS = '0.75rem';
const ODD_ROW_BG = 'rgba(76, 71, 61, 0.6)';
const HIGHLIGHT_BG = 'rgba(128, 179, 77, 0.4)';   // the current town focus (food green)
const DAMAGED_COLOR = '#ff6644';
const ICON_SIZE = '1.5rem';
const ICON_SMALL = '1.25rem';
const FRAME_WIDTH = '27rem';
const SPECIALIST_ICON = "url('specialist_tile_pip_full')";
const TIMER_ICON = "url('hud_turn-timer')";
const REFRESH_EVENTS = ['CityPopulationChanged', 'CityGrowthModeChanged', 'CityProductionCompleted', 'ConstructibleAddedToMap', 'PlayerTurnActivated'];
/** Warehouse ordering by bonus yield, as the City Hall mod groups them. */
const WAREHOUSE_ORDER = {
  LOC_IMPROVEMENT_FARM_NAME: 0, LOC_IMPROVEMENT_PASTURE_NAME: 0.1, LOC_IMPROVEMENT_PLANTATION_NAME: 0.1,
  LOC_IMPROVEMENT_FISHING_BOAT_NAME: 0.2, LOC_IMPROVEMENT_MINE_NAME: 1, LOC_IMPROVEMENT_CLAY_PIT_NAME: 1.1,
  LOC_IMPROVEMENT_QUARRY_NAME: 1.2, LOC_IMPROVEMENT_WOODCUTTER_NAME: 1.3, LOC_IMPROVEMENT_CAMP_NAME: 1.4,
  LOC_IMPROVEMENT_OIL_RIG_NAME: 1.5
};

const log = createLogger('observer-settlement', CONFIG.debug);

let shown = null;   // the settlement whose details are open

const nameSort = (a, b) => Locale.compose(a ?? '').localeCompare(Locale.compose(b ?? ''));

/** One activation per click: fxs-activatable can fire action-activate and click together. */
let lastActivation = 0;
function onActivate(element, run) {
  const once = () => {
    const now = Date.now();
    if (now - lastActivation < 150) return;
    lastActivation = now;
    run();
  };
  for (const event of ['action-activate', 'click']) element.addEventListener(event, once);
}

// ============================ Elements ============================

function el(classes, cssText = '') {
  const node = document.createElement('div');
  node.classList.value = classes;
  if (cssText) node.style.cssText = cssText;
  return node;
}

function iconDiv(icon, size = ICON_SIZE, imageSize = '') {
  const node = el('relative bg-contain bg-no-repeat', `width: ${size}; height: ${size}; background-position: center;`);
  if (imageSize) node.style.backgroundSize = imageSize;
  node.style.backgroundImage = String(icon).startsWith('url(') ? icon : UI.getIconCSS(icon);
  return node;
}

function textDiv(loc, classes = '') {
  const node = el(classes);
  node.setAttribute('data-l10n-id', loc);
  return node;
}

function heading(loc) {
  return textDiv(loc, 'text-secondary font-title-base uppercase mt-3 mb-1');
}

function divider() {
  const box = el('flex w-96 self-center mt-2');
  for (const flip of ['', ' -scale-x-100']) box.appendChild(el(`w-1/2 h-4 bg-cover bg-no-repeat city-details-half-divider${flip}`));
  return box;
}

/** A striped pill row: icon, label (grows), then value texts / extra icons. */
function tableRow(stripe, icon, labelLoc, ...tail) {
  const row = el('flex flex-row items-center px-2', `min-height: ${ROW_HEIGHT}; border-radius: ${ROW_RADIUS};`);
  if (stripe) row.style.backgroundColor = ODD_ROW_BG;
  if (icon) row.appendChild(iconDiv(icon));
  row.appendChild(textDiv(labelLoc, 'text-left flex-auto mx-2 font-body-sm text-accent-2'));
  for (const piece of tail) if (piece) row.appendChild(piece);
  return row;
}

const valueDiv = (text) => {
  const node = el('text-right font-body-sm text-accent-1', 'min-width: 1.5rem;');
  node.textContent = text;
  return node;
};

// ============================ Data ============================

const cityOf = () => (shown ? Cities.get(shown) : null);

function religionIcon(religionId) {
  const def = GameInfo.Religions.lookup(religionId);
  return def ? def.ReligionType : null;
}

/** Population, growth and state, as the City Hall mod's growth block. */
function summary(city) {
  const growth = city.Growth;
  const growing = growth?.growthType === GrowthTypes.EXPAND;
  return {
    population: city.population ?? 0,
    urban: city.urbanPopulation ?? 0,
    rural: city.ruralPopulation ?? 0,
    specialists: city.Workers?.getNumWorkers?.(false) ?? 0,
    urbanReligion: religionIcon(city.Religion?.urbanReligion),
    ruralReligion: religionIcon(city.Religion?.ruralReligion),
    food: growing ? {
      current: growth?.currentFood ?? 0,
      threshold: growth?.getNextGrowthFoodThreshold?.()?.value ?? 0,
      turns: growth?.turnsUntilGrowth ?? -1
    } : null,
    razedTurns: city.isBeingRazed ? city.getTurnsUntilRazed : null,
    unrestTurns: city.Happiness?.hasUnrest ? Math.max(0, city.Happiness?.turnsOfUnrest ?? 0) : null
  };
}

/** Connected settlements: cities, then growing towns, then focused towns (each sorted by name). */
function connections(city) {
  const settlements = (city.getConnectedCities?.() ?? []).map((id) => Cities.get(id)).filter(Boolean)
    .sort((a, b) => nameSort(a.name, b.name));
  const rank = (s) => (!s.isTown ? 0 : (s.Growth?.growthType === GrowthTypes.EXPAND ? 1 : 2));
  return settlements.sort((a, b) => rank(a) - rank(b));
}

/** Improvements grouped by name: { name, icon, order, bonusIcon, count }, warehouse bonuses first. */
function warehouses(city) {
  const groups = new Map();
  for (const id of city.Constructibles?.getIds?.() ?? []) {
    const item = Constructibles.getByComponentID(id);
    const info = item && GameInfo.Constructibles.lookup(item.type);
    if (info?.ConstructibleClass !== 'IMPROVEMENT') continue;
    const baseType = Districts.getFreeConstructible?.(item.location, city.owner);
    const def = GameInfo.Constructibles.lookup(baseType) ?? info;
    const group = groups.get(def.Name) ?? {
      name: def.Name,
      icon: def.ConstructibleType,
      order: WAREHOUSE_ORDER[def.Name] ?? 99,
      bonusIcon: GameInfo.Yields[Math.floor(WAREHOUSE_ORDER[def.Name] ?? -1)]?.YieldType ?? null,
      count: 0
    };
    group.count += 1;
    groups.set(def.Name, group);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order || nameSort(a.name, b.name));
}

/** Counts feeding the focus bonus estimates (fortified and appealing tiles, quarters). */
function districtCounts(city) {
  const counts = { fortified: 0, appeal: 0, quarters: 0 };
  try {
    const appealing = GameInfo.GlobalParameters.lookup('APPEAL_FOR_HAPPINESS_TILE_YIELD')?.Value ?? 3;
    for (const id of city.Districts?.getIds?.() ?? []) {
      const district = Districts.get(id);
      if (!district) continue;
      if (district.isQuarter) counts.quarters += 1;
      const loc = district.location;
      if (Number(appealing) <= GameplayMap.getAppeal(loc.x, loc.y)) counts.appeal += 1;
      const fortified = MapConstructibles.getHiddenFilteredConstructibles(loc.x, loc.y).some((conId) => {
        const type = Constructibles.getByComponentID(conId)?.type;
        const info = type != null ? GameInfo.Constructibles.lookup(type) : null;
        return !!info && GameInfo.TypeTags.find((tag) => tag.Type === info.ConstructibleType && tag.Tag === 'FORTIFICATION') != null;
      });
      if (fortified) counts.fortified += 1;
    }
  } catch (e) { log.debug(`district counts failed: ${e}`); }
  return counts;
}

/** Each focus project's estimated bonuses, as the City Hall mod lists them: [{ icon, bonus }]. */
function focusDetails(projectType, city, counts, groups) {
  const warehouseCount = (...names) => groups.filter((g) => names.includes(g.name)).reduce((sum, g) => sum + g.count, 0);
  const resources = (city.Constructibles?.getIds?.() ?? []).filter((id) => {
    const loc = Constructibles.getByComponentID(id)?.location;
    return loc && GameplayMap.getResourceType(loc.x, loc.y) !== ResourceTypes.NO_RESOURCE;
  }).length;
  switch (projectType) {
    case 'PROJECT_TOWN_FORT': return [{ icon: 'ACTION_FORTIFY', bonus: 25 }, { icon: 'YIELD_GOLD', bonus: counts.fortified }];
    case 'PROJECT_TOWN_URBAN_CENTER': return [{ icon: 'YIELD_SCIENCE', bonus: counts.quarters }, { icon: 'YIELD_CULTURE', bonus: counts.quarters }];
    case 'PROJECT_TOWN_RESORT': return [{ icon: 'YIELD_GOLD', bonus: counts.appeal }, { icon: 'YIELD_HAPPINESS', bonus: counts.appeal }];
    case 'PROJECT_TOWN_GRANARY':
    case 'PROJECT_TOWN_FISHING':
      return [{ icon: 'YIELD_FOOD', bonus: warehouseCount('LOC_IMPROVEMENT_FARM_NAME', 'LOC_IMPROVEMENT_PASTURE_NAME', 'LOC_IMPROVEMENT_PLANTATION_NAME', 'LOC_IMPROVEMENT_FISHING_BOAT_NAME') }];
    case 'PROJECT_TOWN_PRODUCTION':
      return [{ icon: 'YIELD_PRODUCTION', bonus: 2 * warehouseCount('LOC_IMPROVEMENT_CAMP_NAME', 'LOC_IMPROVEMENT_WOODCUTTER_NAME', 'LOC_IMPROVEMENT_CLAY_PIT_NAME', 'LOC_IMPROVEMENT_MINE_NAME', 'LOC_IMPROVEMENT_QUARRY_NAME') }];
    case 'PROJECT_TOWN_TRADE': return [{ icon: 'YIELD_TRADES', bonus: 5 }, { icon: 'YIELD_HAPPINESS', bonus: resources }];
    case 'PROJECT_TOWN_INN': return [{ icon: 'YIELD_DIPLOMACY', bonus: city.getConnectedCities?.()?.length ?? 0 }];
    case 'PROJECT_TOWN_FACTORY': return [{ icon: 'YIELD_TRADES', bonus: 5 }];
    default: return [];
  }
}

/**
 * A town's focus choices with the current one highlighted; coastal towns
 * trade the Granary focus for Fishing, as the game offers them.
 */
function townFocusTable(city, groups) {
  if (!city.isTown) return null;
  const counts = districtCounts(city);
  const isCoastal = GameplayMap.isCoastalLand(city.location.x, city.location.y);
  const currentType = city.Growth?.growthType === GrowthTypes.PROJECT
    ? GameInfo.Projects.lookup(city.Growth?.projectType)?.ProjectType ?? null : null;
  const rows = [{
    icon: 'PROJECT_GROWTH',
    name: 'LOC_UI_FOOD_CHOOSER_FOCUS_GROWTH',
    description: 'LOC_PROJECT_TOWN_FOOD_INCREASE_DESCRIPTION',
    highlight: currentType == null,
    details: []
  }];
  for (const info of GameInfo.Projects) {
    if (info.CityOnly) continue;
    if ((info.ProjectType === 'PROJECT_TOWN_FISHING') !== isCoastal && ['PROJECT_TOWN_GRANARY', 'PROJECT_TOWN_FISHING'].includes(info.ProjectType)) continue;
    rows.push({
      icon: info.ProjectType,
      name: info.Name,
      description: info.Description,
      highlight: currentType != null && info.ProjectType === currentType,
      details: focusDetails(info.ProjectType, city, counts, groups)
    });
  }
  return rows;
}

/** Buildings and wonders standing: { name, icon, count, damaged }, sorted by name. */
function constructibleGroups(city, wantedClass) {
  const groups = new Map();
  for (const id of city.Constructibles?.getIds?.() ?? []) {
    const item = Constructibles.getByComponentID(id);
    const info = item && GameInfo.Constructibles.lookup(item.type);
    if (info?.ConstructibleClass !== wantedClass) continue;
    const group = groups.get(info.Name) ?? { name: info.Name, icon: info.ConstructibleType, count: 0, damaged: false };
    group.count += 1;
    group.damaged ||= !!item.damaged;
    groups.set(info.Name, group);
  }
  return [...groups.values()].sort((a, b) => nameSort(a.name, b.name));
}

// ============================ Panel ============================

class ObserverSettlementPanel extends Panel {
  engineInputListener = this.onEngineInput.bind(this);
  closeListener = () => this.close();
  refreshListener = deferOnce(() => { if (shown) this.renderCity(); });

  onAttach() {
    super.onAttach();
    this.frame = this.Root.querySelector('fxs-subsystem-frame');
    this.Root.addEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.addEventListener('subsystem-frame-close', this.closeListener);
    for (const [selector, step] of [['.zom-settlement-prev', -1], ['.zom-settlement-next', 1]]) {
      const arrow = this.Root.querySelector(selector);
      if (arrow) onActivate(arrow, () => this.step(step));
    }
    for (const event of REFRESH_EVENTS) engine.on(event, this.refreshListener);
    this.renderCity();
  }

  onDetach() {
    for (const event of REFRESH_EVENTS) engine.off(event, this.refreshListener);
    this.Root.removeEventListener(InputEngineEventName, this.engineInputListener);
    this.frame?.removeEventListener('subsystem-frame-close', this.closeListener);
    shown = null;
    super.onDetach();
  }

  onReceiveFocus() {
    super.onReceiveFocus();
    FocusManager.get().setFocus(this.Root);
  }

  onEngineInput(ev) {
    if (ev.detail.status !== InputActionStatuses.FINISH) return;
    if (ev.isCancelInput() || ev.detail.name === 'sys-menu') {
      this.close();
      ev.stopPropagation();
      ev.preventDefault();
    }
  }

  /** The owner's previous / next settlement. */
  step(direction) {
    const city = cityOf();
    const cities = Players.get(city?.owner ?? -1)?.Cities?.getCities?.() ?? [];
    if (!cities.length) return;
    const index = cities.findIndex((c) => ComponentID.isMatch(c.id, shown));
    shown = cities[(index + direction + cities.length) % cities.length]?.id ?? shown;
    this.renderCity();
  }

  renderCity() {
    try { this.render(); } catch (e) { log(`settlement render failed: ${e}`); }
  }

  render() {
    const city = cityOf();
    if (!city) { this.close(); return; }
    this.Root.querySelector('.zom-settlement-title')?.setAttribute('data-l10n-id', city.isTown ? 'LOC_UI_TOWN_DETAILS_HEADER' : 'LOC_UI_CITY_DETAILS_HEADER');
    this.Root.querySelector('.zom-settlement-name')?.setAttribute('title', Locale.compose(city.name));
    const ownerName = Players.get(city.owner)?.name;
    this.Root.querySelector('.zom-settlement-owner')?.setAttribute('data-l10n-id', ownerName ?? '');
    const list = this.Root.querySelector('.zom-settlement-list');
    if (!list) return;
    clearChildren(list);
    const facts = summary(city);
    this.renderAlerts(list, facts);
    this.renderGrowth(list, facts, city);
    const groups = warehouses(city);
    this.renderConnections(list, city);
    this.renderWarehouses(list, groups);
    this.renderTownFocus(list, city, groups);
    this.renderConstructibles(list, city);
  }

  renderAlerts(list, facts) {
    if (facts.razedTurns != null) {
      const line = textDiv('LOC_UI_CITY_DETAILS_CITY_BEING_RAZED', 'font-title text-negative uppercase self-center mt-2');
      list.appendChild(line);
      list.appendChild(alertLine(Locale.compose('LOC_UI_CITY_DETAILS_CITY_TURNS_TILL_RAZED', facts.razedTurns)));
    }
    if (facts.unrestTurns != null) list.appendChild(alertLine(`${Locale.compose('LOC_CITY_UNREST')}: ${facts.unrestTurns}`));
  }

  renderGrowth(list, facts, city) {
    list.appendChild(heading('LOC_UI_CITY_DETAILS_GROWTH_TAB'));
    if (facts.food) {
      const row = el('flex flex-row items-center self-start px-2', `min-height: ${ROW_HEIGHT}; border-radius: ${ROW_RADIUS}; background-color: ${HIGHLIGHT_BG};`);
      row.appendChild(iconDiv('YIELD_FOOD', ICON_SIZE, ICON_SMALL));
      row.appendChild(valueDiv(`${Locale.compose('LOC_ZOM_GROUPED_DIGITS', facts.food.current)} / ${Locale.compose('LOC_ZOM_GROUPED_DIGITS', facts.food.threshold)}`));
      if (facts.food.turns >= 0) {
        row.appendChild(valueDiv(String(facts.food.turns)));
        row.appendChild(iconDiv(TIMER_ICON, ICON_SIZE, ICON_SIZE));
      }
      list.appendChild(row);
    }
    const rows = [
      [city.isTown ? 'YIELD_TOWNS' : 'YIELD_CITIES', 'LOC_UI_CITY_STATUS_POPULATION_TITLE', facts.population],
      [facts.urbanReligion ?? 'CITY_URBAN', 'LOC_UI_CITY_STATUS_URBAN_POPULATION', facts.urban],
      [facts.ruralReligion ?? 'CITY_RURAL', 'LOC_UI_CITY_STATUS_RURAL_POPULATION', facts.rural],
      [SPECIALIST_ICON, 'LOC_UI_SPECIALISTS_SUBTITLE', facts.specialists]
    ];
    const table = el('flex flex-col self-start', 'min-width: 14rem;');
    rows.forEach(([icon, label, value], i) => table.appendChild(tableRow(i % 2 === 0, icon, label, valueDiv(String(value)))));
    list.appendChild(table);
  }

  renderConnections(list, city) {
    const linked = connections(city);
    if (!linked.length) return;
    list.appendChild(divider());
    list.appendChild(heading('LOC_UI_CITY_DETAILS_CONNECTIONS'));
    const table = el('flex flex-row self-start');
    const half = linked.length < 3 ? linked.length : Math.ceil(linked.length / 2);
    for (const column of [linked.slice(0, half), linked.slice(half)]) {
      if (!column.length) continue;
      const col = el('flex flex-col mr-2');
      for (const conn of column) {
        const row = document.createElement('fxs-activatable');
        row.classList.value = 'flex flex-row items-center px-2 pointer-events-auto';
        row.style.cssText = `min-height: ${ROW_HEIGHT}; border-radius: ${ROW_RADIUS}; width: 11rem;`;
        const focus = conn.isTown ? townFocus(conn) : null;
        row.appendChild(iconDiv(focus ? `url('${focus.icon}')` : (conn.isTown ? 'YIELD_TOWNS' : 'YIELD_CITIES'), ICON_SIZE, ICON_SMALL));
        const name = textDiv(conn.name, 'mx-1 text-left font-body-sm text-accent-2 truncate');
        row.appendChild(name);
        if (focus) row.setAttribute('data-tooltip-content', Locale.compose(focus.name));
        const id = conn.id;
        onActivate(row, () => showSettlement(id));
        col.appendChild(row);
      }
      table.appendChild(col);
    }
    list.appendChild(table);
  }

  renderWarehouses(list, groups) {
    if (!groups.length) return;
    list.appendChild(divider());
    list.appendChild(heading('LOC_BUILDING_PLACEMENT_WAREHOUSE_YIELDS_HEADER'));
    const table = el('flex flex-col self-stretch');
    groups.forEach((group, i) => {
      const tail = [group.bonusIcon ? iconDiv(group.bonusIcon, ICON_SIZE, ICON_SMALL) : null, valueDiv(`×${group.count}`)];
      table.appendChild(tableRow(i % 2 === 0, group.icon, group.name, ...tail));
    });
    list.appendChild(table);
  }

  renderTownFocus(list, city, groups) {
    const rows = townFocusTable(city, groups);
    if (!rows?.length) return;
    list.appendChild(divider());
    list.appendChild(heading('LOC_UI_TOWN_FOCUS'));
    const table = el('flex flex-col self-stretch');
    rows.forEach((item, i) => {
      const tail = item.details.flatMap((detail) => [iconDiv(detail.icon, ICON_SIZE, ICON_SMALL), valueDiv(`+${detail.bonus}`)]);
      const row = tableRow(i % 2 === 0, item.icon, item.name, ...tail);
      if (item.highlight) row.style.backgroundColor = HIGHLIGHT_BG;
      row.setAttribute('data-tooltip-content', `[style:leading-normal]${Locale.compose(item.description)}[/style]`);
      row.classList.add('pointer-events-auto');
      table.appendChild(row);
    });
    list.appendChild(table);
  }

  renderConstructibles(list, city) {
    for (const [wantedClass, titleLoc] of [['BUILDING', 'LOC_UI_CITY_DETAILS_BUILDINGS'], ['WONDER', 'LOC_UI_CITY_DETAILS_WONDERS']]) {
      const groups = constructibleGroups(city, wantedClass);
      if (!groups.length) continue;
      list.appendChild(divider());
      list.appendChild(heading(titleLoc));
      const table = el('flex flex-col self-stretch');
      groups.forEach((group, i) => {
        const tail = [];
        if (group.damaged) tail.push(textDiv('LOC_UI_CITY_DETAILS_BUILDING_DAMAGED', 'uppercase font-body-sm mr-1'));
        if (group.count > 1) tail.push(valueDiv(`×${group.count}`));
        const row = tableRow(i % 2 === 0, group.icon, group.name, ...tail);
        const damagedText = group.damaged ? row.children[2] : null;
        if (damagedText) damagedText.style.color = DAMAGED_COLOR;
        table.appendChild(row);
      });
      list.appendChild(table);
    }
  }
}

/** A red alert line (razing / unrest). */
function alertLine(text) {
  const line = el('font-body-sm self-center', `color: ${DAMAGED_COLOR};`);
  line.textContent = text;
  return line;
}

const CONTENT = `
<fxs-subsystem-frame class="zom-settlement-frame shrink pointer-events-auto" tabindex="-1" style="width: ${FRAME_WIDTH}; margin: 2.6666666667rem 0.2222222222rem 1rem 0;">
  <div class="flex flex-col items-stretch self-stretch" data-slot="header">
    <div class="flex flex-row items-center justify-center px-10">
      <fxs-activatable class="zom-settlement-prev flex flex-row items-center pointer-events-auto"><div class="img-arrow w-8 h-12"></div></fxs-activatable>
      <fxs-header class="zom-settlement-name px-4 uppercase tracking-100 justify-center flex" filigree-style="h3" style="min-width: 12rem;"></fxs-header>
      <fxs-activatable class="zom-settlement-next flex flex-row-reverse items-center pointer-events-auto"><div class="img-arrow w-8 h-12 -scale-x-100"></div></fxs-activatable>
    </div>
    <div class="flex flex-row items-center justify-center">
      <div class="zom-settlement-title font-title-sm text-accent-3 uppercase mr-2"></div>
      <div class="zom-settlement-owner font-body-sm text-accent-2"></div>
    </div>
  </div>
  <div class="zom-settlement-list flex flex-col flex-auto mx-6 my-2"></div>
</fxs-subsystem-frame>`;

Controls.define(HOST_TAG, {
  createInstance: ObserverSettlementPanel,
  description: 'Spectator settlement details (any leader).',
  classNames: ['absolute', 'inset-0', 'flex', 'flex-row', 'justify-end', 'items-stretch', 'pointer-events-none'],
  innerHTML: [CONTENT],
  styles: [DETAILS_STYLES],
  attributes: [],
  tabIndex: -1
});

// ============================ Opening ============================

/** Open (or switch) the details panel to a settlement. */
function showSettlement(cityId) {
  if (!isObserverSeat() || !cityId || ComponentID.isInvalid(cityId) || !Cities.get(cityId)) return false;
  shown = cityId;
  const open = document.querySelector(HOST_TAG);
  if (open) (open.maybeComponent ?? open.component)?.renderCity();
  else ContextManager.push(HOST_TAG, SCREEN_PROPS);
  return true;
}

engine.on('BeforeUnload', () => { shown = null; });

export { showSettlement };
