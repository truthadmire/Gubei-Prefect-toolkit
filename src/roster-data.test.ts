import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPT_STYLE, normalizeDept } from "./lib/departments";
import { getGenerationSummary, parseRoomId } from "./lib/rota";
import type { Person, Room } from "./types";

type RosterData = {
  people: Array<{ name: string; dept: string }>;
  rooms: Array<{ id: string; form: string }>;
};

const roster = JSON.parse(
  readFileSync(resolve(process.cwd(), "public/roster.json"), "utf8"),
) as RosterData;

describe("public roster data", () => {
  it("has unique, trimmed prefect names with supported departments", () => {
    expect(Array.isArray(roster.people)).toBe(true);
    expect(roster.people.length).toBeGreaterThan(0);

    const normalizedNames = roster.people.map(({ name, dept }) => {
      expect(name).toBe(name.trim());
      expect(name.length).toBeGreaterThan(0);
      expect(dept).toBe(dept.trim());
      expect(DEPT_STYLE[normalizeDept(dept)], `${name} has unsupported department: ${dept}`).toBeDefined();
      return name.toLocaleLowerCase("en");
    });

    expect(new Set(normalizedNames).size).toBe(normalizedNames.length);
  });

  it("has unique, well-formed room IDs and non-empty forms", () => {
    expect(Array.isArray(roster.rooms)).toBe(true);
    expect(roster.rooms.length).toBeGreaterThan(0);

    const roomIds = roster.rooms.map(({ id, form }) => {
      expect(id).toMatch(/^[A-Za-z]+\d{3}$/);
      expect(form.trim().length).toBeGreaterThan(0);
      return id.toLocaleUpperCase("en");
    });

    expect(new Set(roomIds).size).toBe(roomIds.length);
  });

  it("can generate a feasible rota with the current prefects and rooms", () => {
    const people: Person[] = roster.people.map(({ name, dept }) => ({
      id: name,
      name,
      dept,
      active: true,
      canDouble: true,
      assignedCount: 0,
    }));
    const rooms: Room[] = roster.rooms.map(({ id, form }) => {
      const parsed = parseRoomId(id);
      expect(parsed).not.toBeNull();
      return { id, form, enabled: true, ...parsed! };
    });

    expect(getGenerationSummary(people, rooms)).toEqual({
      activePeople: roster.people.length,
      enabledRooms: roster.rooms.length,
      requiredDouble: Math.max(0, roster.rooms.length - roster.people.length),
      availableDouble: roster.people.length,
      hasCapacity: true,
      feasible: true,
    });
  });
});
