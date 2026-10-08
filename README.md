# Zatygold's Spectator

A playable **Spectator** for **Sid Meier's Civilization VII**, single player and
multiplayer. Current version: **1.1.0**.

Pick **Spectator** as your leader to watch the game as a real player with no
empire: whole-map vision, every leader's stats, screens and yield graphs, the
normal HUD and End Turn, through every Age. You are never eliminated.

## Installation

1. Copy the mod folder into `…\Sid Meier's Civilization VII\Mods\`.
2. Enable **Zatygold's Spectator** in **Main Menu → Additional Content**.
3. In multiplayer, **every player must install and enable the mod**.

## Features

**Setup** — Single player: pick the Spectator leader; its civilization, **the
Observers**, follows. Multiplayer lobby: pick the leader or the civilization
(the other follows). The Spectator plays no mementos, the Observers are picked
at each Age transition, and computer players never become the Spectator.

**Playing** — Press **End Turn**, or turn on **Auto End Turn** from your ribbon
card. Your Founder is replaced by the hidden **Spectator's Eye**, which sees
the whole map and every unit.

**Ribbon** — Every living leader, with your card pinned at the right edge
(the arrows page the others). Other players never see the Spectator.
- Your card switches every card between **Yields**, **Research**,
  **Production** and **Victories**; the best value in each row is highlighted.
- Allies share a border colour, wars glow red (a pip per war), celebrations
  glow gold. Each card shows religion (or pantheon) and ideology; click a
  pantheon to compare every leader's.
- Left-click a leader for their **Perspective**; right-click to open
  diplomacy. Right-click your own portrait to hide or show details.

**Perspective** — See the game as a leader sees it: their fog of war, units,
settlements, met leaders, top-bar yields and empire screens. Click again to
return. It changes only what you see.

**Settlements** — Click any banner or city center for population, growth,
connections, warehouse yields, town focus and buildings. Town banners show
their focus; a city-state's icon names its suzerain bonus.

**Independents and city-states** — Type, suzerain and chosen bonus, and every
leader's relationship and befriending progress.

**Graphs** — Saved with the game, for the whole game or one Age:
- **Yields** — per-turn graphs of every leader's yields, each Age's turns
  counted from 1.
- **Units** — units each leader trained, lost and defeated, on a timeline of
  Age progress: pins by land combat, naval combat, civilian or commander (with
  the other player on hover), and a card per leader for each commander type.
- Both mark each crisis stage and, in Overall, where each Age starts.

**Screens** — Resources & Trade, Legacies, Government, Great Works, Religion
and the tech / civic trees can show any leader's view. Click any unit to
inspect it; hover another with a combat unit selected for an estimated combat
preview.

**Quiet** — Advisors, narrative events, diplomacy prompts and Age countdowns
are handled for you. The Spectator never appears in victories, rankings or
Age choices.

**Languages** — English and every language the game supports.

## How it works

- A Spectator leader and one Observers civilization per Age, defined like the
  game's own, with no abilities; defeat and Triumphs exclude the Spectator.
- The Eye is created when a map places the Spectator's start (hooked in
  `map-globals.js`, which every map imports, Earth and custom maps included).
- Base-game overrides are verbatim copies with changes marked `ZOM:`, loaded
  only in games with a Spectator. Everything else patches the UI at runtime.

## Known limits

- In multiplayer, a player on Random could still become the Spectator.
- The Eye shows as a generic ship, visible only to the Spectator.
- Combat previews between other players' units are estimates (the game only
  simulates your own attacks); promotions, abilities, policies, fortifying
  and rivers are not counted.

## Project structure

```
zatygolds-observer-mode.modinfo   # manifest
├─ art/                           # icons, portraits, backgrounds
├─ config/                        # setup database
├─ data/                          # gameplay database (leader, civs, the Eye)
├─ text/en_us/, l10n/             # English text, translations
├─ maps/, scripts/, ui-next/, ui/<base folders>/   # base-game overrides
└─ ui/shared/, ui/setup/, ui/observer/             # the mod's UI modules
```

Settings: `ui/setup/setup-config.js`, `ui/observer/observer-config.js`
(`debug: true` logs diagnostics to `UI.log`).

## Changelog

### 1.1.0

- **Every map** — the Spectator sees the whole map on the Earth maps and
  custom maps too.
- **Ribbon** — the Spectator's card stays on screen however many leaders
  there are; other players' ribbons no longer show the Spectator.
- **Multiplayer** — computer players can no longer be set to the Spectator.
- **Graphs** — renamed from Yield Graphs, with a Yields / Units filter; Units
  shows the units each leader trained, lost and defeated, on a timeline.

### 1.0.0

- First standalone release (split from Multiplayer Toolkit; both can run
  together): Perspective, settlement details, independents and city-states,
  faith badges, Yield Graphs, game setup in single player and multiplayer,
  new art and full translations.

## Special thanks

**ArKantiK**, for all their feedback and testing.

## License

Copyright (C) 2026 Zatygold. GNU General Public License v3 or later, without
any warranty. See [`LICENSE`](LICENSE).
