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
 * Zatygold's Spectator - Multiplayer Map Mod compatibility (in-game scope, every seat).
 *
 * The Map Mod's turn-1 start check (ui/strict-start-bias-notification.js) counts
 * the Observer as a player and reports its ice start as missing Fresh Water.
 * The Observer's lines are removed from its warning banner and notification
 * icon; a warning left with no failures is removed entirely.
 */
import { createLogger, isObserverPlayer } from '../shared/zom-util.js';
import { CONFIG } from '../observer/observer-config.js';

const BANNER_CLASS = 'evw-strict-bias-banner';
const ICON_CLASS = 'evw-strict-bias-notification';
const FAILURE_PREFIX = '- ';
const ICON_WATCH_MS = 60000;

const log = createLogger('compat-evw', CONFIG.debug);

/** Each Observer as the Map Mod names it: "Leader / Civilization". */
function observerLabels() {
  const labels = [];
  for (const id of Players.getAliveMajorIds()) {
    if (!isObserverPlayer(id)) continue;
    const player = Players.get(id);
    const leader = GameInfo.Leaders.lookup(player?.leaderType);
    const civ = GameInfo.Civilizations.lookup(player?.civilizationType);
    if (leader?.Name && civ?.Name) labels.push(`${Locale.compose(leader.Name)} / ${Locale.compose(civ.Name)}`);
  }
  return labels;
}

/** The warning text without the Observer's failure lines, and how many failures remain. */
function withoutObservers(text, labels) {
  const isObserverLine = (line) => line.startsWith(FAILURE_PREFIX) && labels.some((label) => line.includes(label));
  const lines = String(text ?? '').split('\n').filter((line) => !isObserverLine(line));
  return { text: lines.join('\n'), failures: lines.filter((line) => line.startsWith(FAILURE_PREFIX)).length };
}

function cleanBanner(banner, labels) {
  const { text, failures } = withoutObservers(banner.textContent, labels);
  if (failures === 0) banner.remove();
  else if (text !== banner.textContent) banner.textContent = text;
}

function cleanIcon(container, labels) {
  const button = container.querySelector('.notif__button');
  const { text, failures } = withoutObservers(button?.getAttribute('data-tooltip-content'), labels);
  if (failures === 0) { container.remove(); return; }
  button.setAttribute('data-tooltip-content', text);
  const number = container.querySelector('.notif__button-number');
  if (number) number.textContent = `${failures}`;
}

function clean(node, labels) {
  if (node.classList?.contains(BANNER_CLASS)) cleanBanner(node, labels);
  else if (node.classList?.contains(ICON_CLASS)) cleanIcon(node, labels);
}

/**
 * The banner is added to the body (again whenever the icon is selected); the icon
 * is added once, deep in the notification train, within the check's first minute.
 */
function watchWarnings(labels) {
  const onAdded = (mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) clean(node, labels);
  };
  new MutationObserver(onAdded).observe(document.body, { childList: true });
  const iconWatch = new MutationObserver(onAdded);
  iconWatch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => iconWatch.disconnect(), ICON_WATCH_MS);
  document.querySelectorAll(`.${BANNER_CLASS}, .${ICON_CLASS}`).forEach((node) => clean(node, labels));
}

engine.whenReady.then(() => {
  try {
    if (Game.turn !== 1) return;   // the Map Mod checks starts on the first turn only
    const labels = observerLabels();
    if (labels.length > 0) watchWarnings(labels);
  } catch (e) { log(`install failed: ${e}`); }
});
