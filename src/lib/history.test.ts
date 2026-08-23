import { describe, expect, it } from "vitest";
import type { GenerationHistoryItem } from "../types";
import {
  GENERATION_HISTORY_KEY,
  GENERATION_HISTORY_LIMIT,
  LEGACY_GENERATION_HISTORY_KEY,
  formatHistoryLabel,
  isGenerationHistoryItem,
  mergeGenerationHistory,
  readGenerationHistory,
  readGenerationHistoryFrom,
  writeGenerationHistory,
} from "./history";
import type { HistoryStorage } from "./history";

function historyItem(id: string, code = `code-${id}`): GenerationHistoryItem {
  return {
    id,
    savedAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    title: `Rota ${id}`,
    date: "2026-07-11",
    code,
    assignments: [{ person: "A", rooms: ["N201"] }],
    editToken: "test-edit-token",
    source: "device",
    syncStatus: "local",
  };
}

function memoryStorage(raw: string | null = null, key = GENERATION_HISTORY_KEY): {
  storage: HistoryStorage;
  readRaw: () => string | null;
} {
  const values = new Map<string, string>();
  if (raw !== null) values.set(key, raw);

  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    readRaw: () => values.get(GENERATION_HISTORY_KEY) ?? null,
  };
}

describe("history constants", () => {
  it("uses the v2 storage key and a 200-item device limit", () => {
    expect(GENERATION_HISTORY_KEY).toBe("gubei-prefect-toolkit.generation-history.v2");
    expect(LEGACY_GENERATION_HISTORY_KEY).toBe("gubei-prefect-toolkit.generation-history.v1");
    expect(GENERATION_HISTORY_LIMIT).toBe(200);
  });
});

describe("isGenerationHistoryItem", () => {
  it("accepts a complete history item", () => {
    expect(isGenerationHistoryItem(historyItem("valid"))).toBe(true);
  });

  it.each([
    [{ person: 7, rooms: ["N201"] }],
    [{ person: "A", rooms: "N201" }],
    [{ person: "A", rooms: ["N201", 202] }],
    [null],
  ])("rejects malformed nested assignments %#", (assignments) => {
    expect(isGenerationHistoryItem({ ...historyItem("invalid"), assignments })).toBe(false);
  });
});

describe("readGenerationHistory", () => {
  it("returns an empty list for missing data", () => {
    expect(readGenerationHistory(memoryStorage().storage)).toEqual([]);
  });

  it("returns an empty list for corrupt JSON", () => {
    expect(readGenerationHistory(memoryStorage("not-json").storage)).toEqual([]);
  });

  it("retains only valid entries in their original order", () => {
    const first = historyItem("first");
    const second = historyItem("second");
    const invalid = { ...historyItem("invalid"), assignments: [{ person: "A", rooms: [201] }] };
    const { storage } = memoryStorage(JSON.stringify([first, invalid, second]));

    expect(readGenerationHistory(storage, new Date("2026-08-01"))).toEqual([first, second]);
  });

  it("returns only the first 200 valid entries", () => {
    const items = Array.from({ length: 205 }, (_, index) => historyItem(String(index)));
    const { storage } = memoryStorage(JSON.stringify(items));

    expect(readGenerationHistory(storage, new Date("2026-08-01")).map(({ id }) => id)).toEqual(
      items.slice(0, GENERATION_HISTORY_LIMIT).map(({ id }) => id),
    );
  });

  it("migrates valid v1 entries into v2 storage and removes the legacy key", () => {
    const legacy = {
      id: "legacy",
      savedAt: "2026-07-11T00:00:00.000Z",
      title: "Legacy rota",
      date: "2026-07-11",
      code: "legacy-code",
      assignments: [{ person: "A", rooms: ["N201"] }],
    };
    const values = new Map([[LEGACY_GENERATION_HISTORY_KEY, JSON.stringify([legacy])]]);
    const storage: HistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };

    const migrated = readGenerationHistory(storage, new Date("2026-08-01"));

    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({ source: "device", syncStatus: "local" });
    expect(migrated[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(migrated[0].editToken).toHaveLength(43);
    expect(values.has(LEGACY_GENERATION_HISTORY_KEY)).toBe(false);
    expect(values.has(GENERATION_HISTORY_KEY)).toBe(true);
  });

  it("drops records outside the 90-day retention window", () => {
    const recent = historyItem("recent");
    const expired = { ...historyItem("expired"), savedAt: "2026-04-01T00:00:00.000Z" };
    const { storage } = memoryStorage(JSON.stringify([recent, expired]));

    expect(readGenerationHistory(storage, new Date("2026-08-01"))).toEqual([recent]);
  });

  it("returns an empty list when storage reading fails", () => {
    const storage: HistoryStorage = {
      getItem: () => {
        throw new Error("read failed");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(readGenerationHistory(storage)).toEqual([]);
  });
});

describe("readGenerationHistoryFrom", () => {
  it("returns an empty list when acquiring storage fails", () => {
    expect(readGenerationHistoryFrom(() => {
      throw new Error("storage unavailable");
    })).toEqual([]);
  });
});

describe("writeGenerationHistory", () => {
  it("writes only the first 200 entries", () => {
    const items = Array.from({ length: 205 }, (_, index) => historyItem(String(index)));
    const target = memoryStorage();

    writeGenerationHistory(target.storage, items);

    const written = JSON.parse(target.readRaw() ?? "null") as GenerationHistoryItem[];
    expect(written.map(({ id }) => id)).toEqual(
      items.slice(0, GENERATION_HISTORY_LIMIT).map(({ id }) => id),
    );
  });

  it("serializes assignments and rooms independently from later input mutation", () => {
    const item = historyItem("stored");
    const target = memoryStorage();

    writeGenerationHistory(target.storage, [item]);
    item.assignments[0].person = "Changed";
    item.assignments[0].rooms.push("N202");

    expect(JSON.parse(target.readRaw() ?? "null")).toEqual([historyItem("stored")]);
  });

  it("allows storage write failures to propagate", () => {
    const storage: HistoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("write failed");
      },
      removeItem: () => undefined,
    };

    expect(() => writeGenerationHistory(storage, [historyItem("write")])).toThrow("write failed");
  });
});

describe("mergeGenerationHistory", () => {
  it("puts an updated session first, replaces the same id, and caps at 200", () => {
    const duplicate = historyItem("same-session", "old-code");
    const existing = [
      historyItem("first"),
      duplicate,
      ...Array.from({ length: 202 }, (_, index) => historyItem(`tail-${index}`)),
    ];
    const newest = historyItem("same-session", "new-code");

    const merged = mergeGenerationHistory(existing, newest);

    expect(merged).toHaveLength(GENERATION_HISTORY_LIMIT);
    expect(merged[0]).toEqual(newest);
    expect(merged.filter(({ id }) => id === duplicate.id)).toHaveLength(1);
    expect(merged.slice(1).map(({ id }) => id)).toEqual(
      existing.filter(({ id }) => id !== newest.id).slice(0, GENERATION_HISTORY_LIMIT - 1).map(({ id }) => id),
    );
  });

  it("deeply clones the new and retained assignments", () => {
    const retained = historyItem("retained");
    const newest = historyItem("newest");

    const merged = mergeGenerationHistory([retained], newest);
    newest.assignments[0].person = "Changed newest";
    newest.assignments[0].rooms.push("N202");
    retained.assignments[0].person = "Changed retained";
    retained.assignments[0].rooms.push("N203");

    expect(merged).toEqual([historyItem("newest"), historyItem("retained")]);
    expect(merged[0].assignments).not.toBe(newest.assignments);
    expect(merged[1].assignments).not.toBe(retained.assignments);
    expect(merged[0].assignments[0].rooms).not.toBe(newest.assignments[0].rooms);
    expect(merged[1].assignments[0].rooms).not.toBe(retained.assignments[0].rooms);
  });
});

describe("formatHistoryLabel", () => {
  it("includes stable date and title components without assuming a locale or timezone", () => {
    const label = formatHistoryLabel(historyItem("label"));

    expect(label).toContain("2026-07-11");
    expect(label).toContain("Rota label");
    expect(label.split(" · ")).toHaveLength(3);
  });

  it("uses the original saved value when it is not a valid timestamp", () => {
    const item = { ...historyItem("invalid-date"), savedAt: "not-a-date" };

    expect(formatHistoryLabel(item)).toBe("2026-07-11 · Rota invalid-date · not-a-date");
  });
});
