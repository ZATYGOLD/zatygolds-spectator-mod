# Zatygold's Spectator

A playable **Spectator** for **Sid Meier's Civilization VII**, single player and
multiplayer, built on the game's own UI components. Current version: **1.0.0**.

Pick **Spectator** as your leader to watch a game as a real player with no
empire: whole-map vision, every leader's stats, screens and yield graphs, the
normal HUD and End Turn, through every Age, and you are never eliminated.

## Installation

1. Copy the mod folder into your mods folder:
   `…\Sid Meier's Civilization VII\Mods\`
2. Enable **Zatygold's Spectator** in **Main Menu → Additional Content**.
3. **Every player must install and enable the mod** (it changes gameplay data).

---

## Spectator (experimental)

**Setup:** in single player pick **Spectator** as your leader: its
civilization, **the Observers**, follows, so the civilization step is skipped
and the Overview shows the Spectator's own art. In the multiplayer lobby pick
the Spectator leader or the Observers civilization (the other follows; team
and civ lock). The Spectator plays no mementos: its memento slots are turned
off. At each Age transition the Observers are picked automatically. Computer
players never become the Spectator.

**Playing:** you are a normal player who never settles and is never
eliminated. Press **End Turn** or turn on **Auto End Turn** (the button on
your ribbon card; it switches off when an Age completes so the Age transition
action shows). Chat and every screen work. Your Founder is replaced by
the hidden **Spectator's Eye**, whose sight shows every unit live.

**Ribbon:** every living leader, your card at the right edge.

- Your card's buttons switch every card between **Yields** (compact rows
  incl. food, production, citizens, military, techs / civics / wonders),
  **Research**, **Production** and **Victories**. Rows take the Clean Slate
  mod's look: lining digits that line up between rows, thousands separators,
  bright value colours on the slate background, the highest value in a row
  on a light pill and the lowest (from four leaders) on a black one,
  negative totals in bright red, and each card's banner tinted with the
  player's colour.
- Right-click your portrait to hide or show details (the game's "Always Show
  Ribbon Yields" option); left-click it to end a Perspective, or else to jump
  to the Eye.
- Left-click a leader to see their Perspective and jump to their capital;
  right-click to jump there and open their leader panel (wars listed, no
  actions). An independent's or city-state's panel shows its type, a
  city-state's suzerain and their chosen bonus, then every leader's
  relationship with it: friendly, neutral or hostile, at war (city-states),
  and befriending progress.
- Allies share a hex-border colour (no glow); leaders at war glow red with a
  pip per war; celebrations glow gold. Each card shows the leader's
  religion, or their pantheon (tinted amber) until they found one (with the
  Multiplayer Balance Mod, pantheons stay for the whole game), and their
  ideology. Hover a pantheon badge for its effects, or click it to see every
  leader's pantheons, in any Age; the Religion screen lists a leader's
  pantheon too, and after Exploration notes that religion beliefs have
  ended.

**Perspective:** left-click a leader's portrait to see the game as they see
it: tiles they see now look normal, tiles they explored earlier are dark
grey (with greyed resource icons), tiles they never explored are black, on
the map and the minimap, and unit flags, settlement banners and floating map
texts follow what they can see. The ribbon lists only the leaders they have
met (and you); the top bar shows their yields; Resources & Trade, Legacies,
Government, Great Works, Religion and the tech / civic trees show theirs,
with no row of leader portraits. The camera keeps the game's normal zoom
range meanwhile. The eye on their card, between portrait and civ symbol,
marks whose view it is. Left-click another leader to switch; click the same
leader again, or your own portrait, to see the whole game again. It only
changes what you see, never the game.

**Settlements:** click any settlement's banner or city center to open the
settlement's details, in the spirit of the City Hall mod's overview:
population (urban / rural / specialists, with religion icons once spread),
growth progress, connections (click one to open it), warehouse yields, a
town's focus choices with the current one highlighted and its estimated
bonuses, and the buildings and wonders standing. The arrows step through
that leader's other settlements, and razing or unrest shows in red.
Right-click a banner to open its owner's leader panel instead. Town banners
show the town's focus beside the name, where the capital star sits (as the
Flag Corps mod places its settlement icons); a city-state's type icon names
its suzerain bonus on hover.

**Yield Graphs:** a button in the HUD's screen dock opens line graphs of
every leader's science, culture, gold, influence, food and production per
turn (a tab each), recorded every turn and saved with the game. It is built
from the Victories screen's own frame, rows and graph, like its Economic tab:
Rank / Leader / Per Turn rows (click one to hide or show its line), the graph
on the right, and an Age dropdown for the whole game (Overall) or one Age.

**Screens:** Resources & Trade, Legacies, Government, Great Works, Religion and
the tech / civic trees get a row of leader portraits — pick one to see that
screen as theirs (read-only, same tab). The tech and civic buttons open the
full tree directly. Click any unit to inspect it; with a combat unit selected,
hover another unit for an estimated combat preview.

**Languages:** English plus every language the game supports.

**Quiet:** advisors, narrative events, diplomacy and meeting prompts,
crisis / Age countdown popups, dedications and the Age transition choice are
handled automatically. The camera zooms 30% closer and 55% further; the
notification bar is 25% smaller. Spectators never appear in victories,
rankings, Civ Unlocks or Age-transition choices, and complete no Triumphs.

### How it works

- Data, not UI hacks: a Spectator leader and one civ per Age, defined like the
  game's own, with no abilities. Defeat and every Triumph get an extra
  "not the Spectator" requirement.
- The Eye replaces the Founder (`UnitReplaces`), is created by the start-plot
  script near the bottom-centre of the map (moved onto ice when possible),
  sees 128 tiles through terrain, keeps every unit visible and is kept asleep.
- UI only: the Spectator counts as having met everyone, and screens read the
  picked leader through `ZOMLeaderView`.
- The Spectator has no 3D leader or banner: leader select and diplomacy scenes
  load the game's stand-ins (`zom-assets.js`: the Random leader in setup, the
  game's fallback leader and banner in diplomacy). Setup lists it only for
  human players, offers its civilization only to it, and resolves every
  Random leader itself in single player.
- Zoom past the engine's 0..1 range changes the field of view, as Zoom+ does.

### Known limits

- In multiplayer, a player on "Random" could still resolve to the Spectator.
- The Spectator still takes part in the map's start-region split; its start
  is then moved to the ice.
- The Eye shows as a generic ship, visible only to the Spectator.
- Combat previews between other players' units are estimates.

---

## Project structure

```
zatygolds-observer-mode.modinfo   # manifest, zom-observer-in-game criteria
├─ art/icons/, art/leaders/, art/backgrounds/  # icons, Overview portrait, civ card and loading screen
├─ config/                       # setup DB: Spectator leader / civs, hidden "Spectator in game" option
├─ data/                         # gameplay DB: leaders, civilizations, units (the Eye), legacies, loading info
│  ├─ icons/                     # icon definitions
│  └─ colors/                    # player colours
├─ text/en_us/                   # English text, one file per category (as the base game)
├─ l10n/                         # translations: <language>_Text.xml, ModuleText.xml
├─ maps/, scripts/               # base-game overrides: Spectator start and Eye each Age
├─ ui-next/screens/, ui/policies/, ui/great-works/,
│  ui/tech-tree/, ui/culture-tree/, ui/tree-grid/   # base-game overrides: screens for a picked leader
└─ ui/
   ├─ shared/                    # logger, method wrapping, deferred patching, Spectator identity
   ├─ setup/                     # Spectator in game setup (multiplayer lobby, single player)
   └─ observer/                  # in-game Spectator (no-op for other players)
```

Settings live in `ui/setup/setup-config.js` and `ui/observer/observer-config.js`
(`debug: true` adds diagnostics); modules patch the base UI at runtime. Base-game overrides are verbatim copies with changes marked `ZOM:`;
they load only in a game with a Spectator (modinfo criteria
`zom-observer-in-game`), so other games run the untouched files. Diagnostics go to
`UI.log`.

**Mod compatibility:** the ribbon, settlement details and banner icons take
their look from beezany's Clean Slate, City Hall and Flag Corps mods, so
none is needed alongside this mod. Running Clean Slate as well double-styles
the ribbon and logs errors on the Spectator's card. Flag Corps patches the
game's older banner code, which the current game no longer draws, so it has
no effect either way. City Hall's panels only appear inside a player's city view, which the
Spectator never enters.

---

## Changelog

### 1.0.0

- **Game setup** — the Spectator's leader-select portrait has the leaders'
  ring (with the eye in place of a level); the civilization step is skipped
  for it; the Overview's leader and civilization cards show the Spectator's
  portrait and a slice of its loading-screen art, and the level ring shows
  the eye. Changing the start Age keeps the matching Observers civilization.
- **Perspective** — see the game as any leader sees it: their fog of war,
  explored and unexplored tiles, only the unit flags and settlement banners
  they can see, only the leaders they met, their yields in the top bar and
  their empire screens and trees (left-click a leader's portrait; click it
  again to return).
- **Independents and city-states** — their panel shows the type, the
  city-state's suzerain and chosen suzerain bonus, and every leader's
  relationship and befriending progress (on the game's own progress bar);
  the banner's type icon names the bonus; their map banners no longer go
  missing in the whole-map view.
- **Settlement details** — clicking a settlement opens the Spectator's own
  details panel for it, read-only and built like the City Hall mod's
  overview: population, growth, connections, warehouse yields, town focus
  choices and buildings / wonders; right-clicking its banner opens the
  owner's leader panel. Town banners show the town focus icon.
- **Faith badges** — ribbon cards show the religion (or, before one is
  founded, the pantheon, tinted amber) together with the ideology; with the
  Multiplayer Balance Mod the pantheon stays after Antiquity (read from that
  mod's own pantheon record), and clicking it opens every leader's pantheons
  in any Age. The Religion screen lists the viewed leader's pantheon under
  its own Pantheon heading, shows their religion as the game shows another
  player's (no belief to add), notes in Modern that religion beliefs have
  ended, and stays available in Modern, where the game drops its button. The
  Multiplayer Balance Mod's third memento slot is turned off for the
  Spectator too.
- **The Observers** — the Spectator's civilization has its own name, so the
  leader and the civilization no longer both read "Spectator" (every
  language).
- **No mementos** — the Spectator's memento slots are turned off in single
  player, the multiplayer lobby (also the slots Advanced Settings Pro adds
  there) and at Age transitions; becoming the Spectator unequips any memento.
- **Single player** — pick the Spectator in game setup: its civilization is
  paired automatically, the setup scene shows the Random leader's silhouette
  and banner, and computer players never become the Spectator. The Eye,
  screens and Age transitions work as in multiplayer (the hidden "Spectator
  in game" option is now set in single player too).
- **New art** — a hooded Spectator portrait framed like the base leaders
  (head above the ribbon hex, body behind it), a hex-eye icon, a
  civilization emblem and a loading screen, also used behind the
  Government, Unlocks, Resources and Legacies screens.
- **Renamed** — the mod is now Zatygold's Spectator (mod id unchanged).
- **Translations** — every language the game supports: German, Spanish,
  French, Italian, Japanese, Korean, Polish, Brazilian Portuguese, Russian,
  Simplified and Traditional Chinese.
- **Project layout** — follows the base game's: `config/`, `data/` (with
  `icons/` and `colors/`), `text/en_us/`, `l10n/`, `art/`, and `ui/setup`,
  `ui/observer`, `ui/shared`.
- **Random leaders** — in single player every Random leader, yours included,
  is resolved to a real leader; computer players are never offered the
  lobby's Spectator team entry.
- **Split from Multiplayer Toolkit** — the Spectator is now its own mod
  (`zatygolds-observer-mode`); the pause, Competitive timer and lobby tooltip
  features stay in Multiplayer Toolkit.
- **Runs alongside Multiplayer Toolkit** — every identifier (leader, civs,
  unit, text, icons, game option, UI elements, saved history) uses its own
  `ZOM` prefix, so both mods can be enabled together.
- **Yield Graphs redesign** — built from the Victories screen's own parts
  like its Economic tab: the ornate frame and tab bar, Rank / Leader / Per
  Turn rows with each leader's banner, portrait and line colour (click a row
  to hide or show its line), the game's line graph with thicker lines, and a
  graph glyph in the frame's medallion.
- **Age dropdown** — the game's own dropdown, available from Antiquity on:
  Overall (the whole game) or one Age; no longer shows "Select an Item"
  when switching tabs.
- **Graphs button** — redrawn in the dock icons' look and centred.

---

## Special thanks

Special thanks to **ArKantiK** for all their feedback and testing.

---

## License

Copyright (C) 2026 Zatygold. Free software under the **GNU General Public
License v3 or later**, without any warranty. See [`LICENSE`](LICENSE) or
<https://www.gnu.org/licenses/>.
