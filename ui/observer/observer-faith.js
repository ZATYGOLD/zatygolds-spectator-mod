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
 * Zatygold's Spectator - leaders' faith (in-game scope).
 *
 * What each leader holds - pantheon, religion, ideology - in every Age, for
 * the ribbon cards (observer-ribbon-style.js) and the pantheon overview
 * (observer-overview.js).
 *
 * Pantheons: the game keeps them in Antiquity only. The Multiplayer Balance
 * Mod keeps them for the whole game: founding PANTHEON_BONUS_<n> grants the
 * narrative tag MBM_NARRATIVE_TAG_PANTHEON_<n>, whose effects it re-attaches
 * in every later Age. Pantheon beliefs exist in Antiquity's data only; their
 * names, descriptions and icons load in every Age.
 */
const CARRIED_PANTHEON_TAG = /^MBM_NARRATIVE_TAG_PANTHEON_(\d+)$/;
const carriedPantheonBelief = (n) => `PANTHEON_BONUS_${n}`;

/** A player's points in a narrative tag (Identity takes the type name, as for attribute points). */
function narrativeTagPoints(player, tag) {
  const identity = player.Identity;
  if (typeof identity?.getNarrativeTagPoints !== 'function') return 0;
  for (const arg of [tag, Database.makeHash(tag)]) {
    try {
      const points = identity.getNarrativeTagPoints(arg);
      if (typeof points === 'number') return points;
    } catch (e) { /* try the hash */ }
  }
  return 0;
}

/** The player's pantheon belief types: live in Antiquity, then carried by their narrative tags. */
function pantheonTypes(player) {
  const live = (player.Religion?.getPantheons?.() ?? []).map((type) => GameInfo.Beliefs.lookup(type)?.BeliefType).filter(Boolean);
  if (live.length) return live;
  const carried = [];
  for (const row of GameInfo.NarrativeTags ?? []) {
    const n = CARRIED_PANTHEON_TAG.exec(row.NarrativeTagType ?? '')?.[1];
    if (n && narrativeTagPoints(player, row.NarrativeTagType) > 0) carried.push(carriedPantheonBelief(n));
  }
  return carried;
}

/** The player's pantheons in any Age: { type, name, description } (text keys). */
function pantheons(player) {
  try {
    return pantheonTypes(player).map((type) => {
      const def = GameInfo.Beliefs.lookup(type);
      return { type, name: def?.Name ?? `LOC_${type}_NAME`, description: def?.Description ?? `LOC_${type}_DESCRIPTION` };
    });
  } catch (e) { return []; }
}

// ============================ Badges ============================

/** The pantheon badge's tooltip: every pantheon's name and effect, as the pantheon screen lists them. */
function pantheonBadge(player) {
  const list = pantheons(player);
  if (!list.length) return null;
  const tooltip = list.map((p) => `[B]${Locale.compose(p.name)}[/B][N]${Locale.compose(p.description)}`).join('[N][N]');
  return { kind: 'pantheon', tooltip, icon: UI.getIconURL(list[0].type, 'PANTHEONS') };
}

function religionBadge(player) {
  const religion = player.Religion;
  const def = GameInfo.Religions.lookup(religion?.getReligionType?.());
  if (!def || religion.hasCreatedReligion?.() === false) return null;
  return { kind: 'religion', tooltip: Locale.compose(religion.getReligionName()), icon: UI.getIcon(def.ReligionType, 'PLAYER') };
}

function ideologyBadge(player) {
  const def = GameInfo.Ideologies.lookup(player.Culture?.getChosenIdeology?.());
  return def ? { kind: 'ideology', tooltip: Locale.compose(def.Name), icon: UI.getIcon(def.IdeologyType) } : null;
}

/**
 * Everything the leader holds, adding up over the Ages instead of replacing
 * each other (the base card shows only the religion in Exploration and the
 * ideology in Modern): pantheon, religion, ideology, as { kind, tooltip, icon }.
 */
function faithBadges(player) {
  return [pantheonBadge, religionBadge, ideologyBadge].map((badge) => {
    try { return badge(player); } catch (e) { return null; }
  }).filter(Boolean);
}

export { faithBadges, pantheons };
