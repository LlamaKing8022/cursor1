/**
 * Drives the built app in a real browser to confirm it renders and the controls
 * work. Run against a preview server:
 *
 *   npm run preview -- --port 4173
 *   npx tsx tests/browser.check.ts [baseUrl] [screenshotDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE_URL = process.argv[2] ?? "http://localhost:4173";
const SHOT_DIR = process.argv[3] ?? "/tmp/cube-arena-shots";

let failures = 0;

function check(condition: boolean, message: string): void {
  console.log(`${condition ? "  ok  " : "  FAIL"} ${message}`);
  if (!condition) failures += 1;
}

/** Counts distinct colours drawn on the canvas to prove it is not blank. */
async function canvasSignature(page: import("playwright").Page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("arena") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { colors: 0, pixels: 0 };
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    let lit = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      seen.add(key);
      if (data[i] + data[i + 1] + data[i + 2] > 120) lit += 1;
    }
    return { colors: seen.size, pixels: lit };
  });
}

mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

console.log(`\nLoading ${BASE_URL}`);
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForTimeout(2500);

console.log("\nbattle mode boots and renders");
check(await page.locator("#arena").isVisible(), "canvas is visible");
const battleFrame = await canvasSignature(page);
check(battleFrame.colors > 12, `canvas drew ${battleFrame.colors} distinct colours`);
check(battleFrame.pixels > 40, `canvas has ${battleFrame.pixels} lit sample points`);
check((await page.locator("#leaderboard .row").count()) === 8, "leaderboard lists 8 cubes");
check((await page.locator("#feed").count()) === 0, "match feed is gone");
check(/\d+\.\d+s/.test((await page.locator("#stat-time").textContent()) ?? ""), "clock is running");
check((await page.locator("#result").isVisible()) === false, "result overlay hidden mid-match");
await page.screenshot({ path: `${SHOT_DIR}/battle.png` });

console.log("\nsimulation advances over time");
const timeA = await page.locator("#stat-time").textContent();
await page.waitForTimeout(1200);
const timeB = await page.locator("#stat-time").textContent();
check(timeA !== timeB, `clock advanced (${timeA} -> ${timeB})`);

console.log("\npause and resume");
await page.click("#btn-play");
check((await page.locator("#btn-play").textContent()) === "Play", "button flips to Play");
const pausedA = await page.locator("#stat-time").textContent();
await page.waitForTimeout(700);
check((await page.locator("#stat-time").textContent()) === pausedA, "clock frozen while paused");
await page.click("#btn-play");
await page.waitForTimeout(500);
check((await page.locator("#stat-time").textContent()) !== pausedA, "clock resumes");

console.log("\nspeed controls");
await page.click('.btn-speed[data-speed="4"]');
check(
  await page.locator('.btn-speed[data-speed="4"]').evaluate((el) => el.classList.contains("is-active")),
  "4x is marked active",
);

console.log("\nbattle reaches a winner");
await page.waitForSelector("#result:visible", { timeout: 60_000 });
const winnerName = (await page.locator("#result-name").textContent())?.trim() ?? "";
check(winnerName.length > 0, `winner announced: ${winnerName}`);
check(
  ((await page.locator("#result-detail").textContent()) ?? "").length > 0,
  "winner detail line is populated",
);
await page.screenshot({ path: `${SHOT_DIR}/battle-winner.png` });

console.log("\nsetup modal switches to race mode");
await page.click("#btn-result-setup");
check(await page.locator("#setup").isVisible(), "setup modal opened");
check(await page.locator("#field-hp").isVisible(), "HP slider shown for battle");
await page.check('input[name="mode"][value="race"]');
check((await page.locator("#field-hp").isVisible()) === false, "HP slider hidden for race");

await page.fill("#input-seed", "4242");
await page.locator("#input-count").fill("12");
check((await page.locator("#out-count").textContent()) === "12", "cube count output updates");
await page.click('#setup-form button[type="submit"]');
await page.waitForTimeout(2500);

console.log("\nrace mode runs");
check((await page.locator("#setup").isVisible()) === false, "setup modal closed");
check((await page.locator("#mode-label").textContent()) === "Race to the finish", "mode label updated");
check((await page.locator("#stat-seed").textContent()) === "4242", "seed applied");
check((await page.locator("#stat-secondary-label").textContent()) === "Leader", "stat switches to Leader");
check((await page.locator("#leaderboard .row").count()) === 12, "leaderboard lists 12 cubes");
const raceFrame = await canvasSignature(page);
check(raceFrame.colors > 12, `race canvas drew ${raceFrame.colors} distinct colours`);
await page.screenshot({ path: `${SHOT_DIR}/race.png` });

console.log("\nrace finishes and can be replayed by seed");
await page.click('.btn-speed[data-speed="4"]');
await page.waitForSelector("#result:visible", { timeout: 60_000 });
const raceWinner = (await page.locator("#result-name").textContent())?.trim();
check(
  ((await page.locator("#result-kicker").textContent()) ?? "").length > 0,
  `race winner announced: ${raceWinner}`,
);
await page.screenshot({ path: `${SHOT_DIR}/race-winner.png` });

await page.click("#btn-result-setup");
await page.fill("#input-seed", "4242");
await page.click('#setup-form button[type="submit"]');
await page.click('.btn-speed[data-speed="4"]');
await page.waitForSelector("#result:visible", { timeout: 60_000 });
const replayWinner = (await page.locator("#result-name").textContent())?.trim();
check(replayWinner === raceWinner, `same seed reproduced the winner (${raceWinner} / ${replayWinner})`);

console.log("\nkeyboard shortcuts");
await page.click("#btn-again");
await page.waitForTimeout(400);
await page.keyboard.press("Space");
check((await page.locator("#btn-play").textContent()) === "Play", "space toggles pause");
await page.keyboard.press("Space");

console.log("\nmap editor opens");
await page.click("#btn-editor");
check(await page.locator("#editor").isVisible(), "editor overlay opened");
check(await page.locator("#editor-canvas").isVisible(), "editor canvas visible");

// The canvas must not move when switching tools, or clicks land in the wrong
// place: pads were being placed with one layout and erased with another.
const toolBoxes: number[] = [];
for (const tool of ["wall", "spawn", "powerup", "erase"]) {
  await page.click(`.tool[data-tool="${tool}"]`);
  const bounds = await page.locator("#editor-canvas").boundingBox();
  toolBoxes.push(Math.round(bounds?.y ?? -1));
}
check(
  new Set(toolBoxes).size === 1,
  `canvas stays put across tools (y positions: ${toolBoxes.join(", ")})`,
);

const box = (await page.locator("#editor-canvas").boundingBox())!;
async function dragOn(x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 8 });
  await page.mouse.up();
}
async function clickOn(x: number, y: number) {
  await page.mouse.click(box.x + x, box.y + y);
}

await page.fill("#editor-name", "Test map");

console.log("\ndrawing walls, spawn zones and pads");
await page.click('.tool[data-tool="wall"]');
await dragOn(120, 80, 200, 260);
check(
  ((await page.locator("#editor-hint").textContent()) ?? "").includes("1 walls"),
  "wall was added",
);

await page.click('.tool[data-tool="spawn"]');
await dragOn(320, 90, 460, 230);
check(
  ((await page.locator("#editor-hint").textContent()) ?? "").includes("1 spawn zones"),
  "spawn zone was added",
);

await page.click('.tool[data-tool="powerup"]');
check(
  (await page.locator("#editor-kind").isDisabled()) === false,
  "pad type selector enabled for the power-up tool",
);
await page.selectOption("#editor-kind", "heal");
await clickOn(540, 300);
check(((await page.locator("#editor-hint").textContent()) ?? "").includes("1 pads"), "pad was added");

console.log("\nundo and erase");
await page.click("#editor-undo");
check(((await page.locator("#editor-hint").textContent()) ?? "").includes("0 pads"), "undo removed the pad");

await page.click('.tool[data-tool="powerup"]');
await clickOn(540, 300);
await page.click('.tool[data-tool="erase"]');
await clickOn(540, 300);
check(
  ((await page.locator("#editor-hint").textContent()) ?? "").includes("0 pads"),
  "erase removed the pad",
);

await page.click('.tool[data-tool="powerup"]');
await clickOn(560, 320);

console.log("\nmoving walls");
await page.click('.tool[data-tool="wall"]');
check(
  (await page.locator("#editor-direction").isDisabled()) === false,
  "wall movement selector enabled for the wall tool",
);
await page.selectOption("#editor-direction", "right");
await page.locator("#editor-wall-speed").fill("60");
check((await page.locator("#editor-wall-speed-out").textContent()) === "60", "wall speed output updates");
await dragOn(620, 90, 680, 240);
check(
  ((await page.locator("#editor-status").textContent()) ?? "").includes("Moving wall"),
  "moving wall reported",
);
check(
  ((await page.locator("#editor-hint").textContent()) ?? "").includes("(1 moving)"),
  "hint counts the moving wall",
);
await page.selectOption("#editor-direction", "none");

console.log("\nplacing guns");
await page.click('.tool[data-tool="gun"]');
check(
  (await page.locator("#editor-gun").isDisabled()) === false,
  "gun selector enabled for the gun tool",
);
check(
  await page.locator("#editor-direction").isDisabled(),
  "wall movement selector disabled outside the wall tool",
);
await page.selectOption("#editor-gun", "sniper");
await clickOn(400, 340);
check(
  ((await page.locator("#editor-status").textContent()) ?? "").includes("Sniper"),
  "sniper placed",
);
await page.selectOption("#editor-gun", "smg");
await clickOn(300, 380);
check(((await page.locator("#editor-hint").textContent()) ?? "").includes("2 guns"), "two guns placed");

console.log("\nsaving the map");
await page.click("#editor-save");
check(
  ((await page.locator("#editor-status").textContent()) ?? "").includes("Saved"),
  "save reported success",
);
check(
  (await page.locator("#editor-load option").allTextContents()).includes("Test map"),
  "saved map appears in the editor's map list",
);

console.log("\ntesting the map straight from the editor");
await page.click("#editor-test-battle");
await page.waitForTimeout(1500);
check((await page.locator("#editor").isVisible()) === false, "editor closed when testing");
check(
  ((await page.locator("#mode-label").textContent()) ?? "").includes("Test map"),
  `match runs on the custom map (${await page.locator("#mode-label").textContent()})`,
);

// Guns must survive the round trip into a live match. Whether a bouncing cube
// reaches a gun is down to chance, so poll rather than waiting a fixed time,
// and restart the match if it finishes before anyone grabs one.
async function waitForGunPickup(attempts = 3, perAttemptMs = 12_000): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const deadline = Date.now() + perAttemptMs;
    while (Date.now() < deadline) {
      const rows = await page.locator("#leaderboard .row-meta").allTextContents();
      if (rows.some((row) => /🔫|💨|💥|🎯/.test(row))) return true;
      if (await page.locator("#result").isVisible()) break;
      await page.waitForTimeout(150);
    }
    if (await page.locator("#result").isVisible()) {
      await page.click("#btn-again");
      await page.waitForTimeout(400);
    }
  }
  return false;
}

await page.click('.btn-speed[data-speed="1"]');
check(await waitForGunPickup(), "a cube picked up a gun during the match");

console.log("\ncustom map is selectable in setup after a reload");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
await page.click("#btn-setup");
const arenaOptions = await page.locator("#input-arena option").allTextContents();
check(arenaOptions.includes("Test map"), `custom map listed in setup (${arenaOptions.join(", ")})`);

await page.selectOption("#input-arena", { label: "Test map" });
await page.click('#setup-form button[type="submit"]');
await page.waitForTimeout(1500);
check(
  ((await page.locator("#mode-label").textContent()) ?? "").includes("Test map"),
  "match started on the saved map",
);
check((await page.locator("#leaderboard .row").count()) > 0, "standings populated on the custom map");

console.log("\ndeleting a saved map");
await page.click("#btn-editor");
await page.selectOption("#editor-load", { label: "Test map" });
check(
  ((await page.locator("#editor-status").textContent()) ?? "").includes("Loaded"),
  "saved map loaded back into the editor",
);
await page.click("#editor-delete");
check(
  ((await page.locator("#editor-status").textContent()) ?? "").includes("deleted"),
  "map deleted",
);
check(
  !(await page.locator("#editor-load option").allTextContents()).includes("Test map"),
  "deleted map left the list",
);
await page.click("#editor-done");
check((await page.locator("#editor").isVisible()) === false, "editor closed");

console.log("\nno runtime errors");
check(pageErrors.length === 0, `uncaught page errors: ${JSON.stringify(pageErrors)}`);
check(consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors)}`);

await browser.close();

console.log(`\nscreenshots written to ${SHOT_DIR}`);
if (failures > 0) {
  console.error(`\n${failures} browser check(s) failed`);
  process.exit(1);
}
console.log("\nall browser checks passed");
