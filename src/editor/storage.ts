import { normalizeMap, type CustomMap } from "../sim/map";

const STORAGE_KEY = "cube-arena.maps.v1";

/** Reads saved maps, discarding anything that no longer parses. */
export function loadMaps(): CustomMap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => normalizeMap(entry))
      .filter((map): map is CustomMap => map !== null);
  } catch {
    return [];
  }
}

function writeMaps(maps: CustomMap[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  } catch {
    // Private browsing or a full quota: the editor still works for this session.
  }
}

/** Inserts or replaces a map, keeping the list sorted by name. */
export function saveMap(map: CustomMap): CustomMap[] {
  const maps = loadMaps();
  const index = maps.findIndex((entry) => entry.id === map.id);
  if (index === -1) {
    maps.push(map);
  } else {
    maps[index] = map;
  }
  maps.sort((a, b) => a.name.localeCompare(b.name));
  writeMaps(maps);
  return maps;
}

export function deleteMap(id: string): CustomMap[] {
  const maps = loadMaps().filter((entry) => entry.id !== id);
  writeMaps(maps);
  return maps;
}

export function findMap(id: string): CustomMap | null {
  return loadMaps().find((entry) => entry.id === id) ?? null;
}
