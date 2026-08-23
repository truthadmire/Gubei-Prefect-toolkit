import { isGenerationHistoryItem, type HistoryStorage } from "./history";
import type { Assignment, GenerationHistoryItem } from "../types";

export const SHARED_HISTORY_ENABLED = process.env.NEXT_PUBLIC_SHARED_HISTORY_ENABLED === "true";
export const SHARED_HISTORY_OUTBOX_KEY = "gubei-prefect-toolkit.shared-history-outbox.v1";
export const SHARED_HISTORY_PAGE_SIZE = 50;

export type SharedHistoryPayload = {
  id: string;
  title: string;
  date: string;
  code: string;
  assignments: Assignment[];
  rosterRevision: string;
  savedAt: string;
  updatedAt: string;
};

export type SharedHistoryOutboxItem = {
  id: string;
  operation: "create" | "update";
  editToken: string;
  payload: SharedHistoryPayload;
  attempts: number;
  nextAttemptAt: string;
};

export type SharedHistorySyncResult = {
  id: string;
  status: "shared" | "failed";
  item?: GenerationHistoryItem;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function cloneAssignments(assignments: Assignment[]): Assignment[] {
  return assignments.map((assignment) => ({ person: assignment.person, rooms: assignment.rooms.slice() }));
}

function isOutboxItem(value: unknown): value is SharedHistoryOutboxItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const payload = item.payload as Record<string, unknown> | undefined;
  return typeof item.id === "string" &&
    (item.operation === "create" || item.operation === "update") &&
    typeof item.editToken === "string" &&
    typeof item.attempts === "number" &&
    typeof item.nextAttemptAt === "string" &&
    !!payload &&
    typeof payload.id === "string" &&
    typeof payload.title === "string" &&
    typeof payload.date === "string" &&
    typeof payload.code === "string" &&
    typeof payload.rosterRevision === "string" &&
    typeof payload.savedAt === "string" &&
    typeof payload.updatedAt === "string" &&
    Array.isArray(payload.assignments);
}

export function readSharedHistoryOutbox(storage: HistoryStorage): SharedHistoryOutboxItem[] {
  try {
    const raw = storage.getItem(SHARED_HISTORY_OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOutboxItem) : [];
  } catch {
    return [];
  }
}

function writeSharedHistoryOutbox(storage: HistoryStorage, items: SharedHistoryOutboxItem[]): void {
  try {
    if (items.length === 0) storage.removeItem(SHARED_HISTORY_OUTBOX_KEY);
    else storage.setItem(SHARED_HISTORY_OUTBOX_KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    // Local history remains authoritative when storage is unavailable.
  }
}

function isSameQueuedVersion(left: SharedHistoryOutboxItem, right: SharedHistoryOutboxItem): boolean {
  return left.operation === right.operation &&
    left.editToken === right.editToken &&
    JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

export function queueSharedHistoryItem(
  storage: HistoryStorage,
  item: GenerationHistoryItem,
  now = new Date(),
): GenerationHistoryItem {
  if (!item.editToken || !item.rosterRevision) return { ...item, syncStatus: "local", source: "device" };
  const existing = readSharedHistoryOutbox(storage);
  const previous = existing.find((entry) => entry.id === item.id);
  const operation = previous?.operation === "create" || item.syncStatus !== "shared" ? "create" : "update";
  const payload: SharedHistoryPayload = {
    id: item.id,
    title: item.title,
    date: item.date,
    code: item.code,
    assignments: cloneAssignments(item.assignments),
    rosterRevision: item.rosterRevision,
    savedAt: item.savedAt,
    updatedAt: item.updatedAt || now.toISOString(),
  };
  const queued: SharedHistoryOutboxItem = {
    id: item.id,
    operation,
    editToken: item.editToken,
    payload,
    attempts: previous?.attempts || 0,
    nextAttemptAt: now.toISOString(),
  };
  writeSharedHistoryOutbox(storage, [queued, ...existing.filter((entry) => entry.id !== item.id)]);
  return { ...item, source: "device", syncStatus: "queued" };
}

function sharedItemFromResponse(value: unknown): GenerationHistoryItem | null {
  if (!isGenerationHistoryItem(value)) return null;
  return {
    ...value,
    assignments: cloneAssignments(value.assignments),
    source: "shared",
    syncStatus: "shared",
    editToken: undefined,
  };
}

export async function syncQueuedSharedHistory(
  storage: HistoryStorage,
  fetcher: Fetcher = fetch,
  now = new Date(),
): Promise<SharedHistorySyncResult[]> {
  const entries = readSharedHistoryOutbox(storage);
  const results: SharedHistorySyncResult[] = [];

  for (const initialEntry of entries) {
    const entry = readSharedHistoryOutbox(storage).find((candidate) => candidate.id === initialEntry.id);
    if (!entry) continue;
    const nextAttempt = new Date(entry.nextAttemptAt).getTime();
    if (Number.isFinite(nextAttempt) && nextAttempt > now.getTime()) continue;
    const url = entry.operation === "create" ? "/api/shared-history" : `/api/shared-history/${entry.id}`;
    const method = entry.operation === "create" ? "POST" : "PATCH";
    try {
      const response = await fetcher(url, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${entry.editToken}`,
        },
        body: JSON.stringify(entry.payload),
      });
      if (!response.ok) throw new Error(`sync-${response.status}`);
      const body = await response.json() as { item?: unknown };
      const remote = sharedItemFromResponse(body.item);
      if (!remote) throw new Error("sync-response");

      const latest = readSharedHistoryOutbox(storage);
      const index = latest.findIndex((candidate) => candidate.id === entry.id);
      const hasNewerVersion = index >= 0 && !isSameQueuedVersion(latest[index], entry);
      if (index >= 0) {
        if (hasNewerVersion) {
          latest[index] = {
            ...latest[index],
            operation: entry.operation === "create" ? "update" : latest[index].operation,
            attempts: 0,
            nextAttemptAt: now.toISOString(),
          };
        } else {
          latest.splice(index, 1);
        }
        writeSharedHistoryOutbox(storage, latest);
      }
      if (!hasNewerVersion) results.push({ id: entry.id, status: "shared", item: remote });
    } catch {
      const latest = readSharedHistoryOutbox(storage);
      const index = latest.findIndex((candidate) => candidate.id === entry.id);
      if (index >= 0) {
        const attempts = latest[index].attempts + 1;
        const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(attempts - 1, 6));
        latest[index] = {
          ...latest[index],
          attempts,
          nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
        };
        writeSharedHistoryOutbox(storage, latest);
      }
      results.push({ id: entry.id, status: "failed" });
    }
  }

  return results;
}

export type SharedHistoryPage = {
  items: GenerationHistoryItem[];
  nextCursor: string | null;
};

export async function fetchSharedHistoryPage(
  cursor: string | null = null,
  query = "",
  fetcher: Fetcher = fetch,
): Promise<SharedHistoryPage> {
  const params = new URLSearchParams({ limit: String(SHARED_HISTORY_PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  if (query.trim()) params.set("q", query.trim());
  const response = await fetcher(`/api/shared-history?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`shared-history-${response.status}`);
  const body = await response.json() as { items?: unknown; nextCursor?: unknown };
  const items = Array.isArray(body.items)
    ? body.items.map(sharedItemFromResponse).filter((item): item is GenerationHistoryItem => !!item)
    : [];
  return {
    items,
    nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null,
  };
}
