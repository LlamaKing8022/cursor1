import "./style.css";
import { FIXED_STEP, Simulation } from "./sim/simulation";
import { Renderer } from "./render/renderer";
import { randomSeed, seedFromString } from "./sim/rng";
import { GUNS } from "./sim/guns";
import type { GunKind } from "./sim/guns";
import { createGunIconElement } from "./render/gunIcons";
import { SoundEngine } from "./audio/sounds";
import { MapEditor } from "./editor/editor";
import { findMap, loadMaps } from "./editor/storage";
import type { CustomMap } from "./sim/map";
import type { ArenaStyle, Cube, GameMode, SimConfig } from "./sim/types";

const MAX_STEPS_PER_FRAME = 12;

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const canvas = required<HTMLCanvasElement>("arena");
const renderer = new Renderer(canvas);
const sounds = new SoundEngine();

const ui = {
  modeLabel: required<HTMLParagraphElement>("mode-label"),
  time: required<HTMLSpanElement>("stat-time"),
  secondary: required<HTMLSpanElement>("stat-secondary"),
  secondaryLabel: required<HTMLSpanElement>("stat-secondary-label"),
  seed: required<HTMLSpanElement>("stat-seed"),
  play: required<HTMLButtonElement>("btn-play"),
  rerun: required<HTMLButtonElement>("btn-rerun"),
  newMatch: required<HTMLButtonElement>("btn-new"),
  setupButton: required<HTMLButtonElement>("btn-setup"),
  editorButton: required<HTMLButtonElement>("btn-editor"),
  leaderboard: required<HTMLOListElement>("leaderboard"),
  banner: required<HTMLDivElement>("banner"),
  bannerText: required<HTMLSpanElement>("banner-text"),
  result: required<HTMLDivElement>("result"),
  resultKicker: required<HTMLParagraphElement>("result-kicker"),
  resultName: required<HTMLHeadingElement>("result-name"),
  resultDetail: required<HTMLParagraphElement>("result-detail"),
  again: required<HTMLButtonElement>("btn-again"),
  resultSetup: required<HTMLButtonElement>("btn-result-setup"),
  setup: required<HTMLDivElement>("setup"),
  setupForm: required<HTMLFormElement>("setup-form"),
  cancel: required<HTMLButtonElement>("btn-cancel"),
  count: required<HTMLInputElement>("input-count"),
  countOut: required<HTMLOutputElement>("out-count"),
  speed: required<HTMLInputElement>("input-speed"),
  speedOut: required<HTMLOutputElement>("out-speed"),
  hp: required<HTMLInputElement>("input-hp"),
  hpOut: required<HTMLOutputElement>("out-hp"),
  hpField: required<HTMLDivElement>("field-hp"),
  arena: required<HTMLSelectElement>("input-arena"),
  powerUps: required<HTMLInputElement>("input-powerups"),
  seedInput: required<HTMLInputElement>("input-seed"),
};

let config: SimConfig = {
  mode: "battle",
  cubeCount: 8,
  seed: randomSeed(),
  speed: 1,
  arenaStyle: "pillars",
  powerUpsEnabled: true,
  startingHp: 100,
  customMap: null,
};

let sim = new Simulation(config);
let running = true;
let timeScale = 1;
let accumulator = 0;
let lastFrame = performance.now();
let resultShown = false;

function startMatch(next: SimConfig): void {
  config = next;
  sim = new Simulation(config);
  accumulator = 0;
  lastFrame = performance.now();
  resultShown = false;
  running = true;

  renderer.setArena(config.mode, config.customMap?.palette ?? config.arenaStyle);
  sounds.setArenaWidth(sim.bounds.width);
  ui.result.hidden = true;
  ui.banner.hidden = true;

  const modeName = config.mode === "battle" ? "Battle Royale" : "Race to the finish";
  ui.modeLabel.textContent = config.customMap
    ? `${modeName} · ${config.customMap.name}`
    : modeName;
  ui.secondaryLabel.textContent = config.mode === "battle" ? "Alive" : "Leader";
  ui.seed.textContent = String(config.seed);
  ui.modeLabel.title = config.customMap ? `Custom map: ${config.customMap.name}` : "";
  ui.play.textContent = "Pause";
  renderer.resize();
}

/* ---------- Rendering loop ---------- */

function frame(now: number): void {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;

  if (running && sim.status === "running") {
    accumulator += elapsed * timeScale;
    let steps = 0;
    const frameEvents = [];
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME * timeScale) {
      sim.step(FIXED_STEP);
      frameEvents.push(...sim.drainEvents());
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    sounds.handle(frameEvents);
    // Drop leftover time rather than letting it snowball on slow frames.
    if (accumulator > FIXED_STEP * 4) accumulator = 0;
  } else {
    sim.step(0);
    sim.drainEvents();
  }

  const snapshot = sim.snapshot();
  renderer.draw(snapshot, sim.bounds, elapsed);
  updateHud(snapshot.time);
  updateLeaderboard();
  updateBanner();

  if (sim.status === "finished" && !resultShown) {
    showResult();
  }

  requestAnimationFrame(frame);
}

function updateHud(time: number): void {
  ui.time.textContent = `${time.toFixed(1)}s`;

  if (config.mode === "battle") {
    ui.secondary.textContent = `${sim.aliveCubes.length}/${sim.cubes.length}`;
    return;
  }

  const leader = sim.standings()[0];
  if (!leader || sim.finishX === null) {
    ui.secondary.textContent = "—";
    return;
  }
  const progress = Math.min(100, Math.round((leader.x / sim.finishX) * 100));
  ui.secondary.textContent = `${progress}%`;
}

function updateLeaderboard(): void {
  const standings = sim.standings();
  const rows = standings.map((cube, index) => buildRow(cube, index));
  ui.leaderboard.replaceChildren(...rows);
}

function appendGunCarrying(meta: HTMLElement, kind: GunKind, prefix = false): void {
  const icon = createGunIconElement(kind, GUNS[kind].color);
  if (prefix) {
    meta.append(icon, document.createTextNode(" · "));
    return;
  }
  meta.append(document.createTextNode(" · "), icon);
}

function buildRow(cube: Cube, index: number): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "row";
  if (config.mode === "battle" && !cube.alive) row.classList.add("is-out");
  if (index === 0) row.classList.add("is-leader");

  const rank = document.createElement("span");
  rank.className = "row-rank";
  rank.textContent = config.mode === "race" && cube.place > 0 ? `#${cube.place}` : `${index + 1}`;

  const swatch = document.createElement("span");
  swatch.className = "row-swatch";
  swatch.style.background = cube.color;

  const name = document.createElement("span");
  name.className = "row-name";
  name.textContent = cube.name;

  const meta = document.createElement("span");
  meta.className = "row-meta";

  const bar = document.createElement("span");
  bar.className = "row-bar";
  const fill = document.createElement("span");

  if (config.mode === "battle") {
    const ratio = cube.hp / cube.maxHp;
    const kos = `${cube.kills} KO`;
    const gun = cube.alive ? sim.gunHeldBy(cube.id) : null;
    meta.textContent = cube.alive ? `${Math.ceil(cube.hp)} hp · ${kos}` : `out · ${kos}`;
    if (gun) appendGunCarrying(meta, gun.kind);
    fill.style.width = `${Math.max(0, ratio) * 100}%`;
    fill.style.background = ratio > 0.5 ? "var(--good)" : ratio > 0.25 ? "#ffd166" : "var(--danger)";
  } else {
    const progress = sim.finishX ? Math.min(1, cube.x / sim.finishX) : 0;
    const gun = sim.gunHeldBy(cube.id);
    if (gun && cube.place === 0) {
      appendGunCarrying(meta, gun.kind, true);
    }
    meta.append(document.createTextNode(cube.place > 0 ? `${cube.finishTime.toFixed(1)}s` : `${Math.round(progress * 100)}%`));
    fill.style.width = `${progress * 100}%`;
    fill.style.background = cube.color;
  }

  bar.append(fill);
  row.append(rank, swatch, name, meta, bar);
  return row;
}

function updateBanner(): void {
  const stormActive = config.mode === "battle" && sim.activeBounds.width < sim.bounds.width;
  if (stormActive && sim.status === "running") {
    ui.banner.hidden = false;
    ui.bannerText.textContent = "The walls are closing in";
  } else {
    ui.banner.hidden = true;
  }
}

function showResult(): void {
  resultShown = true;
  const winner = sim.winner;

  if (!winner) {
    ui.resultKicker.textContent = "Draw";
    ui.resultName.textContent = "No survivors";
    ui.resultDetail.textContent = "Every cube was eliminated.";
    ui.result.hidden = false;
    return;
  }

  const photoFinish = config.mode === "battle" && !winner.alive;
  ui.resultKicker.textContent = photoFinish
    ? "Photo finish"
    : config.mode === "battle"
      ? "Last cube standing"
      : "First across the line";
  ui.resultName.textContent = winner.name;
  ui.resultName.style.color = winner.color;

  if (config.mode === "battle") {
    const kills = winner.kills === 1 ? "1 elimination" : `${winner.kills} eliminations`;
    ui.resultDetail.textContent = photoFinish
      ? `Traded the final blow · ${kills} · lasted ${sim.time.toFixed(1)}s`
      : `${kills} · ${Math.ceil(winner.hp)} HP left · survived ${sim.time.toFixed(1)}s`;
  } else {
    const runnerUp = sim.standings().find((cube) => cube.id !== winner.id && cube.place === 2);
    const margin = runnerUp ? ` · ${(runnerUp.finishTime - winner.finishTime).toFixed(2)}s ahead` : "";
    ui.resultDetail.textContent = `Finished in ${winner.finishTime.toFixed(2)}s${margin}`;
  }

  ui.result.hidden = false;
}

/* ---------- Controls ---------- */

function setRunning(next: boolean): void {
  running = next;
  ui.play.textContent = running ? "Pause" : "Play";
  if (running) lastFrame = performance.now();
}

function setTimeScale(next: number): void {
  timeScale = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>(".btn-speed")) {
    button.classList.toggle("is-active", Number(button.dataset.speed) === next);
  }
}

ui.play.addEventListener("click", () => setRunning(!running));
ui.rerun.addEventListener("click", () => startMatch({ ...config }));
ui.newMatch.addEventListener("click", () => startMatch({ ...config, seed: randomSeed() }));
ui.again.addEventListener("click", () => startMatch({ ...config, seed: randomSeed() }));

for (const button of document.querySelectorAll<HTMLButtonElement>(".btn-speed")) {
  button.addEventListener("click", () => setTimeScale(Number(button.dataset.speed)));
}

/* ---------- Setup modal ---------- */

function openSetup(): void {
  refreshArenaOptions();
  syncSetupForm();
  ui.setup.hidden = false;
  setRunning(false);
}

const BUILT_IN_ARENAS: Array<[ArenaStyle, string]> = [
  ["pillars", "Pillars — a few obstacles"],
  ["open", "Open — wide and empty"],
  ["maze", "Maze — tight and chaotic"],
];

/** Rebuilds the arena dropdown so newly saved custom maps show up. */
function refreshArenaOptions(): void {
  const previous = ui.arena.value;
  const generated = document.createElement("optgroup");
  generated.label = "Generated";
  for (const [value, label] of BUILT_IN_ARENAS) {
    generated.append(new Option(label, value));
  }

  const nodes: Array<HTMLOptGroupElement> = [generated];
  const maps = loadMaps();
  if (maps.length > 0) {
    const custom = document.createElement("optgroup");
    custom.label = "Your maps";
    for (const map of maps) {
      custom.append(new Option(map.name, `custom:${map.id}`));
    }
    nodes.push(custom);
  }

  ui.arena.replaceChildren(...nodes);

  const stillThere = Array.from(ui.arena.options).some((option) => option.value === previous);
  ui.arena.value = stillThere ? previous : config.arenaStyle;
}

function closeSetup(): void {
  ui.setup.hidden = true;
}

function syncSetupForm(): void {
  const modeInput = ui.setupForm.querySelector<HTMLInputElement>(
    `input[name="mode"][value="${config.mode}"]`,
  );
  if (modeInput) modeInput.checked = true;

  ui.count.value = String(config.cubeCount);
  ui.speed.value = String(config.speed);
  ui.hp.value = String(config.startingHp);
  ui.arena.value = config.customMap ? `custom:${config.customMap.id}` : config.arenaStyle;
  ui.powerUps.checked = config.powerUpsEnabled;
  ui.seedInput.value = "";
  refreshSetupOutputs();
}

function selectedMode(): GameMode {
  const checked = ui.setupForm.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return checked?.value === "race" ? "race" : "battle";
}

function refreshSetupOutputs(): void {
  ui.countOut.textContent = ui.count.value;
  ui.speedOut.textContent = `${Number(ui.speed.value).toFixed(1)}x`;
  ui.hpOut.textContent = ui.hp.value;
  // HP is meaningless in race mode since cubes never take damage.
  ui.hpField.hidden = selectedMode() === "race";
}

ui.setupButton.addEventListener("click", openSetup);
ui.resultSetup.addEventListener("click", openSetup);
ui.cancel.addEventListener("click", () => {
  closeSetup();
  setRunning(true);
});

ui.setupForm.addEventListener("input", refreshSetupOutputs);

ui.setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = ui.seedInput.value.trim();
  const seed = raw === "" ? randomSeed() : /^\d+$/.test(raw) ? Number(raw) >>> 0 : seedFromString(raw);

  const arenaValue = ui.arena.value;
  const customMap = arenaValue.startsWith("custom:") ? findMap(arenaValue.slice(7)) : null;

  closeSetup();
  startMatch({
    mode: selectedMode(),
    cubeCount: Number(ui.count.value),
    seed,
    speed: Number(ui.speed.value),
    // A custom map supplies its own layout, so keep the last generated style.
    arenaStyle: customMap ? config.arenaStyle : (arenaValue as ArenaStyle),
    powerUpsEnabled: ui.powerUps.checked,
    startingHp: Number(ui.hp.value),
    customMap,
  });
});

ui.setup.addEventListener("click", (event) => {
  if (event.target === ui.setup) {
    closeSetup();
    setRunning(true);
  }
});

/* ---------- Map editor ---------- */

const editor = new MapEditor({
  onTest: (map: CustomMap, mode: GameMode) => {
    startMatch({ ...config, mode, customMap: map, seed: randomSeed() });
    setRunning(true);
  },
  onMapsChanged: refreshArenaOptions,
  onClose: () => setRunning(true),
});

ui.editorButton.addEventListener("click", () => {
  setRunning(false);
  editor.open();
});

window.addEventListener("keydown", (event) => {
  if (editor.isOpen) return;

  if (event.key === "Escape" && !ui.setup.hidden) {
    closeSetup();
    setRunning(true);
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

  if (event.code === "Space") {
    event.preventDefault();
    setRunning(!running);
  } else if (event.key === "r") {
    startMatch({ ...config, seed: randomSeed() });
  }
});

window.addEventListener("resize", () => renderer.resize());

function unlockAudio(): void {
  sounds.unlock();
}

window.addEventListener("pointerdown", unlockAudio, { once: true });
window.addEventListener("keydown", unlockAudio, { once: true });

setTimeScale(1);
startMatch(config);
requestAnimationFrame(frame);
