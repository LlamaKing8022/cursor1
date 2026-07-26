import "./style.css";
import { FIXED_STEP, Simulation } from "./sim/simulation";
import { Renderer } from "./render/renderer";
import { randomSeed, seedFromString } from "./sim/rng";
import type { ArenaStyle, Cube, GameMode, SimConfig } from "./sim/types";

const MAX_STEPS_PER_FRAME = 12;

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const canvas = required<HTMLCanvasElement>("arena");
const renderer = new Renderer(canvas);

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

  renderer.setArena(config.mode, config.arenaStyle);
  ui.result.hidden = true;
  ui.banner.hidden = true;
  ui.modeLabel.textContent = config.mode === "battle" ? "Battle Royale" : "Race to the finish";
  ui.secondaryLabel.textContent = config.mode === "battle" ? "Alive" : "Leader";
  ui.seed.textContent = String(config.seed);
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
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME * timeScale) {
      sim.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    // Drop leftover time rather than letting it snowball on slow frames.
    if (accumulator > FIXED_STEP * 4) accumulator = 0;
  } else {
    sim.step(0);
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
    meta.textContent = cube.alive ? `${Math.ceil(cube.hp)} hp · ${kos}` : `out · ${kos}`;
    fill.style.width = `${Math.max(0, ratio) * 100}%`;
    fill.style.background = ratio > 0.5 ? "var(--good)" : ratio > 0.25 ? "#ffd166" : "var(--danger)";
  } else {
    const progress = sim.finishX ? Math.min(1, cube.x / sim.finishX) : 0;
    meta.textContent = cube.place > 0 ? `${cube.finishTime.toFixed(1)}s` : `${Math.round(progress * 100)}%`;
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
  syncSetupForm();
  ui.setup.hidden = false;
  setRunning(false);
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
  ui.arena.value = config.arenaStyle;
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

  closeSetup();
  startMatch({
    mode: selectedMode(),
    cubeCount: Number(ui.count.value),
    seed,
    speed: Number(ui.speed.value),
    arenaStyle: ui.arena.value as ArenaStyle,
    powerUpsEnabled: ui.powerUps.checked,
    startingHp: Number(ui.hp.value),
  });
});

ui.setup.addEventListener("click", (event) => {
  if (event.target === ui.setup) {
    closeSetup();
    setRunning(true);
  }
});

window.addEventListener("keydown", (event) => {
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

setTimeScale(1);
startMatch(config);
requestAnimationFrame(frame);
