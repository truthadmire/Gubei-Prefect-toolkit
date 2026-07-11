import type { DeptStyle } from "../types";

export function normalizeDept(raw?: string): string {
  if (!raw) return "";
  const value = raw.trim();
  const normalized = value.toLowerCase();

  if (normalized === "visual art" || normalized === "art") return "Art";
  if (normalized === "theater") return "Theatre";
  if (normalized === "red hc" || normalized === "red house captain") return "Red House Captain";
  if (normalized === "green hc" || normalized === "green house captain") return "Green House Captain";
  if (normalized === "blue hc" || normalized === "blue house captain") return "Blue House Captain";
  if (normalized === "yellow hc" || normalized === "yellow house captain") return "Yellow House Captain";

  return value;
}

export const DEPT_STYLE: Record<string, DeptStyle> = {
  Charity: { bg: "#D6A07E", fg: "#000000" },
  Art: { bg: "#79C3E8", fg: "#000000" },
  Community: { bg: "#D6FF4A", fg: "#000000" },
  Academia: { bg: "#B59ACB", fg: "#000000" },
  Media: { bg: "#4B235A", fg: "#FFFFFF" },
  Sports: { bg: "#E59B1E", fg: "#000000" },
  Music: { bg: "#FFFFFF", fg: "#000000", border: "#BDBDBD" },
  Theatre: { bg: "#B9FFFF", fg: "#000000" },
  "Red House Captain": { bg: "#D63A2E", fg: "#000000" },
  "Green House Captain": { bg: "#6B7E55", fg: "#000000" },
  "Blue House Captain": { bg: "#93A1AB", fg: "#000000" },
  "Yellow House Captain": { bg: "#FFF06A", fg: "#000000" },
  "no need": { bg: "#BDBDBD", fg: "#000000" },
};

export const DEPT_ORDER = [
  "Academia",
  "Charity",
  "Community",
  "Media",
  "Music",
  "Theatre",
  "Art",
  "Red House Captain",
  "Blue House Captain",
  "Green House Captain",
  "Yellow House Captain",
  "Sports",
  "no need",
];

export function deptStyleOf(raw?: string): DeptStyle {
  const department = normalizeDept(raw);
  if (!department) return { bg: "#FFFFFF", fg: "#000000" };
  return DEPT_STYLE[department] || { bg: "#FFFFFF", fg: "#000000" };
}

export function deptOrderOf(raw?: string): number {
  const index = DEPT_ORDER.indexOf(normalizeDept(raw));
  return index === -1 ? DEPT_ORDER.length : index;
}
