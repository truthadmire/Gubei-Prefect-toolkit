import { describe, expect, it } from "vitest";
import type { Assignment, Person, Room } from "../types";
import {
  applyImportedAssignments,
  generateAssignment,
  packRotaCodeV2,
  pairKey,
  parseRoomId,
  unpackRotaCodeCompat,
  unpackRotaCodeV2,
} from "./rota";

function person(name: string, canDouble = true): Person {
  return {
    id: `person-${name.trim().toLowerCase().replace(/\s+/g, "-")}`,
    name,
    dept: "Test",
    active: true,
    canDouble,
    assignedCount: 0,
  };
}

function room(id: string, form: string): Room {
  const parsed = parseRoomId(id);
  if (!parsed) throw new Error(`Invalid room fixture: ${id}`);
  return { id, form, ...parsed, enabled: true };
}

function changeCharacter(value: string, index: number): string {
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

describe("parseRoomId", () => {
  it("parses a compact room ID", () => {
    expect(parseRoomId(" n203 ")).toEqual({ building: "N", number: 203, floor: 2 });
  });

  it("rejects a room ID containing spaces", () => {
    expect(parseRoomId("North 203")).toBeNull();
  });
});

describe("generateAssignment", () => {
  it("covers every enabled room exactly once without mutating its inputs", () => {
    const people = [person("Alice"), person("Bob")];
    const rooms = [room("N201", "9A"), room("N202", "9B"), room("N203", "9C")];
    const peopleBefore = structuredClone(people);
    const roomsBefore = structuredClone(rooms);

    const assignments = generateAssignment(people, rooms, null, false);
    const assignedRoomIds = assignments.flatMap((assignment) => assignment.rooms);

    expect(assignedRoomIds.slice().sort()).toEqual(rooms.map(({ id }) => id).sort());
    expect(new Set(assignedRoomIds)).toHaveLength(rooms.length);
    expect(people).toEqual(peopleBefore);
    expect(rooms).toEqual(roomsBefore);
  });

  it("never includes inactive people or disabled rooms", () => {
    const inactive = { ...person("Inactive"), active: false };
    const disabled = { ...room("N202", "9B"), enabled: false };

    const assignments = generateAssignment(
      [person("Active"), inactive],
      [room("N201", "9A"), disabled],
      null,
      false,
    );

    expect(assignments).toEqual([{ person: "Active", rooms: ["N201"] }]);
  });

  it("gives a paired slot only to a person enabled for double duty", () => {
    const assignments = generateAssignment(
      [person("Can Double"), person("Single Only", false)],
      [room("N201", "9A"), room("N202", "9B"), room("N203", "9C")],
      null,
      false,
    );

    expect(assignments.find(({ person: name }) => name === "Single Only")?.rooms).toHaveLength(1);
    expect(assignments.filter(({ rooms }) => rooms.length === 2)).toEqual([
      { person: "Can Double", rooms: ["N201", "N202"] },
    ]);
  });

  it("avoids previous rooms when alternatives exist", () => {
    const alice = { ...person("Alice"), lastRooms: ["N201"] };
    const bob = { ...person("Bob"), lastRooms: ["N202"] };

    const assignments = generateAssignment(
      [alice, bob],
      [room("N201", "9A"), room("N202", "9B")],
      null,
      false,
    );

    expect(assignments).toEqual([
      { person: "Alice", rooms: ["N202"] },
      { person: "Bob", rooms: ["N201"] },
    ]);
  });

  it("avoids a previous room pair when an alternative exists", () => {
    const previousPair = pairKey("N201", "N202");
    const alice = { ...person("Alice"), lastPairKey: previousPair };

    const assignments = generateAssignment(
      [alice, person("Bob")],
      [room("N201", "9A"), room("N202", "9B"), room("N203", "9C")],
      null,
      false,
    );

    expect(assignments.find(({ person: name }) => name === "Alice")?.rooms).toEqual(["N203"]);
    expect(assignments.find(({ person: name }) => name === "Bob")?.rooms).toEqual(["N201", "N202"]);
  });

  it("keeps Hepburn He away from Grade 12 forms when another person is eligible", () => {
    const rooms = [room("N201", "12A"), room("N202", "11A")];
    const assignments = generateAssignment(
      [person("  hEpBuRn He  "), person("Eligible")],
      rooms,
      null,
      false,
    );
    const roomById = new Map(rooms.map((item) => [item.id, item]));
    const hepburnAssignment = assignments.find(({ person: name }) => name === "  hEpBuRn He  ");

    expect(hepburnAssignment?.rooms).toHaveLength(1);
    expect(hepburnAssignment?.rooms.some((id) => roomById.get(id)?.form?.startsWith("12"))).toBe(false);
  });

  it("returns an empty assignment when there are no active people", () => {
    expect(generateAssignment([{ ...person("Inactive"), active: false }], [room("N201", "9A")], null, false)).toEqual([]);
  });

  it("returns an empty assignment when there are no enabled rooms", () => {
    expect(generateAssignment([person("Alice")], [{ ...room("N201", "9A"), enabled: false }], null, false)).toEqual([]);
  });
});

describe("rota codes", () => {
  it("round-trips Unicode names, a date, and paired rooms in v2", async () => {
    const payload = {
      date: "2026-07-11",
      assignments: [
        { person: "陈晓明", rooms: ["N201", "N202"] },
        { person: "Zoë", rooms: ["S301"] },
      ],
    };

    const code = await packRotaCodeV2(payload);

    await expect(unpackRotaCodeV2(code)).resolves.toEqual(payload);
  });

  it("rejects a one-character payload change with a CRC mismatch", async () => {
    const code = await packRotaCodeV2({ date: "2026-07-11", assignments: [] });
    const [prefix, payload, crc] = code.split(".");
    const changed = `${prefix}.${changeCharacter(payload, 0)}.${crc}`;

    await expect(unpackRotaCodeV2(changed)).rejects.toThrow("CRC mismatch");
  });

  it("rejects a one-character CRC change with a CRC mismatch", async () => {
    const code = await packRotaCodeV2({ date: "2026-07-11", assignments: [] });
    const [prefix, payload, crc] = code.split(".");
    const changed = `${prefix}.${payload}.${changeCharacter(crc, 0)}`;

    await expect(unpackRotaCodeV2(changed)).rejects.toThrow("CRC mismatch");
  });

  it("rejects an unknown rota code prefix", async () => {
    await expect(unpackRotaCodeCompat("ROTAv3.payload.12345678")).rejects.toThrow("Unknown code");
  });

  it.each([
    "ROTAv2.payload",
    "ROTAv2.payload.12345678.extra",
  ])("rejects malformed segment count in %s", async (code) => {
    await expect(unpackRotaCodeV2(code)).rejects.toThrow("Malformed");
  });

  it.each([
    "ROTAv1.eyJkYXRlIjoiMjAyNi0wNy0xMSIsImFzc2lnbm1lbnRzIjpbeyJwZXJzb24iOiJIaXN0b3JpYyIsInJvb21zIjpbIk4yMDEiLCJOMjAyIl19XX0.868849C0",
    "ROTAv1.FcsxCsAgDAXQu_xZIWZowRN08gLFQVopDppi3MS7l86PN3GnkeHBxJul3ToHg6RanlZzGwp_Try5qzR4HEWH9HLBoIvUXxGY_hOYGHHF9QE.8EB5DC60",
  ])("decodes an exact v1 fixture", async (code) => {
    await expect(unpackRotaCodeCompat(code)).resolves.toEqual({
      date: "2026-07-11",
      assignments: [{ person: "Historic", rooms: ["N201", "N202"] }],
    });
  });

  it.each([
    { assignments: [{ person: 123, rooms: ["N201"] }] },
    { assignments: [{ person: "Alice", rooms: "N201" }] },
    { assignments: [{ person: "Alice", rooms: ["N201", 202] }] },
    { date: 20260711, assignments: [] },
  ])("rejects a structurally invalid decoded payload", async (payload) => {
    const code = await packRotaCodeV2(payload as never);

    await expect(unpackRotaCodeV2(code)).rejects.toThrow("Invalid rota payload");
  });
});

describe("applyImportedAssignments", () => {
  it("immutably updates known people, clones rooms, and ignores unknown names", () => {
    const people = [
      person("Alice"),
      { ...person("Bob"), lastRooms: ["N299"], lastPairKey: pairKey("N298", "N299") },
      person("Charlie"),
    ];
    const assignments: Assignment[] = [
      { person: "Alice", rooms: ["N201", "N202"] },
      { person: "Bob", rooms: ["N203"] },
      { person: "Unknown", rooms: ["N204"] },
    ];
    const peopleBefore = structuredClone(people);

    const updated = applyImportedAssignments(people, assignments);

    expect(updated).not.toBe(people);
    expect(updated[0]).toMatchObject({ lastRooms: ["N201", "N202"], lastPairKey: pairKey("N201", "N202") });
    expect(updated[1]).toMatchObject({ lastRooms: ["N203"], lastPairKey: undefined });
    expect(updated[2]).toEqual(people[2]);
    expect(people).toEqual(peopleBefore);

    assignments[0].rooms.push("N299");
    expect(updated[0].lastRooms).toEqual(["N201", "N202"]);
  });
});
