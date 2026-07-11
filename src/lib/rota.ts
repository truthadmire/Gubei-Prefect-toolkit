import Munkres from "munkres-js";
import type { Assignment, Person, Room, Slot } from "../types";

type RotaPayload = {
  date?: string;
  assignments: Assignment[];
};

export type SwapResult =
  | { ok: true; assignments: Assignment[] }
  | { ok: false; reason: "missing" | "same-slot" | "double-duty" | "grade-12" };

export type GenerationFailure =
  | "title"
  | "date"
  | "empty-people"
  | "empty-rooms"
  | "capacity"
  | "infeasible";

export type GenerationSummary = {
  activePeople: number;
  enabledRooms: number;
  requiredDouble: number;
  availableDouble: number;
  hasCapacity: boolean;
  feasible: boolean;
};

export type GenerationValidation =
  | { ok: true; title: string; date: string; summary: GenerationSummary }
  | { ok: false; reason: GenerationFailure; title: string; date: string; summary: GenerationSummary };

export function parseRoomId(raw: string): { building: string; number: number; floor: number } | null {
  const match = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!match) return null;
  return { building: match[1].toUpperCase(), number: Number.parseInt(match[2], 10), floor: Number.parseInt(match[2][0], 10) };
}

export const pairKey = (a: string, b: string) => [a, b].sort().join("+");

export function makeRNG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function randomSeed() {
  try {
    const u = new Uint32Array(1);
    crypto.getRandomValues(u);
    return u[0] >>> 0;
  } catch {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }
}

function shuffle<T>(arr: T[], rnd: () => number) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toBase64URL(u8: Uint8Array) {
  let s = btoa(String.fromCharCode(...Array.from(u8)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64URL(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function crc32(str: string) {
  let c = ~0;
  for (let i = 0; i < str.length; i++) {
    c ^= str.charCodeAt(i);
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (~c) >>> 0;
}

function validateRotaPayload(value: unknown): RotaPayload {
  if (!value || typeof value !== "object") throw new Error("Invalid rota payload");

  const payload = value as { date?: unknown; assignments?: unknown };
  if ("date" in payload && typeof payload.date !== "string") throw new Error("Invalid rota payload");
  if (!Array.isArray(payload.assignments)) throw new Error("Invalid rota payload");

  const validAssignments = payload.assignments.every((assignment) => {
    if (!assignment || typeof assignment !== "object") return false;
    const candidate = assignment as { person?: unknown; rooms?: unknown };
    return typeof candidate.person === "string" &&
      Array.isArray(candidate.rooms) &&
      candidate.rooms.every((roomId) => typeof roomId === "string");
  });
  if (!validAssignments) throw new Error("Invalid rota payload");

  return value as RotaPayload;
}

export async function packRotaCodeV2(payload: RotaPayload) {
  const json = JSON.stringify(payload);
  const b64 = toBase64URL(new TextEncoder().encode(json));
  const crc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  return `ROTAv2.${b64}.${crc}`;
}

export async function unpackRotaCodeV2(code: string) {
  if (!code.startsWith("ROTAv2.")) throw new Error("not v2");
  const parts = code.split(".");
  if (parts.length !== 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  const u8 = fromBase64URL(b64);
  return validateRotaPayload(JSON.parse(new TextDecoder().decode(u8)));
}

export async function unpackRotaCodeCompat(code: string) {
  if (code.startsWith("ROTAv2.")) return unpackRotaCodeV2(code);
  if (!code.startsWith("ROTAv1.")) throw new Error("Unknown code");
  const parts = code.split(".");
  if (parts.length !== 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  try {
    const raw = new TextDecoder().decode(fromBase64URL(b64));
    return validateRotaPayload(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid rota payload") throw error;
  }
  if ((globalThis as any).DecompressionStream) {
    const u8 = fromBase64URL(b64);
    const ds = new (globalThis as any).DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    await w.write(u8);
    await w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return validateRotaPayload(JSON.parse(new TextDecoder().decode(buf)));
  }
  throw new Error("This browser cannot decode old v1 compressed code.");
}

function makeCost(
  p: Person,
  slot: Slot,
  strong: boolean,
  randJitter: (() => number) | null
): number {
  const last = new Set(p.lastRooms || []);
  if (strong) {
    for (const r of slot.rooms) if (last.has(r)) return 1e6;
    if (slot.rooms.length === 2 && p.lastPairKey === pairKey(slot.rooms[0], slot.rooms[1])) return 1e6;
  }

  let c = 0;
  for (const r of slot.rooms) if (last.has(r)) c += 100;
  if (slot.rooms.length === 2 && p.lastPairKey === pairKey(slot.rooms[0], slot.rooms[1])) c += 200;
  c += p.assignedCount * 5;

  if (randJitter) c += Math.floor(randJitter() * 2);
  return c;
}

function greedyAdjacentPairs(rooms: Room[], need: number, used: Set<string>): Slot[] {
  const sorted = rooms.slice().sort((a, b) =>
    a.building === b.building
      ? a.floor === b.floor
        ? a.number - b.number
        : a.floor - b.floor
      : a.building.localeCompare(b.building)
  );
  const pairs: Slot[] = [];
  for (let i = 0; i < sorted.length - 1 && pairs.length < need; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (used.has(a.id) || used.has(b.id)) continue;
    if (a.building === b.building && a.floor === b.floor && Math.abs(a.number - b.number) === 1) {
      pairs.push({ id: pairKey(a.id, b.id), rooms: [a.id, b.id] });
      used.add(a.id); used.add(b.id);
    }
  }
  return pairs;
}

function distance(a: Room, b: Room): number {
  if (a.building !== b.building) return 1e9 + Math.abs(a.number - b.number);
  const floorPenalty = Math.abs(a.floor - b.floor) * 1000;
  return floorPenalty + Math.abs(a.number - b.number);
}

function fillPairsByNearest(rooms: Room[], need: number, used: Set<string>): Slot[] {
  const candidates: { a: Room; b: Room; d: number }[] = [];
  const free = rooms.filter((r) => !used.has(r.id));
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      candidates.push({ a: free[i], b: free[j], d: distance(free[i], free[j]) });
    }
  }
  candidates.sort((x, y) => x.d - y.d);
  const picked: Slot[] = [];
  for (const c of candidates) {
    if (picked.length >= need) break;
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    picked.push({ id: pairKey(c.a.id, c.b.id), rooms: [c.a.id, c.b.id] });
    used.add(c.a.id); used.add(c.b.id);
  }
  return picked;
}

export function isHepburnGrade12Blocked(p: Person, roomIds: string[], roomById: Map<string, Room>): boolean {
  if (p.name.trim().toLowerCase() !== "hepburn he") return false;
  return roomIds.some((roomId) => roomById.get(roomId)?.form?.startsWith("12"));
}

function isPersonEligibleForRooms(p: Person, roomIds: string[], roomById: Map<string, Room>): boolean {
  return (roomIds.length < 2 || p.canDouble) &&
    !isHepburnGrade12Blocked(p, roomIds, roomById);
}

function hungarianAssign(
  people: Person[],
  slots: Slot[],
  randJitter: (() => number) | null,
  roomById: Map<string, Room>
): Assignment[] {
  const P = people.length, S = slots.length, N = Math.max(P, S);
  const M: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i < P && j < S) {
        M[i][j] = isPersonEligibleForRooms(people[i], slots[j].rooms, roomById)
          ? makeCost(people[i], slots[j], true, randJitter)
          : 1e9;
      }
      else if (i < P && j >= S) M[i][j] = 500 + (randJitter ? Math.floor(randJitter() * 2) : 0);
      else if (i >= P && j < S) M[i][j] = 1000 + (randJitter ? Math.floor(randJitter() * 2) : 0);
      else M[i][j] = 0;
    }
  }
  const MunkresCtor: any = (Munkres as any)?.Munkres || (Munkres as any);
  const mk: any = new MunkresCtor();
  const idxs: [number, number][] = mk.compute(M);
  const out: Assignment[] = [];
  for (const [ri, cj] of idxs) {
    if (ri < P && cj < S && isPersonEligibleForRooms(people[ri], slots[cj].rooms, roomById)) {
      out.push({ person: people[ri].name, rooms: slots[cj].rooms.slice() });
    }
  }
  return out;
}

export function generateAssignment(
  peopleIn: Person[],
  roomsIn: Room[],
  randJitter: (() => number) | null,
  shufflePeople: boolean
): Assignment[] {
  const peopleRaw = peopleIn.filter((p) => p.active);
  const enabledRooms = roomsIn.filter((r) => r.enabled);
  if (!peopleRaw.length || !enabledRooms.length) return [];

  const people = shufflePeople && randJitter ? shuffle(peopleRaw.slice(), randJitter) : peopleRaw.slice();
  const roomById = new Map(enabledRooms.map((r) => [r.id, r]));

  const R = enabledRooms.length, P = people.length;
  const D = Math.max(0, R - P);

  const used = new Set<string>();
  const pairs1 = greedyAdjacentPairs(enabledRooms, D, used);
  let pairs = pairs1.slice();
  if (pairs.length < D) {
    const extra = fillPairsByNearest(enabledRooms, D - pairs.length, used);
    pairs = pairs.concat(extra);
  }

  const singles: Slot[] = enabledRooms.filter((r) => !used.has(r.id)).map((r) => ({ id: r.id, rooms: [r.id] }));
  const slots: Slot[] = [...pairs, ...singles];

  const base = hungarianAssign(people, slots, randJitter, roomById);

  const assignedRooms = new Set(base.flatMap((a) => a.rooms));
  const still = enabledRooms.filter((r) => !assignedRooms.has(r.id));
  if (still.length) {
    const usedBy: Map<string, number> = new Map();
    for (const a of base) usedBy.set(a.person, (usedBy.get(a.person) || 0) + a.rooms.length);
    const pool = people.slice().sort((a, b) => (usedBy.get(a.name) || 0) - (usedBy.get(b.name) || 0));
    let pi = 0;
    for (const r of still) {
      let chosen: Person | null = null;
      for (let k = 0; k < pool.length; k++) {
        const cand = pool[(pi + k) % pool.length];
        const cur = usedBy.get(cand.name) || 0;
        if (isPersonEligibleForRooms(cand, [r.id], roomById) && (cur === 0 || (cur >= 1 && cand.canDouble))) {
          chosen = cand;
          pi = (pi + k + 1) % pool.length;
          break;
        }
      }
      if (chosen) {
        base.push({ person: chosen.name, rooms: [r.id] });
        usedBy.set(chosen.name, (usedBy.get(chosen.name) || 0) + 1);
      }
    }
  }
  return base;
}

function assignmentsAreValid(assignments: Assignment[], people: Person[], enabledRooms: Room[]): boolean {
  const expected = new Set(enabledRooms.map((room) => room.id));
  const assigned = assignments.flatMap((assignment) => assignment.rooms);
  const personByName = new Map(people.map((person) => [person.name, person]));
  const roomById = new Map(enabledRooms.map((room) => [room.id, room]));
  return assigned.length === expected.size &&
    new Set(assigned).size === expected.size &&
    assigned.every((roomId) => expected.has(roomId)) &&
    assignments.every((assignment) => {
      const person = personByName.get(assignment.person);
      return !!person && isPersonEligibleForRooms(person, assignment.rooms, roomById);
    });
}

export function getGenerationSummary(people: Person[], rooms: Room[]): GenerationSummary {
  const activePeople = people.filter((person) => person.active);
  const enabledRooms = rooms.filter((room) => room.enabled);
  const requiredDouble = Math.max(0, enabledRooms.length - activePeople.length);
  const availableDouble = activePeople.filter((person) => person.canDouble).length;
  const hasCapacity = requiredDouble <= availableDouble;
  const feasible = activePeople.length > 0 &&
    enabledRooms.length > 0 &&
    hasCapacity &&
    assignmentsAreValid(
      generateAssignment(activePeople, enabledRooms, null, false),
      activePeople,
      enabledRooms,
    );

  return {
    activePeople: activePeople.length,
    enabledRooms: enabledRooms.length,
    requiredDouble,
    availableDouble,
    hasCapacity,
    feasible,
  };
}

export function validateGeneration(
  title: string,
  date: string,
  people: Person[],
  rooms: Room[],
): GenerationValidation {
  const cleanTitle = title.trim();
  const cleanDate = date.trim();
  const summary = getGenerationSummary(people, rooms);

  let reason: GenerationFailure | null = null;
  if (!cleanTitle) reason = "title";
  else if (!cleanDate) reason = "date";
  else if (summary.activePeople === 0) reason = "empty-people";
  else if (summary.enabledRooms === 0) reason = "empty-rooms";
  else if (!summary.hasCapacity) reason = "capacity";
  else if (!summary.feasible) reason = "infeasible";

  if (reason) return { ok: false, reason, title: cleanTitle, date: cleanDate, summary };
  return { ok: true, title: cleanTitle, date: cleanDate, summary };
}

export function swapAssignments(
  assignments: Assignment[],
  sourceRoomId: string,
  targetRoomId: string,
  people: Person[],
  rooms: Room[],
): SwapResult {
  if (sourceRoomId === targetRoomId) return { ok: false, reason: "same-slot" };

  const sourceIndex = assignments.findIndex((assignment) => assignment.rooms.includes(sourceRoomId));
  const targetIndex = assignments.findIndex((assignment) => assignment.rooms.includes(targetRoomId));
  if (sourceIndex < 0 || targetIndex < 0) return { ok: false, reason: "missing" };
  if (sourceIndex === targetIndex) return { ok: false, reason: "same-slot" };

  const source = assignments[sourceIndex];
  const target = assignments[targetIndex];
  const personByName = new Map(people.map((person) => [person.name, person]));
  const sourcePerson = personByName.get(source.person);
  const targetPerson = personByName.get(target.person);
  if (!sourcePerson || !targetPerson) return { ok: false, reason: "missing" };

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  if ([...source.rooms, ...target.rooms].some((roomId) => !roomById.has(roomId))) {
    return { ok: false, reason: "missing" };
  }

  if (!isPersonEligibleForRooms(sourcePerson, target.rooms, roomById) ||
      !isPersonEligibleForRooms(targetPerson, source.rooms, roomById)) {
    if ((target.rooms.length > 1 && !sourcePerson.canDouble) ||
        (source.rooms.length > 1 && !targetPerson.canDouble)) {
      return { ok: false, reason: "double-duty" };
    }
    return { ok: false, reason: "grade-12" };
  }

  const next = assignments.map((assignment) => ({
    ...assignment,
    rooms: assignment.rooms.slice(),
  }));
  next[sourceIndex] = { ...next[sourceIndex], person: target.person };
  next[targetIndex] = { ...next[targetIndex], person: source.person };
  return { ok: true, assignments: next };
}

export function applyImportedAssignments(people: Person[], assignments: Assignment[]): Person[] {
  const assignmentByName = new Map(assignments.map((assignment) => [assignment.person, assignment]));
  return people.map((person) => {
    const assignment = assignmentByName.get(person.name);
    if (!assignment) return person;
    const lastRooms = assignment.rooms.slice();
    return {
      ...person,
      lastRooms,
      lastPairKey: lastRooms.length === 2 ? pairKey(lastRooms[0], lastRooms[1]) : undefined,
    };
  });
}
