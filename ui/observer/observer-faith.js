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
 * Each leader's pantheon, religion and ideology in every Age, for the ribbon,
 * the pantheon overview and the Religion screen. After Antiquity pantheons are
 * read from the Multiplayer Balance Mod's carried narrative tags, when present.
 */
const CARRIED_PANTHEON_TAG = /^MBM_NARRATIVE_TAG_PANTHEON_(\d+)$/;
let carriedTags = null;   // [{ tag, belief }] for every carried-pantheon narrative tag (read once)

function carriedPantheonTags() {
  if (!carriedTags) {
    carriedTags = [];
    for (const row of GameInfo.NarrativeTags ?? []) {
      const n = CARRIED_PANTHEON_TAG.exec(row.NarrativeTagType ?? '')?.[1];
      if (n) carriedTags.push({ tag: row.NarrativeTagType, belief: `PANTHEON_BONUS_${n}` });
    }
  }
  return carriedTags;
}

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
  return carriedPantheonTags().filter(({ tag }) => narrativeTagPoints(player, tag) > 0).map(({ belief }) => belief);
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
  const entries = list.map((p) => `[B]${Locale.compose(p.name)}[/B][N]${Locale.compose(p.description)}`).join('[N][N]');
  const tooltip = `${Locale.compose('LOC_BELIEF_CLASS_PANTHEON_NAME')}[N][N]${entries}`;
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

const badgeOf = (make, player) => { try { return make(player); } catch (e) { return null; } };

/**
 * The leader's faith badges as { kind, tooltip, icon }: the religion, else the
 * pantheon (still listed on the Religion screen once a religion is founded),
 * plus the ideology, which the base card would show instead of the religion.
 */
function faithBadges(player) {
  const religion = badgeOf(religionBadge, player);
  return [religion ?? badgeOf(pantheonBadge, player), badgeOf(ideologyBadge, player)].filter(Boolean);
}

export { faithBadges, pantheons };
