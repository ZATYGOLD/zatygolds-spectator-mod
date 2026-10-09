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
 * Zatygold's Spectator - Observer Chronicle (in-game scope).
 *
 * The Chronicle screen, built from the Victories screen's frame, tab bar and
 * stylesheet, with two filters: the view and the Age (Overall or one Age).
 *  - Yields: line graphs of each leader's yields per turn
 *    (observer-graph-lines.js, observer-graph-yields.js).
 *  - Empire: timelines of each leader's settlements and citizens
 *    (observer-graph-empire.js).
 *  - Military: a line graph of each leader's military strength and timelines
 *    of its units, promotions, wars and conflicts (observer-graph-military.js).
 * Every view marks each crisis stage (observer-crisis.js) and, in Overall,
 * where each Age starts; rows and graphs are fitted to the panel's height.
 * The screen opens from a button in the HUD's sub-system dock.
 */
import { template, insert } from 'fs://game/core/vendor/solid-js/web/dist/web.js';
import { createComponent, createMemo, createSignal, onCleanup, onMount, Show } from 'fs://game/core/vendor/solid-js/dist/solid.js';
import { ContextManager } from 'fs://game/core/ui/context-manager/context-manager.js';
import { defineLegacyComponent } from 'fs://game/core/ui-next/components/fxs-solid-component.js';
import { Tab } from 'fs://game/core/ui-next/components/tab.js';
import { ComponentRegistry } from 'fs://game/core/ui-next/services/component-registry.js';
import { isMobile } from 'fs://game/core/ui-next/services/view-experience.js';
import { ScreenFrame } from 'fs://game/base-standard/ui-next/components/screen-frame.js';
import victoriesStyle from 'fs://game/base-standard/ui-next/screens/victories/victories-screen.scss.js';
import { createLogger } from '../shared/zom-util.js';
import { isObserverSeat, onScreenDock, SCREEN_PROPS } from './observer-core.js';
import { ageCrises, CRISIS_EVENT } from './observer-crisis.js';
import { EMPIRE_VIEW } from './observer-graph-empire.js';
import { LinePanel } from './observer-graph-lines.js';
import { MILITARY_VIEW } from './observer-graph-military.js';
import { inAge, loggedLeaders, OVERALL } from './observer-graph-parts.js';
import { TimelinePanel } from './observer-graph-timelines.js';
import { YIELDS_VIEW } from './observer-graph-yields.js';
import { HISTORY_EVENT } from './observer-history.js';

const log = createLogger('observer-graphs');
const GRAPHS_TAG = 'zom-observer-graphs';
const DOCK_BUTTON_CLASS = 'zom-graphs-dock-button';
const TOP_ICON_CLASS = 'zom-graphs-top-icon';
const TOP_ICON_ZOOM = 1.5;   // the glyph fills the frame's top medallion
const VIEWS = [YIELDS_VIEW, EMPIRE_VIEW, MILITARY_VIEW];

const T = {
  container: template(`<div class="mt-8 flex flex-col flex-auto bg-accent-6 items-center mb-5 pl-8 pr-8 pt-8 relative victories-panel-container"><div class="absolute inset-0 bottom-0 filigree-inner-frame-top"></div><div class="absolute inset-0 bottom-0 filigree-inner-frame-bottom"></div></div>`)
};

function ornatePanelData() {
  return {
    topIconSrc: 'none',   // the medallion shows the chronicle glyph (placeTopIcon)
    topIconClass: `size-14 relative ${TOP_ICON_CLASS}`,
    backgroundImageSrc: '',
    name: 'ZOM-Graphs',
    id: GRAPHS_TAG,
    isFullscreen: isMobile()
  };
}

/** The Victories tab bar and panel area for one view's tabs: [{ name, title, body }]. */
const TabGroup = (props) => createComponent(Tab, {
  'class': 'victories-tab-bar w-full flex flex-col flex-auto pointer-events-auto mx-5',
  defaultTab: props.tabs[0].name,
  get children() {
    const container = T.container();
    insert(container, createComponent(Tab.Output, {}), null);
    return [
      createComponent(Tab.TabList, { 'class': 'victories-tab-width self-center text-base font-base', nextHotkey: 'nav-next', previousHotkey: 'nav-previous' }),
      container,
      ...props.tabs.map((tab) => createComponent(Tab.Item, tab))
    ];
  }
});

/** A signal of `read()` refreshed on each window event of `names`. */
function liveSignal(read, names) {
  const [value, setValue] = createSignal(read(), { equals: false });
  const listener = () => setValue(read());
  onMount(() => names.forEach((name) => window.addEventListener(name, listener)));
  onCleanup(() => names.forEach((name) => window.removeEventListener(name, listener)));
  return value;
}

/** A source's signals ({ kind, read, changeEvents }): all it holds, those in the chosen Age, and (timelines) its leaders. */
function sourceSignals(source, filters) {
  const all = liveSignal(source.read, source.changeEvents);
  const entries = createMemo(() => inAge(all(), filters.age()));
  const leaders = source.kind === 'timeline' ? createMemo(() => loggedLeaders(all())) : null;
  return { entries, leaders };
}

/**
 * A view's tabs: a line graph per recorded number, or a timeline per logged
 * kind, each from its tab's source (else the view's) and subject (else the view).
 */
function viewTabs(view, filters) {
  const tabs = view.tabs;
  const sourceOf = (tab) => tab.source ?? view;
  // Made with the screen (not a tab's body, disposed when another tab opens), so they keep listening.
  const sources = new Map([...new Set(tabs.map(sourceOf))].map((source) => [source, sourceSignals(source, filters)]));
  const panel = (tab) => {
    const source = sourceOf(tab);
    const { entries, leaders } = sources.get(source);
    return source.kind === 'line'
      ? createComponent(LinePanel, { tab, samples: entries, ...filters })
      : createComponent(TimelinePanel, { subject: tab.subject ?? view, tab, events: entries, leaders, ...filters });
  };
  return tabs.map((tab) => ({ name: tab.id, title: () => tab.label, body: () => panel(tab) }));
}

const GraphsScreenComponent = () => {
  const [view, setView] = createSignal(VIEWS[0].id);
  const [age, setAge] = createSignal(OVERALL);
  const [hidden, setHidden] = createSignal(new Set(), { equals: false });
  const crises = liveSignal(ageCrises, [CRISIS_EVENT]);
  const turn = liveSignal(() => Game.turn, [HISTORY_EVENT]);   // the current progress moves each turn
  onMount(placeTopIcon);

  const toggle = (id) => {
    const set = hidden();
    if (!set.delete(id)) set.add(id);
    setHidden(set);
  };
  const filters = { views: VIEWS, view, setView, age, setAge, hidden, toggle, crises, turn };
  const tabs = Object.fromEntries(VIEWS.map((v) => [v.id, viewTabs(v, filters)]));

  return createComponent(ScreenFrame, {
    name: 'ZOM-Graphs',
    panelContext: GRAPHS_TAG,
    audioContext: 'VictoryScreen',
    title: 'LOC_ZOM_GRAPHS_TITLE',
    ornatePanelData: ornatePanelData(),
    addYieldBar: false,
    get isFullscreen() { return isMobile(); },
    get children() {
      return VIEWS.map((v) => createComponent(Show, {
        get when() { return view() === v.id; },
        get children() { return createComponent(TabGroup, { tabs: tabs[v.id] }); }
      }));
    }
  });
};

/** The chronicle glyph in the frame's top medallion, where the Victories screen has its trophy. */
function placeTopIcon(attempts = 10) {
  const medallion = document.querySelector(`${GRAPHS_TAG} .${TOP_ICON_CLASS}`);
  if (!medallion) {
    if (attempts > 0) requestAnimationFrame(() => placeTopIcon(attempts - 1));
    return;
  }
  if (!medallion.firstChild) medallion.appendChild(chronicleGlyph(TOP_ICON_ZOOM));
}

const GraphsScreen = ComponentRegistry.register({
  name: 'ZOMGraphsScreen',
  styles: [victoriesStyle],
  createInstance: GraphsScreenComponent
});

defineLegacyComponent(GRAPHS_TAG, { classNames: ['fullscreen'], attrs: {} }, () => {
  Input.setActiveContext(InputContext.Shell);
  return createComponent(GraphsScreen, {});
});

const openGraphs = () => ContextManager.push(GRAPHS_TAG, SCREEN_PROPS);

// ============================ Dock button ============================

/**
 * The button's icon in the dock icons' look - a light, engraved glyph with a
 * dark edge - drawn on a 128 x 128 canvas centred on the button, and larger
 * in the screen's top medallion (the game has no such icon): an open book,
 * the chronicle, with lines of writing on each page.
 */
const CHRONICLE_GLYPH = {
  light: ['#f1ebdc', '#b9b2a2'],   // top and bottom of the glyph's gradient
  edge: 'rgba(20, 16, 10, 0.75)',
  centre: [64, 66],
  strokes: [   // [points, width]
    [[[64, 50], [38, 42], [38, 82], [64, 90], [90, 82], [90, 42], [64, 50]], 5],
    [[[64, 50], [64, 90]], 4],
    ...[56, 64, 72].flatMap((y) => [[[[44, y - 4], [57, y]], 3], [[[71, y], [84, y - 4]], 3]])
  ]
};

function chronicleGlyph(zoom = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const light = ctx.createLinearGradient(0, 42, 0, 90);
  light.addColorStop(0, CHRONICLE_GLYPH.light[0]);
  light.addColorStop(1, CHRONICLE_GLYPH.light[1]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(64, 64);
  ctx.scale(zoom, zoom);
  ctx.translate(-CHRONICLE_GLYPH.centre[0], -CHRONICLE_GLYPH.centre[1]);
  const stroke = (points, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  for (const [points, width] of CHRONICLE_GLYPH.strokes) stroke(points, CHRONICLE_GLYPH.edge, width + 4);
  for (const [points, width] of CHRONICLE_GLYPH.strokes) stroke(points, light, width);
  return canvas;
}

/** The Chronicle button after the dock's own screen buttons, built by the dock itself. */
function placeDockButton(dock) {
  const root = dock?.Root;
  if (!isObserverSeat() || !root || root.querySelector('.' + DOCK_BUTTON_CLASS)) return;
  const button = dock.createButton({
    tooltip: 'LOC_ZOM_GRAPHS_TITLE',
    modifierClass: 'zom-graphs',
    callback: openGraphs,
    class: DOCK_BUTTON_CLASS,
    audio: 'unlocks',
    focusedAudio: 'data-audio-focus-small'
  });
  button.classList.add('ssb__element');
  button.querySelector('.ssb__button-icon')?.appendChild(chronicleGlyph());
  const slot = root.querySelector('#panel-sub-system-dock-mod-slot');
  if (slot) slot.parentElement.insertBefore(button, slot);
  else root.appendChild(button);
}

onScreenDock({ place: placeDockButton }, log);
