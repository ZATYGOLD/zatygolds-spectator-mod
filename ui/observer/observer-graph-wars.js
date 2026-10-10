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
 * (observer-war-log.js): each leader's wars, the notches coloured while each
 * goes on (aggression red, defense yellow; a peace made green), a pin of the
 * enemy where each began and ended naming who attacked whom; its turns at war
 * as the Total and the enemy it was at war with longest on the card.
 */
import { currentAgeChronology } from '../shared/zom-util.js';
import { byTime } from './observer-event-log.js';
import { detailText, leaderIcon, leaderName } from './observer-graph-parts.js';
import { emptyCard } from './observer-graph-timelines.js';
import { yieldHistory } from './observer-history.js';
import { PEACE, WAR_CATEGORIES } from './observer-war-log.js';

const WAR_ICON = 'url(blp:fi_war_64)';
/** The order wars share a notch in, the first taking most: aggression, defense, a war already going (a peace made fills its own). */
const LAYER_ORDER = ['declared', 'declaredOn', 'ongoing'];
const LAYERS = WAR_CATEGORIES.map((c) => LAYER_ORDER.indexOf(c.id));
const WAR_PARTS = 3;   // a shared notch in thirds

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

let ageSpans = { samples: -1, byAge: new Map() };   // each Age's recorded turns, until the history grows
/** An Age's first and last recorded turns: [first, last], else null. */
function ageTurns(age) {
  const history = yieldHistory();
  if (ageSpans.samples !== history.length) {
    const byAge = new Map();
    for (const { age: a, turn } of history) {
      const span = byAge.get(a);
      byAge.set(a, span ? [Math.min(span[0], turn), Math.max(span[1], turn)] : [turn, turn]);
    }
    ageSpans = { samples: history.length, byAge };
  }
  return ageSpans.byAge.get(age) ?? null;
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

/** Who attacked whom, from the leader's side: "Declared on Augustus", "Attacked by Augustus". */
const against = (category, other) => Locale.compose(WAR_CATEGORIES[category]?.against ?? '', leaderName(other));

/** A war's row: the enemy, who attacked whom, its turns and peace if made ("Turns 12–20 · Peace Made"), and its length. */
function warRow(war, lastAge) {
  const spans = warSpans(war, lastAge);
  const turns = Locale.compose('LOC_ZOM_GRAPH_TURNS', war.start.turn, spans[spans.length - 1].to);
  return {
    icon: leaderIcon(war.other),
    label: against(war.start.category, war.other),
    detail: detailText(turns, war.end ? Locale.compose(WAR_CATEGORIES[PEACE].label) : ''),
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
    const band = (category, from, to) => ({ from, to, color: WAR_CATEGORIES[category].color, layer: LAYERS[category], smooth: true, parts: WAR_PARTS });
    return wars(events).flatMap((war) => {
      const end = war.end && position(war.end.age, war.end.progress);
      return [band(war.start.category, position(war.start.age, war.start.progress), end ?? now ?? 100), ...(war.end ? [{ ...band(PEACE, end, end), solo: true }] : [])];   // else to the bar's end; peace made fills its notch
    });
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
    if (!list.length) return { wars: 0, ...emptyCard(WAR_ICON) };
    const longest = Math.max(...byEnemy.values());
    return {
      wars: list.length,
      cells: [...byEnemy].filter(([, turns]) => turns === longest).map(([id, turns]) => ({ icon: leaderIcon(id), count: turns })),
      groups: [[...byEnemy].sort((a, b) => b[1] - a[1]).flatMap(([id]) => list.filter((w) => w.other === id).map((w) => warRow(w, lastAge)))]
    };
  },
  tieBreak: (entry) => entry.card.wars
};

export { WARS_SUBJECT };
