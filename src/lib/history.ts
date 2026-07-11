import type { Assignment, GenerationHistoryItem } from "../types";

export const GENERATION_HISTORY_KEY = "gubei-prefect-toolkit.generation-history.v1";
export const GENERATION_HISTORY_LIMIT = 20;

export type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const assignment = value as Record<string, unknown>;
  return typeof assignment.person === "string" &&
    Array.isArray(assignment.rooms) &&
    assignment.rooms.every((room) => typeof room === "string");
}

function cloneHistoryItem(item: GenerationHistoryItem): GenerationHistoryItem {
  return {
    ...item,
    assignments: item.assignments.map((assignment) => ({
      ...assignment,
      rooms: assignment.rooms.slice(),
    })),
  };
}

export function isGenerationHistoryItem(value: unknown): value is GenerationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.title === "string" &&
    typeof item.date === "string" &&
    typeof item.code === "string" &&
    Array.isArray(item.assignments) &&
    item.assignments.every(isAssignment);
}

export function readGenerationHistory(storage: HistoryStorage): GenerationHistoryItem[] {
  try {
    const raw = storage.getItem(GENERATION_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isGenerationHistoryItem)
      .slice(0, GENERATION_HISTORY_LIMIT)
      .map(cloneHistoryItem);
  } catch {
    return [];
  }
}

export function readGenerationHistoryFrom(
  getStorage: () => HistoryStorage,
): GenerationHistoryItem[] {
  try {
    return readGenerationHistory(getStorage());
  } catch {
    return [];
  }
}

export function writeGenerationHistory(storage: HistoryStorage, items: GenerationHistoryItem[]): void {
  const itemsToWrite = items
    .slice(0, GENERATION_HISTORY_LIMIT)
    .map(cloneHistoryItem);
  storage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(itemsToWrite));
}

export function mergeGenerationHistory(
  items: GenerationHistoryItem[],
  item: GenerationHistoryItem,
): GenerationHistoryItem[] {
  return [
    cloneHistoryItem(item),
    ...items
      .filter((existing) => existing.code !== item.code)
      .map(cloneHistoryItem),
  ].slice(0, GENERATION_HISTORY_LIMIT);
}

export function formatHistoryLabel(item: GenerationHistoryItem): string {
  const savedAt = new Date(item.savedAt);
  const savedLabel = Number.isNaN(savedAt.getTime())
    ? item.savedAt
    : savedAt.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${item.date} · ${item.title} · ${savedLabel}`;
}
