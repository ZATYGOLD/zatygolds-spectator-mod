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
 * Zatygold's Spectator - Battles timeline (in-game scope).
 *
 * The Military view's Battles tab (observer-graph-military.js) of the battle
 * log (observer-battle-log.js): each leader's conflicts on one bar - a pin
 * leading with a leader, then a city-state, then an independent power, and
 * by razing, capture, loss, siege, battle, skirmish and pillage (by it or on
 * its land), its hover a panel for each with the turns each went on; the
 * notches coloured while battles, sieges and skirmishes go on; a dashed
 * arc joining each to what it followed from (a skirmish to the battle it
 * became, the engagement to a siege, the siege to a capture or loss, that to
 * the razing). Sieges, battles, skirmishes and pillage are the Total -
 * razings, captures and losses, their outcomes, apart on its hover (pillage
 * together) - and the card its Nemesis, the player it fought most, leaders
 * before city-states and independent powers (every other opponent on hover);
 * an independent or city-state shows its type icon in its own colour.
 */
import { BATTLE_CATEGORIES } from './observer-battle-log.js';
import { byKindThenCount, leaderIcon, leaderRow, leaderTint, opponentName, playerKind, playerKindColor } from './observer-graph-parts.js';
import { rankedCells, sumBy } from './observer-graph-timelines.js';
import { turnText } from './observer-timeline.js';

const CATEGORY = Object.fromEntries(BATTLE_CATEGORIES.map((c, i) => [c.id, i]));
const CITY_ICON = 'url(blp:Yield_Cities)';
const OPPONENTS = 1;   // on the card
/** Each kind's icon on the Total's hover: the game's razed, fortified city, war, combat, pillage and damaged icons. */
const CATEGORY_ICONS = {
  razed: 'url("blp:icon_razed.png")',
  captured: CITY_ICON,
  lost: CITY_ICON,
  siege: 'url(blp:fi_city_fortified_64)',
  battle: 'url(blp:fi_war_64)',
  skirmish: 'url(blp:fi_nar_rew_combat_64)',
  escalated: 'url(blp:fi_nar_rew_combat_64)',
  pillaged: 'url("blp:Action_Pillage.png")',
  raided: 'url("blp:Action_Pillage.png")'   // as pillaged, told apart by its pin colour
};
const categoryIcon = (category) => CATEGORY_ICONS[BATTLE_CATEGORIES[category].id];
const TINTED = [CATEGORY.captured, CATEGORY.lost];   // the same icon, told apart in the Total's hover by their colours
/** A kind's Total: Pillaged holds every tile pillaged, by the leader and on its land. */
const totalOf = (entry, category) => (entry?.totals[category] ?? 0) + (category === CATEGORY.pillaged ? entry?.totals[CATEGORY.raided] ?? 0 : 0);

const isCounted = (category) => !!BATTLE_CATEGORIES[category]?.counted;
const isEngagement = (category) => category === CATEGORY.battle || category === CATEGORY.skirmish || category === CATEGORY.escalated;
const isConstructible = (category) => category === CATEGORY.pillaged || category === CATEGORY.raided;

/** The other player in an engagement, a settlement, or the pillaged constructible. */
function iconOf(source) {
  if (isEngagement(source.category)) return leaderIcon(source.other);
  if (source.settlement) return source.category === CATEGORY.razed ? categoryIcon(source.category) : CITY_ICON;
  return UI.getIconCSS(source.type);
}

/** A pin's icon: as iconOf, but pillage shows its kind (a pin may hold several tiles). */
const pinIconOf = (source) => (isConstructible(source.category) ? categoryIcon(source.category) : iconOf(source));

/** A pillage row's head: the other player (who pillaged, or whose tile it was). */
const pillageHead = ([source]) => ({ icon: leaderIcon(source.other), tint: leaderTint(source.other), name: opponentName(source.other) });

function nameOf(source) {
  if (isEngagement(source.category)) return opponentName(source.other);
  if (source.settlement) return Locale.compose(source.type);
  return Locale.compose(GameInfo.Constructibles.lookup(source.type)?.Name ?? '');
}

/** Who did it, by the side the leader was on: a besieger or razer, the leader itself or the other player. */
const DOERS = { besieging: 'self', taking: 'self', razing: 'self', besieged: 'other', taken: 'other', razed: 'other' };
const BY_KEYS = {
  [CATEGORY.siege]: 'LOC_ZOM_GRAPH_BESIEGED_BY',
  [CATEGORY.captured]: 'LOC_ZOM_GRAPH_CAPTURED_BY',
  [CATEGORY.lost]: 'LOC_ZOM_GRAPH_CAPTURED_BY',
  [CATEGORY.razed]: 'LOC_ZOM_GRAPH_RAZED_BY'
};

/** The turns it went on: "Turn 12", "Turns 12–15". */
const turnsOf = (source) => turnText([source.from, source.until ?? source.from]);

/**
 * What happened, its section naming the kind: an engagement's turns and tally
 * ("Turns 12–15 · Attacks 4 · Pillage 2"), a siege's besieger and turns, else
 * who captured or razed the settlement ("Captured By <player>").
 */
function battleDetail(source) {
  if (isEngagement(source.category)) {
    return [turnsOf(source), ...[['LOC_ZOM_GRAPH_ATTACKS_COUNT', source.attacks], ['LOC_ZOM_GRAPH_PILLAGE_COUNT', source.pillage]]
      .filter(([, n]) => n > 0).map(([key, n]) => Locale.compose(key, n))].join(' · ');
  }
  const by = source.by >= 0 ? Locale.compose(BY_KEYS[source.category], opponentName(source.by)) : '';
  return source.category === CATEGORY.siege ? [by, turnsOf(source)].filter(Boolean).join(' · ') : by;
}

/** The notches: each siege (orange), battle (red) and skirmish (blue) from its start to its last turn, sharing a notch in that order and fading into the next. */
const LAYERS = { [CATEGORY.siege]: 0, [CATEGORY.battle]: 1, [CATEGORY.skirmish]: 2, [CATEGORY.escalated]: 2 };
const conflictBands = (events, { position }) => events.filter((e) => e.until && e.category in LAYERS)
  .map((e) => ({ from: position(e.age, e.progress), to: position(e.until.age, e.until.progress), color: BATTLE_CATEGORIES[e.category].color, layer: LAYERS[e.category], smooth: true }));

/** Each event joined to the one it follows from (a skirmish and the battle it became, a siege, capture and razing): [[from, to]]. */
function chainedPairs(events) {
  const byId = new Map(events.map((e) => [e.id, e]));
  return events.filter((e) => byId.has(e.after)).map((e) => [byId.get(e.after), e]);
}

/** The card's hover: its Nemesis (the player on the card), then every other opponent. */
const groupsOf = (rows) => [
  { title: Locale.compose('LOC_ZOM_GRAPH_NEMESIS'), rows: rows.slice(0, OPPONENTS) },
  { title: Locale.compose('LOC_ZOM_GRAPH_OPPONENTS'), rows: rows.slice(OPPONENTS) }
];

const BATTLES_SUBJECT = {
  looks: { battles: { color: '#e0705a', background: 'bg_victory_military' } },
  categories: BATTLE_CATEGORIES,
  priority: BATTLE_CATEGORIES.map((c, i) => (i === CATEGORY.skirmish ? [i, CATEGORY.escalated] : i)).filter((p) => p !== CATEGORY.escalated),   // a skirmish that became a battle ranks as a skirmish
  pinIcon: pinIconOf,
  icon: iconOf,
  iconTint: (source) => (isEngagement(source.category) ? leaderTint(source.other) : null),
  dotColor: (source) => (source.other >= 0 ? playerKindColor(source.other) : null),
  name: nameOf,
  detail: battleDetail,
  sourceOf: (event) => ({ settlement: event.settlement, other: event.other, by: DOERS[event.side] === 'self' ? event.playerId : event.other, from: event.turn, until: event.until?.turn }),
  sumFields: ['attacks', 'pillage'],   // one row per opponent and kind, its engagements' attacks and pillage together
  sourceOrder: (a, b) => playerKind(a.other) - playerKind(b.other),   // a pin leads with a leader, then a city-state, then an independent power
  sections: [
    { title: 'LOC_ZOM_GRAPH_RAZED', categories: [CATEGORY.razed] },
    { title: 'LOC_ZOM_GRAPH_CAPTURED', categories: [CATEGORY.captured] },
    { title: 'LOC_ZOM_GRAPH_SETTLEMENTS_LOST', categories: [CATEGORY.lost] },
    { title: 'LOC_ZOM_GRAPH_SIEGE_LIST', categories: [CATEGORY.siege] },
    { title: 'LOC_ZOM_GRAPH_BATTLE_LIST', categories: [CATEGORY.battle] },
    { title: 'LOC_ZOM_GRAPH_SKIRMISH_LIST', categories: [CATEGORY.skirmish, CATEGORY.escalated] },
    { title: 'LOC_ZOM_GRAPH_PILLAGED', categories: [CATEGORY.pillaged], compact: true, by: (s) => s.other, head: pillageHead },
    { title: 'LOC_ZOM_GRAPH_RAIDED', categories: [CATEGORY.raided], compact: true, by: (s) => s.other, head: pillageHead }
  ],
  links: chainedPairs,
  bands: conflictBands,
  sliceEvents: (events) => events
    .filter((e) => !(e.category === CATEGORY.escalated && events.some((b) => b.link === e.link && b.category === CATEGORY.battle)))   // the battle it became, in the same pin, tells it
    .map((e) => (e.category === CATEGORY.escalated ? { ...e, category: CATEGORY.skirmish } : e)),   // one row with the opponent's other skirmishes
  value: (playerId, { events }) => events.filter((e) => isCounted(e.category)).reduce((sum, e) => sum + e.count, 0),
  totalGroups: (entry) => {
    const row = (i) => ({ icon: categoryIcon(i), tint: TINTED.includes(i) ? BATTLE_CATEGORIES[i].color : null, label: Locale.compose(BATTLE_CATEGORIES[i].label), value: totalOf(entry, i) });
    const kinds = (keep) => BATTLE_CATEGORIES.flatMap((c, i) => (keep(c) && i !== CATEGORY.raided ? [row(i)] : []));
    return [{ title: Locale.compose('LOC_ZOM_GRAPH_BATTLES'), rows: kinds((c) => c.counted) }, { title: Locale.compose('LOC_ZOM_GRAPH_OUTCOMES'), rows: kinds((c) => c.outcome) }];
  },
  card: (playerId, { events }) => {
    const byOpponent = sumBy(events.filter((e) => isCounted(e.category) && e.other >= 0), (e) => e.other);
    if (!byOpponent.size) return { cells: [{ icon: categoryIcon(CATEGORY.battle), count: 0 }], groups: [[{ icon: categoryIcon(CATEGORY.battle), label: Locale.compose('LOC_ZOM_GRAPH_NONE_YET'), value: 0 }]] };
    return {
      cells: rankedCells(byOpponent, leaderIcon, { max: OPPONENTS, tint: leaderTint, order: byKindThenCount }),
      groups: groupsOf([...byOpponent].sort(byKindThenCount).map(([id, count]) => leaderRow(id, count)))
    };
  },
  tieBreak: (entry) => entry.totals[CATEGORY.battle]
};

export { BATTLES_SUBJECT };
