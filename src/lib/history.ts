import type { Assignment, GenerationHistoryItem } from "../types";

export const LEGACY_GENERATION_HISTORY_KEY = "gubei-prefect-toolkit.generation-history.v1";
export const GENERATION_HISTORY_KEY = "gubei-prefect-toolkit.generation-history.v2";
export const GENERATION_HISTORY_LIMIT = 200;
export const GENERATION_HISTORY_PAGE_SIZE = 20;
export const GENERATION_HISTORY_RETENTION_DAYS = 90;

export type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.person === "string" &&
    Array.isArray(assignment.rooms) &&
    assignment.rooms.every((room) => typeof room === "string");
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function cloneHistoryItem(item: GenerationHistoryItem): GenerationHistoryItem {
  return {
    ...item,
    assignments: item.assignments.map((assignment) => ({
      person: assignment.person,
      rooms: assignment.rooms.slice(),
    })),
  };
}

export function isGenerationHistoryItem(value: unknown): value is GenerationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    typeof item.savedAt === "string" &&
    isOptionalString(item.updatedAt) &&
    isOptionalString(item.expiresAt) &&
    typeof item.title === "string" &&
    typeof item.date === "string" &&
    typeof item.code === "string" &&
    isOptionalString(item.rosterRevision) &&
    isOptionalString(item.editToken) &&
    (item.source === undefined || item.source === "device" || item.source === "shared") &&
    (item.syncStatus === undefined || ["local", "queued", "shared", "failed"].includes(String(item.syncStatus))) &&
    Array.isArray(item.assignments) &&
    item.assignments.every(isAssignment);
}

function parseHistory(raw: string | null): GenerationHistoryItem[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isGenerationHistoryItem).map(cloneHistoryItem);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createEditToken(): string | undefined {
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  } catch {
    return undefined;
  }
}

export function createHistoryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

function normalizeLocalItem(item: GenerationHistoryItem, replaceLegacyId = false): GenerationHistoryItem {
  return {
    ...cloneHistoryItem(item),
    id: replaceLegacyId ? createHistoryId() : item.id,
    updatedAt: item.updatedAt || item.savedAt,
    editToken: item.editToken || createEditToken(),
    source: "device",
    syncStatus: item.syncStatus || "local",
  };
}

function isRetained(item: GenerationHistoryItem, now: Date): boolean {
  const savedAt = new Date(item.savedAt).getTime();
  if (!Number.isFinite(savedAt)) return true;
  return savedAt >= now.getTime() - GENERATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

export function readGenerationHistory(
  storage: HistoryStorage,
  now = new Date(),
): GenerationHistoryItem[] {
  try {
    const currentRaw = storage.getItem(GENERATION_HISTORY_KEY);
    const legacyRaw = currentRaw ? null : storage.getItem(LEGACY_GENERATION_HISTORY_KEY);
    const items = parseHistory(currentRaw || legacyRaw)
      .map((item) => normalizeLocalItem(item, !currentRaw && !!legacyRaw))
      .filter((item) => isRetained(item, now))
      .slice(0, GENERATION_HISTORY_LIMIT);

    if (!currentRaw && legacyRaw) {
      storage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(items));
      storage.removeItem(LEGACY_GENERATION_HISTORY_KEY);
    }
    return items;
  } catch {
    return [];
  }
}

export function readGenerationHistoryFrom(
  getStorage: () => HistoryStorage,
  now = new Date(),
): GenerationHistoryItem[] {
  try {
    return readGenerationHistory(getStorage(), now);
  } catch {
    return [];
  }
}

export function writeGenerationHistory(storage: HistoryStorage, items: GenerationHistoryItem[]): void {
  const itemsToWrite = items
    .slice(0, GENERATION_HISTORY_LIMIT)
    .map((item) => normalizeLocalItem(item));
  storage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(itemsToWrite));
}

export function mergeGenerationHistory(
  items: GenerationHistoryItem[],
  item: GenerationHistoryItem,
): GenerationHistoryItem[] {
  return [
    cloneHistoryItem(item),
    ...items
      .filter((existing) => existing.id !== item.id)
      .map(cloneHistoryItem),
  ].slice(0, GENERATION_HISTORY_LIMIT);
}

export function mergeLocalAndSharedHistory(
  localItems: GenerationHistoryItem[],
  sharedItems: GenerationHistoryItem[],
): GenerationHistoryItem[] {
  const localIds = new Set(localItems.map((item) => item.id));
  return [...localItems, ...sharedItems.filter((item) => !localIds.has(item.id))]
    .map(cloneHistoryItem)
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.savedAt).getTime();
      const rightTime = new Date(right.updatedAt || right.savedAt).getTime();
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, GENERATION_HISTORY_LIMIT);
}

export function formatHistoryLabel(item: GenerationHistoryItem): string {
  const savedAt = new Date(item.savedAt);
  const savedLabel = Number.isNaN(savedAt.getTime())
    ? item.savedAt
    : savedAt.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${item.date} · ${item.title} · ${savedLabel}`;
}
