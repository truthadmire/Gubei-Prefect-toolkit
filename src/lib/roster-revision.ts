type RevisionPerson = { name: string; dept?: string };
type RevisionRoom = { id: string; form?: string };

export function canonicalRosterJson(people: RevisionPerson[], rooms: RevisionRoom[]): string {
  return JSON.stringify({
    people: people.map((person) => ({ name: person.name, dept: person.dept || "" })),
    rooms: rooms.map((room) => ({ id: room.id, form: room.form || "" })),
  });
}

export async function computeRosterRevision(people: RevisionPerson[], rooms: RevisionRoom[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRosterJson(people, rooms));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
