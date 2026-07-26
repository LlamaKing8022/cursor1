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
| Arena | `open` (empty), `pillars` (a few obstacles), `maze` (tight and chaotic) |
| Power-ups | Toggle pickups on or off |
| Seed | Leave blank for random, or enter a value to replay an exact match |

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
- no cube escapes the arena or picks up a NaN position
- cubes never stall out
- the same seed replays identically

There is also a browser suite that drives the built app with Playwright, checking that the
canvas actually draws, the controls and setup modal work, matches reach a winner on screen,
and no runtime errors appear. It needs a server running:

```bash
npm run build
npm run preview -- --port 4173
npm run test:browser -- http://localhost:4173
```

## Project layout

```
src/
  sim/          # DOM-free simulation: physics, modes, arenas, RNG
  render/       # canvas renderer (camera, trails, particles)
  main.ts       # app wiring, HUD, setup modal
tests/          # headless simulation tests
```

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
