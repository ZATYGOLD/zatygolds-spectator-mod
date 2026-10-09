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
 * Zatygold's Spectator - Wars timeline (in-game scope).
 *
 * The Military view's Wars tab (observer-graph-military.js) of the war log
 * (observer-war-log.js): each leader's wars on one bar - its notches in the
 * war's colour while it lasts (red for aggression, the leader declared it;
 * yellow for defense, declared on it; grey is peace), a pin of the enemy where war was declared and
 * peace made (green), each naming who attacked whom ("Declared On Augustus") -
 * the turns at war as the Total (with its wars on hover) and a card of the
 * leader it was at war with longest (each, when tied; on hover each war: who
 * attacked whom, its turns and peace). A war goes on into a new Age until peace.
 */
import { currentAgeChronology } from '../shared/zom-util.js';
import { leaderIcon, leaderName } from './observer-graph-parts.js';
import { yieldHistory } from './observer-history.js';
import { PEACE, WAR_CATEGORIES } from './observer-war-log.js';

const WAR_ICON = 'url(blp:fi_war_64)';
const byTime = (a, b) => a.age - b.age || a.turn - b.turn;

/**
 * Each war of the leader: [{ other, start, end }] (end the peace, null while
 * it goes on), going on into later Ages until peace.
 */
function wars(events) {
  const open = new Map();
  const all = [];
  for (const e of [...events].sort(byTime)) {
    const war = open.get(e.other);
    if (e.category === PEACE) {
      if (war) war.end = e;
      open.delete(e.other);
    } else if (!war) {
      const started = { other: e.other, start: e, end: null };
      open.set(e.other, started);
      all.push(started);
    }
  }
  return all;
}

/** An Age's first and last recorded turns: [first, last], else null. */
function ageTurns(age) {
  const turns = yieldHistory().filter((s) => s.age === age).map((s) => s.turn);
  return turns.length ? [Math.min(...turns), Math.max(...turns)] : null;
}

/**
 * A war's turns in each Age it spans up to `lastAge` (the view's):
 * [{ age, from, to }] (to exclusive: the peace, now, or the Age's end).
 */
function warSpans(war, lastAge = currentAgeChronology()) {
  const current = currentAgeChronology();
  const endAge = Math.min(war.end?.age ?? current, lastAge);
  const ended = war.end && war.end.age === endAge;
  const spans = [];
  for (let age = war.start.age; age <= endAge; age++) {
    const [first, last] = ageTurns(age) ?? [war.start.turn, war.start.turn];
    const from = age === war.start.age ? war.start.turn : first;
    const to = age < endAge ? last + 1 : (ended ? war.end.turn : (age === current ? Game.turn : last + 1));
    spans.push({ age, from, to: Math.max(to, from + 1) });
  }
  return spans;
}
const warTurns = (war, lastAge) => warSpans(war, lastAge).reduce((sum, s) => sum + s.to - s.from, 0);

/** Turns at war with anyone: the union of every war's turns. */
function turnsAtWar(list, lastAge) {
  const turns = new Set();
  for (const war of list) for (const { age, from, to } of warSpans(war, lastAge)) for (let t = from; t < to; t++) turns.add(`${age}:${t}`);
  return turns.size;
}

const categoryRow = (category, value) => ({ color: WAR_CATEGORIES[category].color, label: Locale.compose(WAR_CATEGORIES[category].label), value });

/** Who attacked whom, from the leader's side: "Declared On Augustus", "Attacked By Augustus". */
const against = (category, other) => Locale.compose(WAR_CATEGORIES[category]?.against ?? '', leaderName(other));

/** A war's row: the enemy, who attacked whom, its turns and peace if made ("Turns 12–20 · Peace Made"), and its length. */
function warRow(war, lastAge) {
  const spans = warSpans(war, lastAge);
  const turns = Locale.compose('LOC_ZOM_GRAPH_TURNS', war.start.turn, spans[spans.length - 1].to);
  return {
    icon: leaderIcon(war.other),
    label: against(war.start.category, war.other),
    detail: war.end ? Locale.compose('LOC_ZOM_GRAPH_UNIT_SOURCE', turns, Locale.compose(WAR_CATEGORIES[PEACE].label)) : turns,
    value: warTurns(war, lastAge)
  };
}

const WARS_SUBJECT = {
  looks: { wars: { color: '#d9534f', background: 'bg_victory_military' } },
  categories: WAR_CATEGORIES,
  pinCount: false,
  pinIcon: (source) => leaderIcon(source.other),
  icon: (source) => leaderIcon(source.other),
  name: (source) => against(source.category, source.other),
  detail: (source) => Locale.compose(WAR_CATEGORIES[source.category]?.label ?? ''),
  sourceOf: (event) => ({ other: event.other }),
  bands: (events, { position, now }) => {
    const list = wars(events).sort((a, b) => a.start.category - b.start.category);
    const peace = list.filter((war) => war.end).map((war) => { const at = position(war.end.age, war.end.progress); return { from: at, to: at, color: WAR_CATEGORIES[PEACE].color }; });
    return [...peace, ...list.map((war) => ({   // the peace notch first, in green
      from: position(war.start.age, war.start.progress),
      to: war.end ? position(war.end.age, war.end.progress) : now ?? 100,   // else to the bar's end
      color: WAR_CATEGORIES[war.start.category].color
    }))];
  },
  value: (playerId, { events, lastAge }) => turnsAtWar(wars(events), lastAge),
  totalGroups: (entry) => [
    { title: Locale.compose('LOC_ZOM_GRAPH_WARS'), rows: [{ icon: WAR_ICON, label: Locale.compose('LOC_ZOM_GRAPH_TURNS_AT_WAR'), value: entry?.value ?? 0 }] },
    { title: Locale.compose('LOC_ZOM_GRAPH_DIPLOMACY'), rows: WAR_CATEGORIES.flatMap((c, i) => (c.id === 'ongoing' && !entry?.totals[i] ? [] : [categoryRow(i, entry?.totals[i] ?? 0)])) }
  ],
  card: (playerId, { events, lastAge }) => {
    const list = wars(events);
    const byEnemy = new Map();
    for (const war of list) byEnemy.set(war.other, (byEnemy.get(war.other) ?? 0) + warTurns(war, lastAge));
    if (!list.length) return { wars: 0, cells: [{ icon: WAR_ICON, count: 0 }], groups: [[{ icon: WAR_ICON, label: Locale.compose('LOC_ZOM_GRAPH_NONE_YET'), value: 0 }]] };
    return {
      wars: list.length,
      cells: [...byEnemy].filter(([, turns]) => turns === Math.max(...byEnemy.values())).map(([id, turns]) => ({ icon: leaderIcon(id), count: turns })),
      groups: [[...byEnemy].sort((a, b) => b[1] - a[1]).flatMap(([id]) => list.filter((w) => w.other === id).map((w) => warRow(w, lastAge)))]
    };
  },
  tieBreak: (entry) => entry.card.wars
};

export { WARS_SUBJECT };
