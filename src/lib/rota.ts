import Munkres from "munkres-js";
import type { Assignment, Person, Room } from "../types";

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

function distance(a: Room, b: Room): number {
  if (a.building !== b.building) return 1e9 + Math.abs(a.number - b.number);
  const floorPenalty = Math.abs(a.floor - b.floor) * 1000;
  return floorPenalty + Math.abs(a.number - b.number);
}

export function isHepburnGrade12Blocked(p: Person, roomIds: string[], roomById: Map<string, Room>): boolean {
  if (p.name.trim().toLowerCase() !== "hepburn he") return false;
  return roomIds.some((roomId) => roomById.get(roomId)?.form?.startsWith("12"));
}

function isPersonEligibleForRooms(p: Person, roomIds: string[], roomById: Map<string, Room>): boolean {
  return (roomIds.length < 2 || p.canDouble) &&
    !isHepburnGrade12Blocked(p, roomIds, roomById);
}

type CapacitySeat = { person: Person; secondary: boolean };

const INVALID_COST = 1_000_000_000_000;
const SECONDARY_SEAT_COST = 100_000_000;
const PREVIOUS_ROOM_COST = 1_000_000;
const PREVIOUS_PAIR_COMPONENT_COST = 100_000;

function seatRoomCost(seat: CapacitySeat, room: Room, randJitter: (() => number) | null): number {
  if (seat.person.name.trim().toLowerCase() === "hepburn he" && room.form?.startsWith("12")) return INVALID_COST;

  const previousRooms = new Set(seat.person.lastRooms || []);
  const previousPairRooms = new Set(seat.person.lastPairKey?.split("+") || []);
  const loadCost = Math.min(Math.max(0, seat.person.assignedCount), 10_000) * 10;
  const historyCost = previousRooms.has(room.id) ? PREVIOUS_ROOM_COST : 0;
  const pairComponentCost = seat.secondary && previousPairRooms.has(room.id)
    ? PREVIOUS_PAIR_COMPONENT_COST
    : 0;
  const jitter = randJitter ? Math.floor(randJitter() * 100) : 0;

  return (seat.secondary ? SECONDARY_SEAT_COST : 0) + historyCost + pairComponentCost + loadCost + jitter;
}

function assignmentHistoryCost(assignment: Assignment, person: Person): number {
  const previousRooms = new Set(person.lastRooms || []);
  const repeatedRooms = assignment.rooms.filter((roomId) => previousRooms.has(roomId)).length;
  const repeatedPair = assignment.rooms.length === 2 &&
    person.lastPairKey === pairKey(assignment.rooms[0], assignment.rooms[1]);
  return repeatedRooms * 10 + (repeatedPair ? 25 : 0);
}

function assignmentProximityCost(assignment: Assignment, roomById: Map<string, Room>): number {
  if (assignment.rooms.length !== 2) return 0;
  const first = roomById.get(assignment.rooms[0]);
  const second = roomById.get(assignment.rooms[1]);
  if (!first || !second) return INVALID_COST;
  return distance(first, second);
}

function improveDoubleRoomProximity(
  assignments: Assignment[],
  personByName: Map<string, Person>,
  roomById: Map<string, Room>,
): Assignment[] {
  const next = assignments.map((assignment) => ({
    person: assignment.person,
    rooms: assignment.rooms.slice(),
  }));
  const maxPasses = Math.min(8, Math.max(1, next.length));
  const stateSignature = (items: Assignment[]) => items
    .map((assignment) => `${assignment.person}:${assignment.rooms.slice().sort().join(",")}`)
    .join("|");

  for (let pass = 0; pass < maxPasses; pass++) {
    let best: { left: number; leftRoom: number; right: number; rightRoom: number; history: number; proximity: number; signature: string } | null = null;
    const currentSignature = stateSignature(next);

    for (let left = 0; left < next.length; left++) {
      for (let right = left + 1; right < next.length; right++) {
        const leftPerson = personByName.get(next[left].person);
        const rightPerson = personByName.get(next[right].person);
        if (!leftPerson || !rightPerson) continue;

        const currentHistory = assignmentHistoryCost(next[left], leftPerson) + assignmentHistoryCost(next[right], rightPerson);
        const currentProximity = assignmentProximityCost(next[left], roomById) + assignmentProximityCost(next[right], roomById);

        for (let leftRoom = 0; leftRoom < next[left].rooms.length; leftRoom++) {
          for (let rightRoom = 0; rightRoom < next[right].rooms.length; rightRoom++) {
            const leftRooms = next[left].rooms.slice();
            const rightRooms = next[right].rooms.slice();
            [leftRooms[leftRoom], rightRooms[rightRoom]] = [rightRooms[rightRoom], leftRooms[leftRoom]];
            if (!isPersonEligibleForRooms(leftPerson, leftRooms, roomById) ||
                !isPersonEligibleForRooms(rightPerson, rightRooms, roomById)) continue;

            const candidateHistory = assignmentHistoryCost({ person: leftPerson.name, rooms: leftRooms }, leftPerson) +
              assignmentHistoryCost({ person: rightPerson.name, rooms: rightRooms }, rightPerson);
            const candidateProximity = assignmentProximityCost({ person: leftPerson.name, rooms: leftRooms }, roomById) +
              assignmentProximityCost({ person: rightPerson.name, rooms: rightRooms }, roomById);
            const candidateState = next.map((assignment, index) => {
              if (index === left) return { person: assignment.person, rooms: leftRooms };
              if (index === right) return { person: assignment.person, rooms: rightRooms };
              return assignment;
            });
            const candidateSignature = stateSignature(candidateState);
            const improves = candidateHistory < currentHistory ||
              (candidateHistory === currentHistory && candidateProximity < currentProximity) ||
              (candidateHistory === currentHistory && candidateProximity === currentProximity && candidateSignature < currentSignature);
            if (!improves) continue;

            if (!best || candidateHistory < best.history ||
                (candidateHistory === best.history && candidateProximity < best.proximity) ||
                (candidateHistory === best.history && candidateProximity === best.proximity && candidateSignature < best.signature)) {
              best = { left, leftRoom, right, rightRoom, history: candidateHistory, proximity: candidateProximity, signature: candidateSignature };
            }
          }
        }
      }
    }

    if (!best) break;
    [next[best.left].rooms[best.leftRoom], next[best.right].rooms[best.rightRoom]] =
      [next[best.right].rooms[best.rightRoom], next[best.left].rooms[best.leftRoom]];
  }

  for (const assignment of next) {
    assignment.rooms.sort((left, right) => (roomById.get(left)?.number || 0) - (roomById.get(right)?.number || 0));
  }
  return next;
}

function assignRoomsToCapacitySeats(
  people: Person[],
  rooms: Room[],
  randJitter: (() => number) | null,
): Assignment[] {
  const seats: CapacitySeat[] = [
    ...people.map((person) => ({ person, secondary: false })),
    ...people.filter((person) => person.canDouble).map((person) => ({ person, secondary: true })),
  ];
  const size = Math.max(seats.length, rooms.length);
  const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (row < seats.length && column < rooms.length) {
        matrix[row][column] = seatRoomCost(seats[row], rooms[column], randJitter);
      } else if (row >= seats.length && column < rooms.length) {
        matrix[row][column] = INVALID_COST;
      }
    }
  }

  const MunkresCtor: any = (Munkres as any)?.Munkres || (Munkres as any);
  const matches: [number, number][] = new MunkresCtor().compute(matrix);
  const roomsByPerson = new Map<string, string[]>();
  for (const [seatIndex, roomIndex] of matches) {
    if (seatIndex >= seats.length || roomIndex >= rooms.length) continue;
    if (matrix[seatIndex][roomIndex] >= INVALID_COST) continue;
    const personName = seats[seatIndex].person.name;
    roomsByPerson.set(personName, [...(roomsByPerson.get(personName) || []), rooms[roomIndex].id]);
  }

  const roomOrder = new Map(rooms.map((room, index) => [room.id, index]));
  const collapsed = people.flatMap((person): Assignment[] => {
    const assignedRooms = roomsByPerson.get(person.name);
    if (!assignedRooms?.length) return [];
    assignedRooms.sort((left, right) => (roomOrder.get(left) || 0) - (roomOrder.get(right) || 0));
    return [{ person: person.name, rooms: assignedRooms }];
  });
  const personByName = new Map(people.map((person) => [person.name, person]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return improveDoubleRoomProximity(collapsed, personByName, roomById);
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
  return assignRoomsToCapacitySeats(people, enabledRooms, randJitter);
}

function assignmentsAreValid(assignments: Assignment[], people: Person[], enabledRooms: Room[]): boolean {
  const expected = new Set(enabledRooms.map((room) => room.id));
  const assigned = assignments.flatMap((assignment) => assignment.rooms);
  const personByName = new Map(people.map((person) => [person.name, person]));
  const roomById = new Map(enabledRooms.map((room) => [room.id, room]));
  const roomsByPerson = new Map<string, string[]>();
  for (const assignment of assignments) {
    roomsByPerson.set(assignment.person, [
      ...(roomsByPerson.get(assignment.person) || []),
      ...assignment.rooms,
    ]);
  }

  return assigned.length === expected.size &&
    new Set(assigned).size === expected.size &&
    assigned.every((roomId) => expected.has(roomId)) &&
    Array.from(roomsByPerson).every(([personName, roomIds]) => {
      const person = personByName.get(personName);
      const capacity = person?.canDouble ? 2 : 1;
      return !!person && roomIds.length <= capacity && isPersonEligibleForRooms(person, roomIds, roomById);
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
