import {
  MIN_WALL_SIZE,
  MIN_ZONE_SIZE,
  cloneMap,
  createEmptyMap,
  createMapId,
  mapFinishX,
  normalizeMap,
  rectContains,
  type CustomMap,
  type SpotKind,
} from "../sim/map";
import { themeFor } from "../render/theme";
import { deleteMap, findMap, loadMaps, saveMap } from "./storage";
import type { ArenaStyle, GameMode, Rect } from "../sim/types";

type Tool = "wall" | "spawn" | "powerup" | "erase";

interface EditorOptions {
  onTest: (map: CustomMap, mode: GameMode) => void;
  onMapsChanged: () => void;
  onClose: () => void;
}

const GRID = 20;
const DEFAULT_WALL = 80;
const DEFAULT_ZONE = 160;
const CLICK_SLOP = 8;

const SPOT_COLORS: Record<SpotKind, string> = {
  random: "#e8ecff",
  heal: "#4dffa3",
  rage: "#ff4d6d",
  speed: "#ffd166",
  shield: "#4dabff",
};

const SPOT_GLYPHS: Record<SpotKind, string> = {
  random: "?",
  heal: "+",
  rage: "!",
  speed: ">",
  shield: "O",
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

export class MapEditor {
  private options: EditorOptions;
  private root = element<HTMLDivElement>("editor");
  private canvas = element<HTMLCanvasElement>("editor-canvas");
  private ctx: CanvasRenderingContext2D;

  private ui = {
    name: element<HTMLInputElement>("editor-name"),
    kind: element<HTMLSelectElement>("editor-kind"),
    width: element<HTMLInputElement>("editor-width"),
    widthOut: element<HTMLOutputElement>("editor-width-out"),
    palette: element<HTMLSelectElement>("editor-palette"),
    snap: element<HTMLInputElement>("editor-snap"),
    undo: element<HTMLButtonElement>("editor-undo"),
    clear: element<HTMLButtonElement>("editor-clear"),
    load: element<HTMLSelectElement>("editor-load"),
    save: element<HTMLButtonElement>("editor-save"),
    remove: element<HTMLButtonElement>("editor-delete"),
    testBattle: element<HTMLButtonElement>("editor-test-battle"),
    testRace: element<HTMLButtonElement>("editor-test-race"),
    done: element<HTMLButtonElement>("editor-done"),
    status: element<HTMLParagraphElement>("editor-status"),
    hint: element<HTMLParagraphElement>("editor-hint"),
    scroll: element<HTMLInputElement>("editor-scroll"),
  };

  private draft: CustomMap = createEmptyMap();
  private tool: Tool = "wall";
  private undoStack: string[] = [];
  private scrollX = 0;
  private drag: { startX: number; startY: number; x: number; y: number; active: boolean } | null = null;
  private statusTimer = 0;

  constructor(options: EditorOptions) {
    this.options = options;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.bindEvents();
    this.setTool("wall");
  }

  open(): void {
    this.root.hidden = false;
    this.refreshSavedList();
    this.syncControls();
    this.resize();
  }

  close(): void {
    this.root.hidden = true;
    this.options.onClose();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /* ---------- Wiring ---------- */

  private bindEvents(): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
      button.addEventListener("click", () => this.setTool(button.dataset.tool as Tool));
    }

    this.ui.name.addEventListener("input", () => {
      this.draft.name = this.ui.name.value;
    });

    this.ui.width.addEventListener("input", () => this.setWidth(Number(this.ui.width.value)));
    this.ui.palette.addEventListener("change", () => {
      this.draft.palette = this.ui.palette.value as ArenaStyle;
      this.render();
    });

    this.ui.undo.addEventListener("click", () => this.undo());
    this.ui.clear.addEventListener("click", () => this.clear());
    this.ui.save.addEventListener("click", () => this.save());
    this.ui.remove.addEventListener("click", () => this.remove());
    this.ui.done.addEventListener("click", () => this.close());

    this.ui.load.addEventListener("change", () => this.loadSelected());

    this.ui.testBattle.addEventListener("click", () => this.test("battle"));
    this.ui.testRace.addEventListener("click", () => this.test("race"));

    this.ui.scroll.addEventListener("input", () => {
      this.scrollX = Number(this.ui.scroll.value);
      this.render();
    });

    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", () => {
      this.drag = null;
      this.render();
    });

    window.addEventListener("resize", () => {
      if (this.isOpen) this.resize();
    });

    window.addEventListener("keydown", (event) => {
      if (!this.isOpen) return;
      if (event.key === "Escape") {
        this.close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.undo();
      }
    });
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    for (const button of document.querySelectorAll<HTMLButtonElement>(".tool")) {
      button.classList.toggle("is-active", button.dataset.tool === tool);
    }
    // Disabled rather than hidden: removing the field would resize the panel
    // and shift the canvas out from under the cursor.
    this.ui.kind.disabled = tool !== "powerup";
    this.updateHint();
  }

  private syncControls(): void {
    this.ui.name.value = this.draft.name;
    this.ui.width.value = String(this.draft.width);
    this.ui.widthOut.textContent = String(this.draft.width);
    this.ui.palette.value = this.draft.palette;
    this.updateHint();
  }

  /* ---------- Map mutations ---------- */

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.draft));
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) {
      this.setStatus("Nothing to undo");
      return;
    }
    const restored = normalizeMap(JSON.parse(previous));
    if (restored) this.draft = restored;
    this.syncControls();
    this.clampScroll();
    this.render();
  }

  private clear(): void {
    this.pushUndo();
    this.draft.walls = [];
    this.draft.spawnZones = [];
    this.draft.powerUpSpots = [];
    this.setStatus("Cleared");
    this.render();
  }

  private setWidth(width: number): void {
    this.pushUndo();
    // Re-normalizing trims anything the narrower map can no longer hold.
    const resized = normalizeMap({ ...this.draft, width });
    if (resized) this.draft = resized;
    this.ui.widthOut.textContent = String(this.draft.width);
    this.clampScroll();
    this.render();
  }

  private save(): void {
    const name = this.ui.name.value.trim();
    this.draft.name = name.length > 0 ? name : "Untitled map";
    this.ui.name.value = this.draft.name;

    const normalized = normalizeMap(this.draft);
    if (!normalized) {
      this.setStatus("Could not save this map");
      return;
    }
    this.draft = normalized;

    saveMap(cloneMap(this.draft));
    this.refreshSavedList();
    this.ui.load.value = this.draft.id;
    this.options.onMapsChanged();
    this.setStatus(`Saved "${this.draft.name}"`);
  }

  private remove(): void {
    if (!findMap(this.draft.id)) {
      this.setStatus("This map has not been saved yet");
      return;
    }
    deleteMap(this.draft.id);
    this.refreshSavedList();
    this.options.onMapsChanged();
    this.draft = createEmptyMap();
    this.undoStack = [];
    this.syncControls();
    this.render();
    this.setStatus("Map deleted");
  }

  private loadSelected(): void {
    const id = this.ui.load.value;
    if (id === "") {
      this.draft = createEmptyMap();
      this.undoStack = [];
      this.syncControls();
      this.clampScroll();
      this.render();
      this.setStatus("Started a new map");
      return;
    }

    const found = findMap(id);
    if (!found) {
      this.setStatus("That map could not be loaded");
      return;
    }
    this.draft = cloneMap(found);
    this.undoStack = [];
    this.syncControls();
    this.clampScroll();
    this.render();
    this.setStatus(`Loaded "${this.draft.name}"`);
  }

  private test(mode: GameMode): void {
    // Tests run against the current draft, saved or not, but need a stable id.
    if (this.draft.id.length === 0) this.draft.id = createMapId();
    this.options.onTest(cloneMap(this.draft), mode);
    this.root.hidden = true;
  }

  private refreshSavedList(): void {
    const maps = loadMaps();
    const current = this.ui.load.value;

    const options = [new Option("— new map —", "")];
    for (const map of maps) {
      options.push(new Option(map.name, map.id));
    }
    this.ui.load.replaceChildren(...options);
    this.ui.load.value = maps.some((map) => map.id === current) ? current : "";
  }

  /* ---------- Pointer handling ---------- */

  private toMapCoords(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scale = rect.height / this.draft.height;
    return {
      x: this.scrollX + (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  }

  private snap(value: number): number {
    return this.ui.snap.checked ? Math.round(value / GRID) * GRID : Math.round(value);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.toMapCoords(event);
    this.drag = { startX: point.x, startY: point.y, x: point.x, y: point.y, active: true };
    this.render();
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.drag?.active) return;
    const point = this.toMapCoords(event);
    this.drag.x = point.x;
    this.drag.y = point.y;
    this.render();
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.drag?.active) return;
    const drag = this.drag;
    this.drag = null;

    const point = this.toMapCoords(event);
    const travelled = Math.hypot(point.x - drag.startX, point.y - drag.startY);
    const isClick = travelled < CLICK_SLOP;

    if (this.tool === "erase") {
      this.eraseAt(point.x, point.y);
    } else if (this.tool === "powerup") {
      this.addSpot(point.x, point.y);
    } else if (isClick) {
      const size = this.tool === "wall" ? DEFAULT_WALL : DEFAULT_ZONE;
      this.addRect(this.centeredRect(point.x, point.y, size));
    } else {
      this.addRect(this.dragRect(drag.startX, drag.startY, point.x, point.y));
    }

    this.render();
  }

  private centeredRect(x: number, y: number, size: number): Rect {
    return {
      x: this.snap(x - size / 2),
      y: this.snap(y - size / 2),
      width: size,
      height: size,
    };
  }

  private dragRect(startX: number, startY: number, endX: number, endY: number): Rect {
    const x1 = this.snap(Math.min(startX, endX));
    const y1 = this.snap(Math.min(startY, endY));
    const x2 = this.snap(Math.max(startX, endX));
    const y2 = this.snap(Math.max(startY, endY));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  private addRect(rect: Rect): void {
    const minSize = this.tool === "wall" ? MIN_WALL_SIZE : MIN_ZONE_SIZE;
    const clamped = this.clampRect(rect);

    if (clamped.width < minSize || clamped.height < minSize) {
      this.setStatus(this.tool === "wall" ? "That wall is too small" : "That spawn zone is too small");
      return;
    }

    this.pushUndo();
    if (this.tool === "wall") {
      this.draft.walls.push(clamped);
      this.setStatus("Wall added");
    } else {
      this.draft.spawnZones.push(clamped);
      this.setStatus("Spawn zone added");
    }
    this.updateHint();
  }

  private clampRect(rect: Rect): Rect {
    const left = Math.max(0, Math.min(rect.x, this.draft.width));
    const top = Math.max(0, Math.min(rect.y, this.draft.height));
    const right = Math.max(0, Math.min(rect.x + rect.width, this.draft.width));
    const bottom = Math.max(0, Math.min(rect.y + rect.height, this.draft.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  private addSpot(x: number, y: number): void {
    const px = Math.min(Math.max(this.snap(x), 16), this.draft.width - 16);
    const py = Math.min(Math.max(this.snap(y), 16), this.draft.height - 16);

    // A pad buried in a wall could never be collected.
    if (this.draft.walls.some((wall) => rectContains(wall, px, py))) {
      this.setStatus("That spot is inside a wall");
      return;
    }

    this.pushUndo();
    this.draft.powerUpSpots.push({ x: px, y: py, kind: this.ui.kind.value as SpotKind });
    this.setStatus("Power-up pad added");
    this.updateHint();
  }

  /** Removes the topmost item under the cursor, smallest kinds first. */
  private eraseAt(x: number, y: number): void {
    for (let i = this.draft.powerUpSpots.length - 1; i >= 0; i -= 1) {
      const spot = this.draft.powerUpSpots[i];
      if (Math.abs(spot.x - x) <= 16 && Math.abs(spot.y - y) <= 16) {
        this.pushUndo();
        this.draft.powerUpSpots.splice(i, 1);
        this.setStatus("Pad removed");
        this.updateHint();
        return;
      }
    }

    for (let i = this.draft.spawnZones.length - 1; i >= 0; i -= 1) {
      if (rectContains(this.draft.spawnZones[i], x, y)) {
        this.pushUndo();
        this.draft.spawnZones.splice(i, 1);
        this.setStatus("Spawn zone removed");
        this.updateHint();
        return;
      }
    }

    for (let i = this.draft.walls.length - 1; i >= 0; i -= 1) {
      if (rectContains(this.draft.walls[i], x, y)) {
        this.pushUndo();
        this.draft.walls.splice(i, 1);
        this.setStatus("Wall removed");
        this.updateHint();
        return;
      }
    }

    this.setStatus("Nothing there to erase");
  }

  /* ---------- Status and hints ---------- */

  private setStatus(text: string): void {
    this.ui.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.ui.status.textContent = "";
    }, 2600);
  }

  private updateHint(): void {
    const counts = `${this.draft.walls.length} walls · ${this.draft.spawnZones.length} spawn zones · ${this.draft.powerUpSpots.length} pads`;
    const action =
      this.tool === "erase"
        ? "Click an item to delete it."
        : this.tool === "powerup"
          ? "Click to drop a power-up pad."
          : "Drag to draw, or click for a default size.";
    const fallback =
      this.draft.spawnZones.length === 0 ? " No spawn zones yet, so cubes use default positions." : "";

    this.ui.hint.textContent = `${action} ${counts}.${fallback}`;
  }

  /* ---------- Rendering ---------- */

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.clampScroll();
    this.render();
  }

  private visibleWidth(): number {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.height === 0) return this.draft.width;
    return (rect.width / rect.height) * this.draft.height;
  }

  private clampScroll(): void {
    const maxScroll = Math.max(0, Math.round(this.draft.width - this.visibleWidth()));
    this.scrollX = Math.min(this.scrollX, maxScroll);
    this.ui.scroll.max = String(maxScroll);
    this.ui.scroll.value = String(Math.round(this.scrollX));
    this.ui.scroll.disabled = maxScroll === 0;
  }

  private render(): void {
    const { ctx, canvas } = this;
    const theme = themeFor(this.draft.palette);
    const scale = canvas.height / this.draft.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = theme.backdropBottom;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(scale, 0, 0, scale, -this.scrollX * scale, 0);

    const floor = ctx.createLinearGradient(0, 0, this.draft.width * 0.35, this.draft.height);
    floor.addColorStop(0, theme.floorTop);
    floor.addColorStop(1, theme.floorBottom);
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, this.draft.width, this.draft.height);

    this.drawGrid();
    this.drawFinishZone();
    this.drawSpawnZones();
    this.drawWalls();
    this.drawSpots();
    this.drawDragPreview();

    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, this.draft.width, this.draft.height);
  }

  private drawGrid(): void {
    const { ctx } = this;

    ctx.strokeStyle = "rgba(150, 175, 255, 0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID; x < this.draft.width; x += GRID) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.draft.height);
    }
    for (let y = GRID; y < this.draft.height; y += GRID) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.draft.width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(150, 175, 255, 0.2)";
    ctx.beginPath();
    for (let x = 100; x < this.draft.width; x += 100) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.draft.height);
    }
    for (let y = 100; y < this.draft.height; y += 100) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.draft.width, y);
    }
    ctx.stroke();
  }

  private drawFinishZone(): void {
    const { ctx } = this;
    const finishX = mapFinishX(this.draft);

    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = "rgba(244, 247, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(finishX, 0);
    ctx.lineTo(finishX, this.draft.height);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(finishX - 8, this.draft.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "rgba(244, 247, 255, 0.55)";
    ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("RACE FINISH", 0, 0);
    ctx.restore();
  }

  private drawSpawnZones(): void {
    const { ctx } = this;
    for (const zone of this.draft.spawnZones) {
      ctx.fillStyle = "rgba(77, 255, 163, 0.13)";
      ctx.fillRect(zone.x, zone.y, zone.width, zone.height);

      ctx.save();
      ctx.setLineDash([9, 6]);
      ctx.strokeStyle = "rgba(77, 255, 163, 0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
      ctx.restore();

      ctx.fillStyle = "rgba(77, 255, 163, 0.95)";
      ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("SPAWN", zone.x + 6, zone.y + 5);
    }
  }

  private drawWalls(): void {
    const { ctx } = this;
    const theme = themeFor(this.draft.palette);

    this.draft.walls.forEach((wall, index) => {
      ctx.fillStyle = theme.obstacleFills[index % theme.obstacleFills.length];
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
      ctx.strokeStyle = theme.obstacleStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
    });
  }

  private drawSpots(): void {
    const { ctx } = this;
    for (const spot of this.draft.powerUpSpots) {
      const color = SPOT_COLORS[spot.kind];
      const size = 26;

      ctx.fillStyle = color;
      ctx.fillRect(spot.x - size / 2, spot.y - size / 2, size, size);

      ctx.fillStyle = "#08101f";
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(SPOT_GLYPHS[spot.kind], spot.x, spot.y + 1);
    }
  }

  private drawDragPreview(): void {
    if (!this.drag || this.tool === "erase" || this.tool === "powerup") return;
    const { ctx } = this;
    const rect = this.dragRect(this.drag.startX, this.drag.startY, this.drag.x, this.drag.y);
    if (rect.width < 1 || rect.height < 1) return;

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = this.tool === "wall" ? "rgba(255, 255, 255, 0.85)" : "rgba(77, 255, 163, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}
