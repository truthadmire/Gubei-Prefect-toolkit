import type { Assignment, RosterJson } from "../types";
import { unpackRotaCodeCompat } from "./rota";
import { computeRosterRevision } from "./roster-revision";
import type { SharedHistoryPayload } from "./shared-history-client";

export const MAX_SHARED_HISTORY_BODY_BYTES = 64 * 1024;
export const MAX_SHARED_HISTORY_TITLE = 120;
export const MAX_SHARED_HISTORY_ASSIGNMENTS = 100;
export const SHARED_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type SharedHistoryValidationResult =
  | { ok: true; value: SharedHistoryPayload }
  | { ok: false; reason: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.person === "string" &&
    Array.isArray(item.rooms) &&
    item.rooms.length >= 1 &&
    item.rooms.length <= 2 &&
    item.rooms.every((room) => typeof room === "string");
}

function sameAssignments(left: Assignment[], right: Assignment[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function validateSharedHistoryPayload(
  input: unknown,
  roster: Pick<RosterJson, "people" | "rooms">,
  now = new Date(),
): Promise<SharedHistoryValidationResult> {
  if (!input || typeof input !== "object") return { ok: false, reason: "payload" };
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !UUID_PATTERN.test(candidate.id)) return { ok: false, reason: "id" };
  if (typeof candidate.title !== "string") return { ok: false, reason: "title" };
  const title = candidate.title.trim();
  if (!title || title.length > MAX_SHARED_HISTORY_TITLE) return { ok: false, reason: "title" };
  if (typeof candidate.date !== "string" || !validCalendarDate(candidate.date)) return { ok: false, reason: "date" };
  if (typeof candidate.code !== "string" || candidate.code.length > 60_000) return { ok: false, reason: "code" };
  if (typeof candidate.rosterRevision !== "string" || !/^[0-9a-f]{64}$/i.test(candidate.rosterRevision)) {
    return { ok: false, reason: "roster-revision" };
  }
  if (typeof candidate.savedAt !== "string" || typeof candidate.updatedAt !== "string") {
    return { ok: false, reason: "timestamp" };
  }
  const savedAt = new Date(candidate.savedAt);
  const updatedAt = new Date(candidate.updatedAt);
  if (!Number.isFinite(savedAt.getTime()) || !Number.isFinite(updatedAt.getTime()) ||
      savedAt.getTime() < now.getTime() - SHARED_HISTORY_RETENTION_MS ||
      savedAt.getTime() > now.getTime() + 5 * 60_000 ||
      updatedAt.getTime() < savedAt.getTime() ||
      updatedAt.getTime() > now.getTime() + 5 * 60_000) {
    return { ok: false, reason: "timestamp" };
  }
  if (!Array.isArray(candidate.assignments) || candidate.assignments.length < 1 ||
      candidate.assignments.length > MAX_SHARED_HISTORY_ASSIGNMENTS ||
      !candidate.assignments.every(isAssignment)) {
    return { ok: false, reason: "assignments" };
  }

  const assignments = candidate.assignments.map((assignment) => ({
    person: assignment.person,
    rooms: assignment.rooms.slice(),
  }));
  const people = new Set(roster.people.map((person) => person.name));
  const roomById = new Map(roster.rooms.map((room) => [room.id, room]));
  const assignedPeople = new Set<string>();
  const assignedRooms = new Set<string>();
  for (const assignment of assignments) {
    if (!people.has(assignment.person) || assignedPeople.has(assignment.person)) {
      return { ok: false, reason: "person" };
    }
    assignedPeople.add(assignment.person);
    for (const roomId of assignment.rooms) {
      const room = roomById.get(roomId);
      if (!room || assignedRooms.has(roomId)) return { ok: false, reason: "room" };
      if (assignment.person.trim().toLowerCase() === "hepburn he" && room.form?.startsWith("12")) {
        return { ok: false, reason: "eligibility" };
      }
      assignedRooms.add(roomId);
    }
  }

  const expectedRevision = await computeRosterRevision(roster.people, roster.rooms);
  if (candidate.rosterRevision.toLowerCase() !== expectedRevision) {
    return { ok: false, reason: "roster-revision" };
  }

  try {
    const decoded = await unpackRotaCodeCompat(candidate.code);
    if (decoded.date !== candidate.date || !sameAssignments(decoded.assignments, assignments)) {
      return { ok: false, reason: "code-mismatch" };
    }
  } catch {
    return { ok: false, reason: "code" };
  }

  return {
    ok: true,
    value: {
      id: candidate.id,
      title,
      date: candidate.date,
      code: candidate.code,
      assignments,
      rosterRevision: expectedRevision,
      savedAt: savedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    },
  };
}
