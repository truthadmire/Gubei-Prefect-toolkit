import { describe, expect, it } from "vitest";
import type { RosterJson } from "../types";
import { packRotaCodeV2 } from "./rota";
import { computeRosterRevision } from "./roster-revision";
import { validateSharedHistoryPayload } from "./shared-history-validation";

const roster: Pick<RosterJson, "people" | "rooms"> = {
  people: [{ name: "Alice", dept: "Academia" }, { name: "Bob", dept: "Charity" }],
  rooms: [{ id: "N201", form: "9A" }, { id: "N202", form: "9B" }],
};
const now = new Date("2026-08-20T02:00:00.000Z");

async function validPayload() {
  const assignments = [{ person: "Alice", rooms: ["N201"] }];
  return {
    id: "40fdf22f-b96c-46a7-b575-dbd1e06d23f2",
    title: " Morning rota ",
    date: "2026-08-20",
    code: await packRotaCodeV2({ date: "2026-08-20", assignments }),
    assignments,
    rosterRevision: await computeRosterRevision(roster.people, roster.rooms),
    savedAt: "2026-08-20T01:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
  };
}

describe("shared history payload validation", () => {
  it("normalizes and accepts a current, code-consistent record", async () => {
    const result = await validateSharedHistoryPayload(await validPayload(), roster, now);

    expect(result).toMatchObject({ ok: true, value: { title: "Morning rota" } });
  });

  it("rejects a stale roster revision", async () => {
    const result = await validateSharedHistoryPayload({
      ...await validPayload(),
      rosterRevision: "0".repeat(64),
    }, roster, now);

    expect(result).toEqual({ ok: false, reason: "roster-revision" });
  });

  it("rejects duplicate rooms and unknown people", async () => {
    const base = await validPayload();
    const duplicateRooms = [
      { person: "Alice", rooms: ["N201"] },
      { person: "Bob", rooms: ["N201"] },
    ];
    const duplicateCode = await packRotaCodeV2({ date: base.date, assignments: duplicateRooms });

    await expect(validateSharedHistoryPayload({ ...base, assignments: duplicateRooms, code: duplicateCode }, roster, now))
      .resolves.toEqual({ ok: false, reason: "room" });
    await expect(validateSharedHistoryPayload({
      ...base,
      assignments: [{ person: "Unknown", rooms: ["N201"] }],
      code: await packRotaCodeV2({ date: base.date, assignments: [{ person: "Unknown", rooms: ["N201"] }] }),
    }, roster, now)).resolves.toEqual({ ok: false, reason: "person" });
  });

  it("rejects a code that does not describe the submitted assignment", async () => {
    const base = await validPayload();
    const result = await validateSharedHistoryPayload({
      ...base,
      assignments: [{ person: "Bob", rooms: ["N202"] }],
    }, roster, now);

    expect(result).toEqual({ ok: false, reason: "code-mismatch" });
  });

  it("rejects records older than ninety days", async () => {
    const result = await validateSharedHistoryPayload({
      ...await validPayload(),
      savedAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:00.000Z",
    }, roster, now);

    expect(result).toEqual({ ok: false, reason: "timestamp" });
  });
});
