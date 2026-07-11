export function parseRoomId(raw: string): { building: string; number: number; floor: number } | null {
  const match = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!match) return null;
  return { building: match[1].toUpperCase(), number: Number.parseInt(match[2], 10), floor: Number.parseInt(match[2][0], 10) };
}
