import { describe, expect, it, vi } from "vitest";
import type { GenerationHistoryItem } from "../types";
import type { HistoryStorage } from "./history";
import {
  fetchSharedHistoryPage,
  queueSharedHistoryItem,
  readSharedHistoryOutbox,
  SHARED_HISTORY_OUTBOX_KEY,
  syncQueuedSharedHistory,
} from "./shared-history-client";

function storageFixture(): HistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function item(overrides: Partial<GenerationHistoryItem> = {}): GenerationHistoryItem {
  return {
    id: "40fdf22f-b96c-46a7-b575-dbd1e06d23f2",
    savedAt: "2026-08-20T01:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
    title: "Morning",
    date: "2026-08-20",
    code: "ROTAv2.code.crc",
    assignments: [{ person: "A", rooms: ["N201"] }],
    rosterRevision: "a".repeat(64),
    editToken: "secret-capability",
    source: "device",
    syncStatus: "local",
    ...overrides,
  };
}

describe("shared history outbox", () => {
  it("coalesces multiple unsynced updates into one latest create", () => {
    const storage = storageFixture();
    const first = queueSharedHistoryItem(storage, item(), new Date("2026-08-20T01:00:00Z"));
    const second = queueSharedHistoryItem(storage, item({
      title: "Updated",
      code: "ROTAv2.updated.crc",
      syncStatus: first.syncStatus,
    }), new Date("2026-08-20T01:00:01Z"));

    expect(second.syncStatus).toBe("queued");
    expect(readSharedHistoryOutbox(storage)).toEqual([
      expect.objectContaining({ operation: "create", payload: expect.objectContaining({ title: "Updated" }) }),
    ]);
  });

  it("uses PATCH after a published session changes and removes a successful entry", async () => {
    const storage = storageFixture();
    queueSharedHistoryItem(storage, item({ syncStatus: "shared" }), new Date("2026-08-20T01:00:00Z"));
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      item: { ...item(), editToken: undefined, source: "shared", syncStatus: "shared" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const results = await syncQueuedSharedHistory(storage, fetcher, new Date("2026-08-20T01:00:00Z"));

    expect(fetcher).toHaveBeenCalledWith(
      "/api/shared-history/40fdf22f-b96c-46a7-b575-dbd1e06d23f2",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(results).toEqual([expect.objectContaining({ status: "shared" })]);
    expect(storage.getItem(SHARED_HISTORY_OUTBOX_KEY)).toBeNull();
  });

  it("retains a failed request with bounded backoff", async () => {
    const storage = storageFixture();
    queueSharedHistoryItem(storage, item(), new Date("2026-08-20T01:00:00Z"));

    const results = await syncQueuedSharedHistory(
      storage,
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
      new Date("2026-08-20T01:00:00Z"),
    );

    expect(results).toEqual([{ id: item().id, status: "failed" }]);
    expect(readSharedHistoryOutbox(storage)[0]).toMatchObject({
      attempts: 1,
      nextAttemptAt: "2026-08-20T01:00:05.000Z",
    });
  });

  it("preserves an update queued while an earlier create is in flight", async () => {
    const storage = storageFixture();
    queueSharedHistoryItem(storage, item(), new Date("2026-08-20T01:00:00Z"));
    const fetcher = vi.fn(async () => {
      queueSharedHistoryItem(storage, item({
        title: "Updated while publishing",
        code: "ROTAv2.updated.crc",
        updatedAt: "2026-08-20T01:00:01.000Z",
        syncStatus: "queued",
      }), new Date("2026-08-20T01:00:01Z"));
      return new Response(JSON.stringify({
        item: { ...item(), editToken: undefined, source: "shared", syncStatus: "shared" },
      }), { status: 201, headers: { "content-type": "application/json" } });
    });

    const results = await syncQueuedSharedHistory(storage, fetcher, new Date("2026-08-20T01:00:00Z"));

    expect(results).toEqual([]);
    expect(readSharedHistoryOutbox(storage)).toEqual([
      expect.objectContaining({
        operation: "update",
        attempts: 0,
        payload: expect.objectContaining({ title: "Updated while publishing" }),
      }),
    ]);
  });
});

describe("shared history feed", () => {
  it("loads public records and forwards a cursor without exposing an edit token", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ ...item(), editToken: undefined }],
      nextCursor: "next-page",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const page = await fetchSharedHistoryPage("cursor", "Morning", fetcher);

    expect(fetcher.mock.calls[0][0]).toContain("cursor=cursor");
    expect(fetcher.mock.calls[0][0]).toContain("q=Morning");
    expect(page.nextCursor).toBe("next-page");
    expect(page.items[0]).toMatchObject({ source: "shared", syncStatus: "shared", editToken: undefined });
  });
});
