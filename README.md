# Cube Arena

A spectator simulator where coloured cubes bounce around an arena and either fight to be
the last one standing or race each other to the finish line. You set the rules and watch
it play out — no controls, no skill, just cubes.

Runs in the browser, so it works on macOS, Windows, and Linux with nothing to install
beyond Node.

## Quick start

```bash
npm install
npm run dev
```

Then open the URL it prints (usually <http://localhost:5173>).

## Modes

**Battle Royale** — cubes damage each other on impact. Damage scales with how hard they
collide, so high-speed hits hurt more. Last cube alive wins. If survivors take too long
to find each other, the arena walls start closing in to force the fight.

**Race** — cubes are pulled toward the finish line but still bounce off walls and each
other, so the path is chaotic. First cube across wins, and the match lingers a moment
afterward to fill out the podium.

## Setup options

| Option | What it does |
| --- | --- |
| Mode | Battle Royale or Race |
| Cubes | 2 to 16 competitors |
| Speed | Baseline cube velocity, 0.5x to 2.5x |
| Starting HP | Battle only; higher means longer fights |
| Arena | `open` (empty), `pillars` (a few obstacles), `maze` (tight and chaotic) — each has its own colour palette — or one of your own maps |
| Power-ups | Toggle pickups on or off |
| Seed | Leave blank for random, or enter a value to replay an exact match |

## Map editor

Click **Map editor** in the top bar to build your own arena. Saved maps appear in the Setup
dropdown under "Your maps", and work in both Battle Royale and Race.

| Tool | What it does |
| --- | --- |
| Wall | Drag to draw a solid block, or click for a default-sized one |
| Spawn zone | Drag out a region where cubes start; cubes are dealt round-robin into the zones and spread on a grid inside each one |
| Power-up | Click to drop a pad. Pick a fixed type or `Random`, which re-rolls each time the pad refills |
| Erase | Click any item to delete it |

Other controls: map width (800–3600), a colour palette, grid snapping, undo (or Cmd/Ctrl+Z),
and **Test battle** / **Test race** to try the current draft without saving it first.

Notes on how maps behave:

- Map height is fixed at 640 so the camera and aspect handling stay predictable.
- In Race mode the finish line sits near the right edge, marked in the editor, so wider maps
  make longer tracks.
- A map with no spawn zones falls back to the default spawn positions.
- Hand-placed pads respawn about 11 seconds after being collected, so they matter all match.
- Maps are stored in your browser's `localStorage`, so they stay on the machine you built
  them on.

## Power-ups

| Pickup | Effect |
| --- | --- |
| `+` Heal | Restores 30 HP |
| `!` Rage | Double damage for 8 seconds |
| `>` Speed | 1.55x speed for 6 seconds |
| `O` Shield | Blocks the next hit entirely |

Races only spawn Speed and Shield, since cubes never take damage there.

## Controls

| Input | Action |
| --- | --- |
| Space | Pause / resume |
| `R` | New match with a fresh seed |
| 1x / 2x / 4x | Simulation speed |
| Rerun | Replay the current seed exactly |
| New match | Same rules, new seed |

## Seeds and determinism

Every match is driven by a seeded PRNG, and the simulation runs on a fixed 1/120s
timestep independent of your frame rate. The same seed and settings always produce the
same match, which is what makes **Rerun** reproduce a result exactly. The seed for the
current match is shown in the top bar.

## Scripts

```bash
npm run dev           # dev server with hot reload
npm run build         # typecheck and build to dist/
npm run preview       # serve the production build
npm run typecheck     # types only
npm test              # headless simulation tests
npm run test:browser  # UI checks against a running preview server
```

## Tests

The simulation core has no DOM dependencies, so it runs headlessly under `tsx`. The suite
plays hundreds of full matches across every mode, arena, and roster size and checks that:

- every match reaches a conclusion with a winner
- battle matches end with exactly one survivor
- a mutual knockout still names a winner, via a survival-time tiebreak
- races are won by crossing the line rather than by hitting the timeout
- battles are usually decided by combat, not by storm chip damage
- kills are credited to the cube that landed the blow
- no cube escapes the arena or picks up a NaN position
- cubes never stall out
- the same seed replays identically

A second suite covers custom maps: that walls and bounds come from the map, cubes spawn
spread across the drawn zones, power-up pads respawn on their cooldown, the race finish line
follows the map width, and that corrupt or out-of-bounds map data is cleaned up into
something still playable rather than crashing.

There is also a browser suite that drives the built app with Playwright, checking that the
canvas actually draws, the controls and setup modal work, matches reach a winner on screen,
the map editor can draw and save a map that then plays, and no runtime errors appear. It
needs a server running:

```bash
npm run build
npm run preview -- --port 4173
npm run test:browser -- http://localhost:4173
```

## Project layout

```
src/
  sim/          # DOM-free simulation: physics, modes, arenas, custom maps, RNG
  render/       # canvas renderer (camera, trails, particles) and arena palettes
  editor/       # map editor screen and localStorage persistence
  main.ts       # app wiring, HUD, setup modal
tests/          # headless simulation and browser tests
```

Cubes are identified by colour rather than on-canvas labels; the standings panel maps each
colour to a name.

## How the simulation works

Cubes are axis-aligned boxes resolved against walls, obstacles, and each other along the
shallower penetration axis. Collisions are elastic, which on its own leaves cubes
gradually crawling, so each cube's speed is continuously nudged back toward a target — it
keeps the action moving and prevents stalemates.

Both modes have guaranteed termination. Battles shrink the arena and eventually apply
escalating chip damage; races increase the forward pull over time and fall back to
awarding the win to whoever got furthest.

## License

MIT
