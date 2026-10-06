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
 * Zatygold's Spectator - Observer ribbon look (in-game scope).
 *
 * One injected stylesheet plus per-card marks: fixed card size across views,
 * compact coloured stat rows (lining digits, best highlight, negatives
 * in red), the banner tinted with the player's colour, alliance / war / celebration
 * highlights on portraits, and the leader's faith badges.
 */
import { ancestorWithClass, setStyle } from '../shared/zom-util.js';
import { HIGHLIGHT, ROW_COLORS } from './observer-config.js';
import { diplomacySnapshot } from './observer-core.js';

const STYLE_ID = 'zom-observer-ribbon-style';
const SIZED_CLASS = 'zom-observer-ribbon';
const HIDDEN_CLASS = 'zom-observer-hub-hidden';
const CELEBRATING_CLASS = 'zom-celebrating';
const AT_WAR_CLASS = 'zom-at-war';
const ALLY_CLASS_PREFIX = 'zom-ally-';
const PIPS_CLASS = 'zom-war-pips';
const BEST_CLASS = 'zom-best';
const NEGATIVE_CLASS = 'zom-negative';
const ROW_SHADOW = 'text-shadow: 0 0.0555555556rem 0.1111111111rem black, 0 0 0.3333333333rem black;';
const OWN_CARD_CLASS = 'zom-observer-own-card';
const FAITH_CLASS = 'zom-faith';
const FAITH_ICON_CLASS = 'zom-faith-icon';
const FAITH_ACTION_CLASS = 'zom-faith-action';
const FAITH_ATTR = 'data-zom-faith';
const FAITH_KIND_PREFIX = 'zom-faith--';   // + badge kind
const FAITH_ICON_REM = [2, 1.6, 1.35];   // badge size by count (the base slot is 2rem)
const DETAILS_CHANGED_EVENT = 'zom-ribbon-details-changed';
const DETAILS_OPTION = ['user', 'Interface', 'RibbonStats'];   // System > "Always Show Ribbon Yields"
const ROW_TYPE_PREFIX = 'yield-colors--';
const SIGNATURE_ATTR = 'data-zom-highlight';
const CONTENT_WIDTH = '4.6666666667rem';   // a little under the base .diplo-ribbon_content-container (4.72rem)
const CARD_GAP = '0.0555555556rem';        // 1px between neighbouring cards

let statHeightPx = 0;

// ============================ Stylesheet ============================

const card = (selector) => `.${SIZED_CLASS} ${selector}`;
const glow = (color, size = HIGHLIGHT.glowSize) => `filter: drop-shadow(0 0 ${size} ${color});`;
/** Tints the hex border like the base tints the hex (the frame ignores fxs-background-image-tint); it replaces the frame's glow. */
const hexBorder = (selector, color) => `${card(selector)} .diplo-ribbon__portrait-hex-bg-frame { filter: fxs-color-tint(${color}); }`;


/** Glow around the whole portrait hex, plus a tight glow on the hex border itself so the edge reads clearly. */
const portraitGlow = (selector, color) => [
  `${card(selector)} .diplo-ribbon__portrait { ${glow(color)} }`,
  `${card(selector)} .diplo-ribbon__portrait-hex-bg-frame { ${glow(color, HIGHLIGHT.borderGlowSize)} }`
];

/** A celebration tints the civ banner and glows it and the portrait gold. */
function celebrationRules() {
  const selector = '.' + CELEBRATING_CLASS;
  return [
    ...portraitGlow(selector, HIGHLIGHT.celebration),
    `${card(selector)} .diplo-ribbon__front-banner-shadow { fxs-border-image-tint: ${HIGHLIGHT.celebration}; }`,
    `${card(selector)} .diplo-ribbon__upper-bg { ${glow(HIGHLIGHT.celebration)} }`
  ];
}

/** (Re)write the stylesheet when its content changes. Later rules win: war glow, then the alliance border. */
function writeStyle() {
  const fixed = (prop) => `${prop}: ${CONTENT_WIDTH} !important; min-${prop}: ${CONTENT_WIDTH} !important; max-${prop}: ${CONTENT_WIDTH} !important;`;
  const height = statHeightPx > 0 ? `height: ${statHeightPx}px !important; min-height: ${statHeightPx}px !important; max-height: ${statHeightPx}px !important;` : '';
  setStyle(STYLE_ID, [
    `.${SIZED_CLASS} .diplo-ribbon__yields { ${fixed('width')} overflow: hidden !important; ${height} }`,
    `.${SIZED_CLASS} .diplo-ribbon_content-container { ${fixed('width')} }`,
    `.${SIZED_CLASS} .relationship-icon, .${SIZED_CLASS} .diplo-ribbon__war-support-count { display: none; }`,
    `.${SIZED_CLASS} .diplo-ribbon__yields .yield-item { line-height: 1.05rem; padding: 0.05rem 0.1666666667rem 0.05rem 0.1111111111rem; border-radius: 0.444em; }`,
    `.${SIZED_CLASS} .diplo-ribbon-outer::after { width: 0.375em; max-width: 0.2083333333rem; }`,
    `.${SIZED_CLASS} .diplo-ribbon__front-banner { fxs-border-image-tint: var(--player-color-primary); }`,
    `.${SIZED_CLASS} .diplo-ribbon__front-banner-overlay { opacity: 0.75; }`,
    `.${SIZED_CLASS} .diplo-ribbon__yields .yield-label > img { width: 1rem; height: 1rem; }`,
    `.${SIZED_CLASS} .diplo-ribbon__yields .yield-value { min-width: 1.75rem; text-align: right; letter-spacing: 0.02em; }`,
    `.${SIZED_CLASS} .diplo-ribbon__bg-container { width: calc(${CONTENT_WIDTH} - ${CARD_GAP}) !important; left: calc(${CARD_GAP} / 2) !important; }`,
    ...Object.entries(ROW_COLORS).map(([type, color]) => `.${SIZED_CLASS} .${ROW_TYPE_PREFIX}${type} .yield-value { color: ${color}; }`),
    ...['diplo-ribbon__yields', 'diplo-ribbon__bottom-spacer', 'diplo-ribbon__bg-container']
      .map((part) => `.${SIZED_CLASS} .${OWN_CARD_CLASS}.show-on-hover .${part} { display: flex; }`),
    `.${SIZED_CLASS} .${OWN_CARD_CLASS} .diplo-ribbon__yields { height: auto !important; min-height: 0 !important; max-height: 100rem !important; }`,
    `.${SIZED_CLASS} .${BEST_CLASS} { background-color: ${HIGHLIGHT.best}; font-weight: 900; ${ROW_SHADOW} }`,
    `.${SIZED_CLASS} .${BEST_CLASS} img { filter: drop-shadow(0 0.0555555556rem 0.1111111111rem black); }`,
    `.${SIZED_CLASS} .${NEGATIVE_CLASS} .yield-value { color: ${HIGHLIGHT.negative} !important; ${ROW_SHADOW} }`,
    `.${HIDDEN_CLASS} { display: none !important; }`,
    `.${FAITH_CLASS} { background-image: none !important; width: auto !important; height: 2.1rem !important; align-self: center; display: flex; flex-direction: row; justify-content: center; align-items: center; pointer-events: none !important; }`,
    `.${FAITH_CLASS} .${FAITH_ICON_CLASS} { background-size: contain; background-repeat: no-repeat; background-position: center; pointer-events: auto; }`,
    `.${FAITH_CLASS} .${FAITH_ACTION_CLASS}:hover { filter: brightness(1.3); }`,
    `.${FAITH_CLASS} .${FAITH_KIND_PREFIX}pantheon { filter: fxs-color-tint(${HIGHLIGHT.pantheon}); }`,
    `.${FAITH_CLASS} .${FAITH_KIND_PREFIX}pantheon.${FAITH_ACTION_CLASS}:hover { filter: fxs-color-tint(${HIGHLIGHT.pantheonHover}); }`,
    ...celebrationRules(),
    ...portraitGlow('.' + AT_WAR_CLASS, HIGHLIGHT.atWar),
    ...HIGHLIGHT.alliances.map((color, i) => hexBorder('.' + ALLY_CLASS_PREFIX + i, color))
  ].join('\n'));
}

/** Size the stat area once, measured in the Yields view from a leader card (not the Observer's own). */
function lockCardSize(panel, measure) {
  panel.classList.add(SIZED_CLASS);
  if (statHeightPx === 0 && measure) {
    const other = [...panel.querySelectorAll('.diplo-ribbon__yields')]
      .find((el) => parseInt(el.getAttribute('data-leader-id'), 10) !== GameContext.localPlayerID);
    statHeightPx = other?.offsetHeight ?? 0;
  }
  writeStyle();
}

// ============================ Details ============================

/** Details hidden: the game's "Always Show Ribbon Yields" option is off. */
function isDetailsHidden() {
  try { return !UI.getOption(...DETAILS_OPTION); } catch (e) { return false; }
}

/** Switch the game's option (saved like the Options screen does); the ribbon rebuilds on DETAILS_CHANGED_EVENT. */
function setDetailsHidden(hidden) {
  try {
    UI.setOption(...DETAILS_OPTION, hidden ? 0 : 1);
    Configuration.getUser().saveCheckpoint();
  } catch (e) { /* option unavailable */ }
  window.dispatchEvent(new CustomEvent(DETAILS_CHANGED_EVENT));
}

/** The Observer's own card (its view buttons) stays open whatever the option. */
function markOwnCard(card) {
  card?.classList.add(OWN_CARD_CLASS);
}

/** Hide or show a ribbon panel (used for the leader panel's ribbon). */
function setRibbonHidden(panel, hidden) {
  if (hidden) writeStyle();
  panel.classList.toggle(HIDDEN_CLASS, hidden);
}

// ============================ Highlights ============================

const warColorByPair = new Map();
const pairKey = ([a, b]) => `${a}-${b}`;

/** Current wars as [{ a, b, color }]; a pair keeps its pip colour until peace. */
function coloredWars(pairs) {
  const live = new Set(pairs.map(pairKey));
  for (const key of [...warColorByPair.keys()]) if (!live.has(key)) warColorByPair.delete(key);
  for (const pair of pairs) {
    const key = pairKey(pair);
    if (warColorByPair.has(key)) continue;
    const used = new Set(warColorByPair.values());
    const free = HIGHLIGHT.wars.findIndex((_, i) => !used.has(i));
    warColorByPair.set(key, free >= 0 ? free : warColorByPair.size % HIGHLIGHT.wars.length);
  }
  return pairs.map((pair) => ({ a: pair[0], b: pair[1], color: warColorByPair.get(pairKey(pair)) }));
}

/** Alliance colour index per leader id (alliances in a stable order). */
function allianceColors(alliances) {
  const colors = new Map();
  alliances.forEach((group, i) => { for (const id of group) colors.set(id, i % HIGHLIGHT.alliances.length); });
  return colors;
}

function warPips(cardEl, wars, playerId) {
  cardEl.querySelector('.' + PIPS_CLASS)?.remove();
  if (wars.length === 0) return;
  const pips = document.createElement('div');
  pips.classList.add(PIPS_CLASS);
  pips.style.cssText = 'display: flex; flex-direction: row; justify-content: center; margin-top: 0.2rem;';
  for (const war of wars) {
    const enemy = Players.get(war.a === playerId ? war.b : war.a);
    const pip = document.createElement('div');
    pip.classList.add('pointer-events-auto');
    pip.style.cssText = `width: 0.6rem; height: 0.6rem; margin: 0 0.1rem; border-radius: 0.3rem; background-color: ${HIGHLIGHT.wars[war.color]}; border: 0.0555555556rem solid #000000;`;
    if (enemy) pip.setAttribute('data-tooltip-content', Locale.compose('LOC_ZOM_OBSERVER_AT_WAR_WITH', enemy.name));
    pips.appendChild(pip);
  }
  (cardEl.querySelector('.diplo-ribbon__relation-container') ?? cardEl).appendChild(pips);
}

/** Alliance, war and celebration highlights on every leader card; cards whose state is unchanged are left alone. */
function markCards(panel, isCelebrating) {
  if (!panel) return;
  const { wars: pairs, alliances } = diplomacySnapshot();
  const wars = coloredWars(pairs);
  const allyColor = allianceColors(alliances);
  for (const cardEl of panel.querySelectorAll('.diplo-ribbon-outer[data-player-id]')) {
    const id = parseInt(cardEl.getAttribute('data-player-id'), 10);
    const player = Players.get(id);
    const own = wars.filter((w) => w.a === id || w.b === id).sort((x, y) => x.color - y.color);
    const celebrating = !!player && isCelebrating(player);
    const ally = allyColor.get(id);
    const signature = `${celebrating}|${ally ?? ''}|${own.map((w) => `${w.a}-${w.b}:${w.color}`).join(',')}`;
    if (cardEl.getAttribute(SIGNATURE_ATTR) === signature) continue;
    cardEl.setAttribute(SIGNATURE_ATTR, signature);
    cardEl.classList.toggle(CELEBRATING_CLASS, celebrating);
    cardEl.classList.toggle(AT_WAR_CLASS, own.length > 0);
    HIGHLIGHT.alliances.forEach((_, i) => cardEl.classList.toggle(ALLY_CLASS_PREFIX + i, ally === i));
    warPips(cardEl, own, id);
  }
}

// ============================ Faith ============================

/**
 * Every card's religion slot shows badgesFor(player) side by side ({ kind, tooltip, icon });
 * actions[kind], when given, runs on a click. Cards whose badges are unchanged are left alone.
 */
function markFaith(panel, badgesFor, actions = {}) {
  if (!panel) return;
  for (const cardEl of panel.querySelectorAll('.diplo-ribbon-outer[data-player-id]')) {
    const slot = cardEl.querySelector('.diplo-ribbon__religion');
    const player = Players.get(parseInt(cardEl.getAttribute('data-player-id'), 10));
    if (!slot || !player) continue;
    const badges = badgesFor(player);
    const signature = badges.map((b) => `${b.kind}|${b.icon}|${b.tooltip}`).join(';');
    if (slot.classList.contains(FAITH_CLASS) && slot.getAttribute(FAITH_ATTR) === signature) continue;
    slot.classList.add(FAITH_CLASS);
    slot.setAttribute(FAITH_ATTR, signature);
    slot.innerHTML = '';
    const size = `${FAITH_ICON_REM[Math.min(badges.length, FAITH_ICON_REM.length) - 1] ?? FAITH_ICON_REM[0]}rem`;
    for (const badge of badges) {
      const icon = document.createElement('div');
      icon.classList.add(FAITH_ICON_CLASS, FAITH_KIND_PREFIX + badge.kind);
      Object.assign(icon.style, { width: size, height: size, backgroundImage: `url('${badge.icon}')` });
      icon.setAttribute('data-tooltip-content', badge.tooltip);
      const action = actions[badge.kind];
      if (action) {
        icon.classList.add(FAITH_ACTION_CLASS);
        icon.addEventListener('click', (ev) => { ev.stopPropagation(); action(); });
      }
      slot.appendChild(icon);
    }
  }
}

// ============================ Best in category ============================

/**
 * Per-row marks on every card: the highest leader in that row (type -> Set of
 * ids; null clears), negative numbers, and the body font (lining digits).
 */
function markRows(panel, best) {
  if (!panel) return;
  for (const row of panel.querySelectorAll('.diplo-ribbon__yields .yield-item')) {
    const id = parseInt(ancestorWithClass(row, 'diplo-ribbon__yields')?.getAttribute('data-leader-id') ?? '', 10);
    const typeClass = [...row.classList].find((c) => c.startsWith(ROW_TYPE_PREFIX));
    const type = typeClass?.slice(ROW_TYPE_PREFIX.length);
    row.classList.replace('font-title-base', 'font-body-sm');
    row.classList.toggle(BEST_CLASS, !!best && !!type && !!best.get(type)?.has(id));
    row.classList.toggle(NEGATIVE_CLASS, (row.querySelector('.yield-value')?.textContent ?? '').trim().startsWith('-'));
  }
}

export { DETAILS_CHANGED_EVENT, isDetailsHidden, lockCardSize, markCards, markFaith, markOwnCard, markRows, setDetailsHidden, setRibbonHidden };
