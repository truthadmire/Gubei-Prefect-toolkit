import React, { useEffect, useMemo, useRef, useState } from "react";
import Munkres from "munkres-js";

/** =========================
 * Types
 * ========================= */
type Person = {
  id: string;
  name: string;
  dept?: string;
  active: boolean;
  canDouble: boolean;
  assignedCount: number;
  lastRooms?: string[];
  lastPairKey?: string;
};
type Room = {
  id: string;
  form?: string;
  building: string;
  number: number;
  floor: number;
  enabled: boolean;
};
type Slot = { id: string; rooms: string[] };
type Assignment = { person: string; rooms: string[] };
type RoomGroup = { grade: number; rooms: Room[] };
type FormGroup = { grade: number; forms: string[] };
type PersonGroup = { dept: string; people: Person[]; style: DeptStyle };
type ResultRow = {
  room: Room;
  formRoom: string;
  personName: string;
  style: DeptStyle;
};
type JpegExport = {
  blob: Blob;
  dataUrl: string;
};
type JpegExportCache = {
  key: string;
  exportData?: JpegExport;
  promise?: Promise<JpegExport>;
};
type GenerationHistoryItem = {
  id: string;
  savedAt: string;
  title: string;
  date: string;
  code: string;
  assignments: Assignment[];
};
type RosterJson = {
  people: { name: string; dept?: string }[];
  rooms: { id: string; form?: string }[];
};
type Lang = "zh" | "en";

/** =========================
 * I18N
 * ========================= */
const I18N: Record<Lang, any> = {
  zh: {
    setup: "准备界面",
    result: "成品界面",
    titlePh: "输入公告标题 / Enter announcement title",
    titleRequired: "请输入公告标题",
    datePh: "输入公告日期 / Enter date of announcement",
    dateRequired: "请输入公告日期",
    confirmTitle: "确认继续？",
    confirmBody: "有人员或班级未被选中，本次排布将跳过以下项目。",
    confirmPeople: "未选 Prefect",
    confirmForms: "未选班级",
    confirmBack: "返回修改",
    confirmContinue: "仍然继续",
    date: "日期",
    lastCodePh: "上一轮排布码（粘贴最近一条；支持 v1/v2）",
    status: (peo: number, rooms: number, pairs: number, can: number) =>
      `Prefects: ${peo}，房间: ${rooms}（需 ${pairs} 位双班；可双班: ${can}）`,
    peopleSel: "Prefect 选择",
    formSel: "班级（Form）选择",
    next: "下一步",
    back: "返回",
    exportShare: "分享 (手机/AirDrop)",
    download: "下载图片",
    downloadExcel: "下载 Excel",
    copyJPG: "复制图片",
    copyJPGOk: "图片已复制到剪贴板",
    excelOk: "Excel 表格已下载",
    shareFail: "当前设备不支持直接分享，已自动为您复制图片",
    codeBoxTitle: "排布码（已生成，粘贴到下一轮以避免重复）",
    copy: "复制",
    copyOk: "排布码已复制",
    copyFail: "复制失败，请手动选择复制",
    importOk: "已导入上一轮排布码",
    importFail: "排布码无效或不兼容",
    historyTitle: "本机历史",
    historySelect: "选择历史记录",
    historyUse: "载入",
    historyClear: "清空",
    historyLoaded: "已载入本机历史排布码",
    historyCleared: "本机历史已清空",
    colFormRoom: "班级 + 房号",
    colNameDept: "姓名 + 部门",
    gradeTitle: (grade: number) => (grade === 999 ? "其他班级" : `${grade} 年级`),
    gradeToggle: "整级",
    doubleDutyBadge: "双班",
    dragHint: "拖动人员到另一行交换位置；手机可点选两行交换。",
    dragDoubleBlocked: (name: string) => `${name} 未开启双班，不能移动到双班位置。`,
    dragHepburnBlocked: "Hepburn He 不能被安排到 12 年级班级。",
    dragUpdated: "排布已更新",
    languageLabel: "语言/Language",
    languageZh: "中文",
    languageEn: "English",
    ddLabel: "双班",
    ddTooFew: (need: number, have: number) =>
      `可双班人员不足：需要 ${need} 位，当前 ${have} 位。请勾选更多“双班”或减少房间数。`,
    loading: "正在加载名单…",
    rosterLoadFail: "无法加载 roster.json，请确认已放在 public/ 目录。",
    noDept: "未分类",
    footer: "由 Gubei Prefect Toolkit 生成",
  },
  en: {
    setup: "Setup",
    result: "Result",
    titlePh: "Enter announcement title",
    titleRequired: "Please enter an announcement title.",
    datePh: "Enter date of announcement",
    dateRequired: "Please enter the announcement date.",
    confirmTitle: "Continue?",
    confirmBody: "Some people or forms are not selected. This rota will skip the following items.",
    confirmPeople: "Deselected Prefects",
    confirmForms: "Deselected Forms",
    confirmBack: "Go Back",
    confirmContinue: "Continue Anyway",
    date: "Date",
    lastCodePh: "Last rota code (paste the latest; supports v1/v2)",
    status: (peo: number, rooms: number, pairs: number, can: number) =>
      `Prefects: ${peo}, Rooms: ${rooms} (need ${pairs} double-duty; available: ${can})`,
    peopleSel: "Prefects",
    formSel: "Forms",
    next: "Next",
    back: "Back",
    exportShare: "Share (Mobile/AirDrop)",
    download: "Download JPG",
    downloadExcel: "Download Excel",
    copyJPG: "Copy Image",
    copyJPGOk: "Image copied to clipboard",
    excelOk: "Excel table downloaded",
    shareFail: "Sharing not supported on this device, image copied instead.",
    codeBoxTitle: "Rota Code (paste next time to avoid repeats)",
    copy: "Copy",
    copyOk: "Rota code copied",
    copyFail: "Copy failed, please select and copy",
    importOk: "Imported last rota code",
    importFail: "Invalid or incompatible rota code",
    historyTitle: "Local History",
    historySelect: "Select generation history",
    historyUse: "Load",
    historyClear: "Clear",
    historyLoaded: "Loaded local history rota code",
    historyCleared: "Local history cleared",
    colFormRoom: "Class + Room",
    colNameDept: "Name + Department",
    gradeTitle: (grade: number) => (grade === 999 ? "Other Forms" : `Grade ${grade}`),
    gradeToggle: "All",
    doubleDutyBadge: "Double",
    dragHint: "Drag a person to another row to swap positions. On phone, tap two rows to swap.",
    dragDoubleBlocked: (name: string) => `${name} is not enabled for double duty and cannot move to a double-duty slot.`,
    dragHepburnBlocked: "Hepburn He cannot be assigned to Grade 12 forms.",
    dragUpdated: "Rota updated",
    languageLabel: "Language",
    languageZh: "Chinese",
    languageEn: "English",
    ddLabel: "Double",
    ddTooFew: (need: number, have: number) =>
      `Not enough double-duty people: need ${need}, have ${have}. Enable more "Double" or reduce rooms.`,
    loading: "Loading roster...",
    rosterLoadFail: "Could not load roster.json. Confirm it is in the public/ folder.",
    noDept: "No Department",
    footer: "Generated via Gubei Prefect Toolkit",
  },
};

const GENERATION_HISTORY_KEY = "gubei-prefect-toolkit.generation-history.v1";
const GENERATION_HISTORY_LIMIT = 20;

/** =========================
 * Dept color (from Key)
 * ========================= */
type DeptStyle = { bg: string; fg: string; border?: string };

function normalizeDept(raw?: string): string {
  if (!raw) return "";
  const s = raw.trim();
  const lower = s.toLowerCase();

  if (lower === "visual art") return "Art";
  if (lower === "art") return "Art";
  if (lower === "theater") return "Theatre";

  if (lower === "red hc" || lower === "red house captain") return "Red House Captain";
  if (lower === "green hc" || lower === "green house captain") return "Green House Captain";
  if (lower === "blue hc" || lower === "blue house captain") return "Blue House Captain";
  if (lower === "yellow hc" || lower === "yellow house captain") return "Yellow House Captain";

  return s;
}

const DEPT_STYLE: Record<string, DeptStyle> = {
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

const DEPT_ORDER = [
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

function deptStyleOf(raw?: string): DeptStyle {
  const dept = normalizeDept(raw);
  if (!dept) return { bg: "#FFFFFF", fg: "#000000" };
  return DEPT_STYLE[dept] || { bg: "#FFFFFF", fg: "#000000" };
}
function deptOrderOf(raw?: string): number {
  const idx = DEPT_ORDER.indexOf(normalizeDept(raw));
  return idx === -1 ? DEPT_ORDER.length : idx;
}

/** =========================
 * Utils
 * ========================= */
const uid = () => Math.random().toString(36).slice(2, 10);

function parseRoomId(raw: string): { building: string; number: number; floor: number } | null {
  const m = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!m) return null;
  const building = m[1].toUpperCase();
  const number = parseInt(m[2], 10);
  const floor = parseInt(m[2][0], 10);
  return { building, number, floor };
}
const pairKey = (a: string, b: string) => [a, b].sort().join("+");

function makeRNG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function randomSeed() {
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

/** ---- RotaCode (v2 recommended, v1 compatible) ---- */
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
function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function safeFilePart(value: string) {
  return (value.trim() || "rota").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}
function excelColor(color?: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color!.toUpperCase() : "#FFFFFF";
}
function isGenerationHistoryItem(value: unknown): value is GenerationHistoryItem {
  const item = value as GenerationHistoryItem;
  return !!item &&
    typeof item.id === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.title === "string" &&
    typeof item.date === "string" &&
    typeof item.code === "string" &&
    Array.isArray(item.assignments);
}
function readGenerationHistory() {
  try {
    const raw = localStorage.getItem(GENERATION_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isGenerationHistoryItem).slice(0, GENERATION_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}
function writeGenerationHistory(items: GenerationHistoryItem[]) {
  localStorage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(items.slice(0, GENERATION_HISTORY_LIMIT)));
}
function formatHistoryLabel(item: GenerationHistoryItem) {
  const savedAt = new Date(item.savedAt);
  const savedLabel = Number.isNaN(savedAt.getTime())
    ? item.savedAt
    : savedAt.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${item.date} · ${item.title} · ${savedLabel}`;
}
let imageExporterPromise: Promise<{ toJpeg: (node: HTMLElement, options: { quality: number; pixelRatio: number; backgroundColor: string }) => Promise<string> }> | null = null;
function loadImageExporter() {
  if (!imageExporterPromise) {
    imageExporterPromise = import("html-to-image").then(({ toJpeg }) => ({ toJpeg }));
  }
  return imageExporterPromise;
}
function dataUrlToBlob(dataUrl: string) {
  const [meta, payload] = dataUrl.split(",");
  const mime = meta.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const bin = atob(payload || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function buildExcelBlob(
  rows: ResultRow[],
  options: { title: string; dateStr: string; dateLabel: string; roomHeader: string; nameHeader: string }
) {
  const styleMap = new Map<string, string>();
  for (const row of rows) {
    if (!row.personName) continue;
    const key = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    if (!styleMap.has(key)) styleMap.set(key, `person${styleMap.size}`);
  }

  const borderXml = `
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
      </Borders>`;
  const personStyles = Array.from(styleMap.entries()).map(([key, id]) => {
    const [bg, fg] = key.split("|");
    return `
        <Style ss:ID="${id}">
          <Font ss:Bold="1" ss:Color="${fg}"/>
          <Interior ss:Color="${bg}" ss:Pattern="Solid"/>
          <Alignment ss:Vertical="Center"/>
          ${borderXml}
        </Style>`;
  }).join("");

  const rowsXml = rows.map((row) => {
    const styleKey = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    const personStyle = row.personName ? styleMap.get(styleKey) || "empty" : "empty";
    return `
        <Row ss:Height="28">
          <Cell ss:StyleID="room"><Data ss:Type="String">${xmlEscape(row.formRoom)}</Data></Cell>
          <Cell ss:StyleID="${personStyle}"><Data ss:Type="String">${xmlEscape(row.personName || "-")}</Data></Cell>
        </Row>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="16"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="meta"><Font ss:Bold="1" ss:Color="#475569"/></Style>
    <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F172A" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    <Style ss:ID="room"><Font ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    <Style ss:ID="empty"><Font ss:Bold="1" ss:Color="#94A3B8"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    ${personStyles}
  </Styles>
  <Worksheet ss:Name="Rota">
    <Table>
      <Column ss:Width="140"/>
      <Column ss:Width="220"/>
      <Row ss:Height="26"><Cell ss:StyleID="title" ss:MergeAcross="1"><Data ss:Type="String">${xmlEscape(options.title)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta"><Data ss:Type="String">${xmlEscape(options.dateLabel)}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(options.dateStr)}</Data></Cell></Row>
      <Row/>
      <Row ss:Height="24">
        <Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(options.roomHeader)}</Data></Cell>
        <Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(options.nameHeader)}</Data></Cell>
      </Row>
      ${rowsXml}
    </Table>
  </Worksheet>
</Workbook>`;

  return new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
}
function crc32(str: string) {
  let c = ~0;
  for (let i = 0; i < str.length; i++) {
    c ^= str.charCodeAt(i);
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (~c) >>> 0;
}
async function packRotaCodeV2(payload: any) {
  const json = JSON.stringify(payload);
  const b64 = toBase64URL(new TextEncoder().encode(json));
  const crc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  return `ROTAv2.${b64}.${crc}`;
}
async function unpackRotaCodeV2(code: string) {
  if (!code.startsWith("ROTAv2.")) throw new Error("not v2");
  const parts = code.split(".");
  if (parts.length < 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  const u8 = fromBase64URL(b64);
  return JSON.parse(new TextDecoder().decode(u8));
}
async function unpackRotaCodeCompat(code: string) {
  if (code.startsWith("ROTAv2.")) return unpackRotaCodeV2(code);
  if (!code.startsWith("ROTAv1.")) throw new Error("Unknown code");
  const parts = code.split(".");
  if (parts.length < 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  try {
    const raw = new TextDecoder().decode(fromBase64URL(b64));
    return JSON.parse(raw);
  } catch {}
  if ((globalThis as any).DecompressionStream) {
    const u8 = fromBase64URL(b64);
    const ds = new (globalThis as any).DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    await w.write(u8);
    await w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  throw new Error("This browser cannot decode old v1 compressed code.");
}

/** ---- roster.json ---- */
async function loadRoster(): Promise<{ people: Person[]; rooms: Room[] }> {
  const res = await fetch("/roster.json");
  if (!res.ok) throw new Error("roster.json not found");
  const j: RosterJson = await res.json();

  const people: Person[] = j.people.map((p) => ({
    id: uid(),
    name: p.name,
    dept: p.dept,
    active: true,
    canDouble: true,
    assignedCount: 0,
  }));

  const rooms: Room[] = j.rooms.map((rr) => {
    const parsed = parseRoomId(rr.id);
    if (!parsed) throw new Error(`Bad room id: ${rr.id}`);
    return {
      id: rr.id,
      form: rr.form,
      building: parsed.building,
      number: parsed.number,
      floor: parsed.floor,
      enabled: true,
    };
  });

  return { people, rooms };
}

/** =========================
 * Matching
 * ========================= */
function makeCost(
  p: Person,
  slot: Slot,
  strong: boolean,
  randJitter: (() => number) | null
): number {
  if (slot.rooms.length === 2 && !p.canDouble) return 1e9;

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

function isHepburnGrade12Blocked(p: Person, roomIds: string[], roomById: Map<string, Room>): boolean {
  if (p.name.trim().toLowerCase() !== "hepburn he") return false;
  return roomIds.some((roomId) => roomById.get(roomId)?.form?.startsWith("12"));
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
        M[i][j] = isHepburnGrade12Blocked(people[i], slots[j].rooms, roomById)
          ? 1e9
          : makeCost(people[i], slots[j], true, randJitter);
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
    if (ri < P && cj < S && !isHepburnGrade12Blocked(people[ri], slots[cj].rooms, roomById)) {
      out.push({ person: people[ri].name, rooms: slots[cj].rooms.slice() });
    }
  }
  return out;
}

function generateAssignment(
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
        if (!isHepburnGrade12Blocked(cand, [r.id], roomById) && (cur === 0 || (cur >= 1 && cand.canDouble))) {
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

/** =========================
 * Component
 * ========================= */
export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "zh");
  const L = I18N[lang];
  useEffect(() => { localStorage.setItem("lang", lang); }, [lang]);

  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [dateInputType, setDateInputType] = useState<"text" | "date">("text");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dragRoomId, setDragRoomId] = useState<string | null>(null);
  const [selectedSwapRoomId, setSelectedSwapRoomId] = useState<string | null>(null);
  const [rotaCodeIn, setRotaCodeIn] = useState("");
  const [allowedForms, setAllowedForms] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const imageExportCache = useRef<JpegExportCache | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>(readGenerationHistory);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  const [generatedCode, setGeneratedCode] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = (text: string, ms = 2000) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms);
  };

  useEffect(() => {
    loadRoster()
      .then(({ people, rooms }) => {
        setPeople(people);
        setRooms(rooms);
        const forms = Array.from(new Set(rooms.map((r) => r.form || ""))).filter(Boolean).sort();
        setAllowedForms(new Set(forms));
        setLoaded(true);
      })
      .catch((e) => {
        console.error(e);
        alert(L.rosterLoadFail);
      });
  }, []);

  useEffect(() => {
    if (!rotaCodeIn.trim() || !people.length) return;
    (async () => {
      try {
        const ro = await unpackRotaCodeCompat(rotaCodeIn.trim());
        const map = new Map(people.map((p) => [p.name, p]));
        for (const a of ro?.assignments || []) {
          const p = map.get(a.person);
          if (p) {
            p.lastRooms = a.rooms.slice();
            p.lastPairKey = a.rooms.length === 2 ? pairKey(a.rooms[0], a.rooms[1]) : undefined;
          }
        }
        setPeople(Array.from(map.values()));
        showToast(L.importOk);
      } catch (e) {
        console.warn(e);
        showToast(L.importFail);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotaCodeIn, people.length, lang]);

  useEffect(() => {
    setSelectedHistoryId((current) => {
      if (generationHistory.some((item) => item.id === current)) return current;
      return generationHistory[0]?.id || "";
    });
  }, [generationHistory]);

  function rememberGeneration(titleValue: string, dateValue: string, code: string, nextAssignments: Assignment[]) {
    const item: GenerationHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
      title: titleValue,
      date: dateValue,
      code,
      assignments: nextAssignments.map((assignment) => ({ person: assignment.person, rooms: assignment.rooms.slice() })),
    };

    setGenerationHistory((prev) => {
      const next = [item, ...prev.filter((existing) => existing.code !== code)].slice(0, GENERATION_HISTORY_LIMIT);
      try {
        writeGenerationHistory(next);
      } catch (error) {
        console.warn("Could not save generation history", error);
      }
      return next;
    });
  }

  function loadSelectedHistory() {
    const selected = generationHistory.find((item) => item.id === selectedHistoryId);
    if (!selected) return;
    setTitle(selected.title);
    setDateStr(selected.date);
    setDateInputType("date");
    setRotaCodeIn(selected.code);
    showToast(L.historyLoaded);
  }

  function clearGenerationHistory() {
    setGenerationHistory([]);
    setSelectedHistoryId("");
    try {
      localStorage.removeItem(GENERATION_HISTORY_KEY);
    } catch (error) {
      console.warn("Could not clear generation history", error);
    }
    showToast(L.historyCleared);
  }

  useEffect(() => {
    if (step !== 2 || !assignments.length || !dateStr.trim()) return;
    let cancelled = false;
    packRotaCodeV2({ date: dateStr.trim(), assignments }).then((code) => {
      if (!cancelled) {
        setGeneratedCode(code);
        rememberGeneration(title.trim(), dateStr.trim(), code, assignments);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assignments, dateStr, step]);

  const filteredRooms = useMemo(() => {
    return rooms.map((r) => ({ ...r, enabled: r.form ? allowedForms.has(r.form) : true }));
  }, [rooms, allowedForms]);

  const statusText = useMemo(() => {
    const active = people.filter((p) => p.active);
    const activeCount = active.length;
    const roomCount = filteredRooms.filter((r) => r.enabled).length;
    const needPairs = Math.max(0, roomCount - activeCount);
    const canDouble = active.filter((p) => p.canDouble).length;
    return L.status(activeCount, roomCount, needPairs, canDouble);
  }, [people, filteredRooms, lang]);

  function toggleForm(form: string) {
    setAllowedForms((prev) => {
      const n = new Set(prev);
      if (n.has(form)) n.delete(form); else n.add(form);
      return n;
    });
  }
  function toggleGradeForms(forms: string[]) {
    setAllowedForms((prev) => {
      const n = new Set(prev);
      const allSelected = forms.every((form) => n.has(form));
      for (const form of forms) {
        if (allSelected) n.delete(form);
        else n.add(form);
      }
      return n;
    });
  }
  function togglePerson(id: string) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  }
  function toggleDouble(id: string) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, canDouble: !p.canDouble } : p)));
  }

  function doGenerate(skipSelectionConfirm = false) {
    const cleanTitle = title.trim();
    const cleanDate = dateStr.trim();
    if (!cleanTitle) {
      showToast(L.titleRequired);
      return;
    }
    if (!cleanDate) {
      showToast(L.dateRequired);
      return;
    }
    if (cleanTitle !== title) setTitle(cleanTitle);
    if (cleanDate !== dateStr) setDateStr(cleanDate);

    if (!skipSelectionConfirm && (deselectedPeople.length > 0 || deselectedForms.length > 0)) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);

    const hasHistory = people.some((p) => (p.lastRooms?.length || 0) > 0 || p.lastPairKey);
    const seed = randomSeed();
    const rng = makeRNG(seed);
    const randJitter = hasHistory ? null : rng;

    const active = people.filter((p) => p.active);
    const canDouble = active.filter((p) => p.canDouble).length;
    const R = filteredRooms.filter((r) => r.enabled).length;
    const P = active.length;
    const need = Math.max(0, R - P);
    if (need > canDouble) {
      showToast(L.ddTooFew(need, canDouble));
      return;
    }

    const A = generateAssignment(people, filteredRooms, randJitter, !hasHistory);
    setAssignments(A);
    setStep(2);

    const payload = { date: cleanDate, assignments: A };
    packRotaCodeV2(payload).then((code) => {
      setGeneratedCode(code);
      navigator.clipboard.writeText(code).then(
        () => showToast(L.copyOk),
        () => showToast(L.codeBoxTitle)
      );
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast(L.copyOk);
    } catch {
      showToast(L.copyFail);
    }
  }

  function canMovePersonToRooms(personName: string, roomIds: string[]) {
    const person = personByName.get(personName);
    if (!person) return false;
    if (roomIds.length > 1 && !person.canDouble) {
      showToast(L.dragDoubleBlocked(personName));
      return false;
    }
    if (isHepburnGrade12Blocked(person, roomIds, roomById)) {
      showToast(L.dragHepburnBlocked);
      return false;
    }
    return true;
  }

  function swapAssignmentsByRoom(sourceRoomId: string, targetRoomId: string) {
    if (sourceRoomId === targetRoomId) return;

    const sourceIndex = assignments.findIndex((assignment) => assignment.rooms.includes(sourceRoomId));
    const targetIndex = assignments.findIndex((assignment) => assignment.rooms.includes(targetRoomId));
    if (sourceIndex < 0 || targetIndex < 0) return;
    if (sourceIndex === targetIndex) {
      setSelectedSwapRoomId(null);
      setDragRoomId(null);
      return;
    }

    const source = assignments[sourceIndex];
    const target = assignments[targetIndex];
    if (!canMovePersonToRooms(source.person, target.rooms) || !canMovePersonToRooms(target.person, source.rooms)) {
      return;
    }

    const next = assignments.map((assignment) => ({ ...assignment, rooms: assignment.rooms.slice() }));
    next[sourceIndex] = { ...source, person: target.person };
    next[targetIndex] = { ...target, person: source.person };
    setAssignments(next);

    setSelectedSwapRoomId(null);
    setDragRoomId(null);
    showToast(L.dragUpdated);
  }

  function handleResultCellClick(roomId: string) {
    if (!assignmentByRoom.has(roomId)) return;
    if (!selectedSwapRoomId) {
      setSelectedSwapRoomId(roomId);
      return;
    }
    if (selectedSwapRoomId === roomId) {
      setSelectedSwapRoomId(null);
      return;
    }
    swapAssignmentsByRoom(selectedSwapRoomId, roomId);
  }

  const gradeOf = (form?: string) => {
    if (!form) return 999;
    const m = form.match(/^(\d{1,2})/);
    if (!m) return 999;
    const g = parseInt(m[1], 10);
    if (g >= 9 && g <= 12) return g;
    return 999;
  };

  const resultRoomGroups = useMemo<RoomGroup[]>(() => {
    const enabledIds = new Set(filteredRooms.filter((r) => r.enabled).map((r) => r.id));
    const sortedRooms = rooms
      .filter((r) => enabledIds.has(r.id))
      .sort((a, b) => {
        const ga = gradeOf(a.form), gb = gradeOf(b.form);
        if (ga !== gb) return ga - gb;
        if (a.building !== b.building) return a.building.localeCompare(b.building);
        if (a.floor !== b.floor) return a.floor - b.floor;
        return a.number - b.number;
      });

    const groups: RoomGroup[] = [];
    for (const room of sortedRooms) {
      const grade = gradeOf(room.form);
      const last = groups[groups.length - 1];
      if (last?.grade === grade) {
        last.rooms.push(room);
      } else {
        groups.push({ grade, rooms: [room] });
      }
    }
    return groups;
  }, [rooms, filteredRooms]);

  const formGroups = useMemo<FormGroup[]>(() => {
    const sortedRooms = rooms.slice().sort((a, b) => {
      const ga = gradeOf(a.form), gb = gradeOf(b.form);
      if (ga !== gb) return ga - gb;
      if (a.building !== b.building) return a.building.localeCompare(b.building);
      if (a.floor !== b.floor) return a.floor - b.floor;
      return a.number - b.number;
    });

    const groups = new Map<number, string[]>();
    const seen = new Set<string>();
    for (const room of sortedRooms) {
      if (!room.form || seen.has(room.form)) continue;
      seen.add(room.form);
      const grade = gradeOf(room.form);
      groups.set(grade, [...(groups.get(grade) || []), room.form]);
    }

    const orderedGrades = [9, 10, 11, 12, ...Array.from(groups.keys()).filter((grade) => ![9, 10, 11, 12].includes(grade)).sort((a, b) => a - b)];
    return orderedGrades
      .map((grade) => ({ grade, forms: groups.get(grade) || [] }))
      .filter((group) => group.forms.length > 0);
  }, [rooms]);

  const allFormNames = useMemo(() => formGroups.flatMap((group) => group.forms), [formGroups]);
  const deselectedPeople = useMemo(() => people.filter((p) => !p.active), [people]);
  const deselectedForms = useMemo(() => allFormNames.filter((form) => !allowedForms.has(form)), [allFormNames, allowedForms]);

  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const personByName = useMemo(() => new Map(people.map((p) => [p.name, p])), [people]);
  const assignmentByRoom = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const assignment of assignments) {
      for (const roomId of assignment.rooms) map.set(roomId, assignment);
    }
    return map;
  }, [assignments]);

  const resultRowsByGrade = useMemo(() => {
    return resultRoomGroups.map((group) => ({
      grade: group.grade,
      rows: group.rooms.map((room): ResultRow => {
        const assignment = assignmentByRoom.get(room.id);
        const personName = assignment?.person ?? "";
        const rawDept = personName ? (personByName.get(personName)?.dept ?? "") : "";
        return {
          room,
          formRoom: room.form ? `${room.id} (${room.form})` : room.id,
          personName,
          style: deptStyleOf(rawDept),
        };
      }),
    }));
  }, [assignmentByRoom, personByName, resultRoomGroups]);
  const resultRows = useMemo(() => resultRowsByGrade.flatMap((group) => group.rows), [resultRowsByGrade]);
  const exportFileBase = useMemo(() => `${safeFilePart(title)}_${safeFilePart(dateStr)}`, [title, dateStr]);
  const nameHeader = useMemo(() => I18N[lang].colNameDept.split(" + ")[0] || "Name", [lang]);
  const excelExportBlob = useMemo(
    () => buildExcelBlob(resultRows, {
      title,
      dateStr,
      dateLabel: L.date,
      roomHeader: I18N[lang].colFormRoom,
      nameHeader,
    }),
    [L.date, dateStr, lang, nameHeader, resultRows, title]
  );
  const boardExportKey = useMemo(() => {
    return [
      lang,
      title,
      dateStr,
      ...resultRows.map((row) => `${row.formRoom}\t${row.personName}\t${row.style.bg}\t${row.style.fg}\t${row.style.border || ""}`),
    ].join("\n");
  }, [dateStr, lang, resultRows, title]);

  async function getJpegExport() {
    const node = boardRef.current;
    if (!node) return null;

    const cached = imageExportCache.current;
    if (cached?.key === boardExportKey && cached.exportData) return cached.exportData;
    if (cached?.key === boardExportKey && cached.promise) return cached.promise;

    const promise = loadImageExporter()
      .then(({ toJpeg }) => toJpeg(node, { quality: 0.95, pixelRatio: 3, backgroundColor: "#ffffff" }))
      .then((dataUrl): JpegExport => ({ dataUrl, blob: dataUrlToBlob(dataUrl) }));

    imageExportCache.current = { key: boardExportKey, promise };
    const exportData = await promise;
    imageExportCache.current = { key: boardExportKey, exportData };
    return exportData;
  }

  useEffect(() => {
    imageExportCache.current = null;
    if (step !== 2 || !resultRows.length) return;

    let cancelled = false;
    const warmImageExport = () => {
      if (cancelled || !boardRef.current) return;
      void getJpegExport().catch((error) => console.warn("JPG export warmup failed", error));
    };

    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const idleId = win.requestIdleCallback(warmImageExport, { timeout: 1500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(idleId);
      };
    }

    const timeoutId = window.setTimeout(warmImageExport, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [boardExportKey, resultRows.length, step]);

  // Uses the warmed/cached board render when available; otherwise renders once and caches it.
  async function downloadImage() {
    try {
      const image = await getJpegExport();
      if (!image) return;
      downloadBlob(image.blob, `${exportFileBase}.jpg`);
    } catch (e) {
      console.error(e);
      showToast(L.copyFail);
    }
  }

  // 1. Try Native Share (Mobile)
  // 2. Fallback to Copy Image
  // 3. Show a normal failure toast
  async function shareImage() {
    try {
      const image = await getJpegExport();
      if (!image) return;
      const file = new File([image.blob], `${exportFileBase}.jpg`, { type: "image/jpeg" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text: dateStr });
        return;
      }

      const canWrite =
        typeof navigator.clipboard?.write === "function" &&
        typeof ClipboardItem !== "undefined";

      if (canWrite) {
        await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": image.blob })]);
        showToast(L.shareFail);
        return;
      }

      throw new Error("No share/copy support");
    } catch (e) {
      console.warn(e);
      showToast(L.copyFail);
    }
  }

  function downloadExcel() {
    downloadBlob(excelExportBlob, `${exportFileBase}.xls`);
    showToast(L.excelOk);
  }

  const personGroups = useMemo<PersonGroup[]>(() => {
    const grouped = new Map<string, Person[]>();
    for (const person of people) {
      const dept = normalizeDept(person.dept) || L.noDept;
      grouped.set(dept, [...(grouped.get(dept) || []), person]);
    }

    return Array.from(grouped.entries())
      .map(([dept, groupPeople]) => ({
        dept,
        people: groupPeople,
        style: deptStyleOf(dept),
      }))
      .sort((a, b) => {
        const da = deptOrderOf(a.dept), db = deptOrderOf(b.dept);
        if (da !== db) return da - db;
        return a.dept.localeCompare(b.dept);
      });
  }, [people, lang]);

  const canContinue = title.trim().length > 0 && dateStr.trim().length > 0;

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">{L.loading}</div>;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {toast && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-max max-w-[90vw]">
          <div className="bg-white text-black rounded-full shadow-lg px-6 py-3 font-medium text-center">{toast.text}</div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl">
            <div className="text-xl font-bold">{I18N[lang].confirmTitle}</div>
            <div className="mt-2 text-sm text-neutral-300">{I18N[lang].confirmBody}</div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {deselectedPeople.length > 0 && (
                <div className="rounded-xl bg-neutral-800 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-400">{I18N[lang].confirmPeople}</div>
                  <div className="max-h-44 overflow-y-auto pr-1 text-sm text-neutral-100 custom-scrollbar">
                    {deselectedPeople.map((p) => (
                      <div key={p.id} className="border-b border-neutral-700 py-1 last:border-b-0">
                        {p.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {deselectedForms.length > 0 && (
                <div className="rounded-xl bg-neutral-800 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-400">{I18N[lang].confirmForms}</div>
                  <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pr-1 custom-scrollbar">
                    {deselectedForms.map((form) => (
                      <span key={form} className="rounded-md bg-neutral-700 px-2 py-1 text-xs font-semibold text-neutral-100">
                        {form}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl bg-neutral-700 px-4 py-3 font-bold hover:bg-neutral-600 sm:flex-1"
              >
                {I18N[lang].confirmBack}
              </button>
              <button
                onClick={() => doGenerate(true)}
                className="rounded-xl bg-blue-600 px-4 py-3 font-bold hover:bg-blue-700 sm:flex-1"
              >
                {I18N[lang].confirmContinue}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xl md:text-2xl font-bold">{step === 1 ? I18N[lang].setup : I18N[lang].result}</div>

          {step === 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400 hidden md:inline">{I18N[lang].languageLabel}</span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
              >
                <option value="zh">{I18N[lang].languageZh}</option>
                <option value="en">{I18N[lang].languageEn}</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {step === 1 && (
        <div className="max-w-6xl mx-auto p-2 md:p-4">
          <div className="bg-neutral-900 rounded-2xl p-4 md:p-6 shadow-xl">
            {/* Input Row */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                className="flex-1 rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base placeholder:text-neutral-500 focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder={I18N[lang].titlePh}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                type={dateInputType}
                className="rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base placeholder:text-neutral-500 outline-none"
                placeholder={I18N[lang].datePh}
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                onFocus={() => setDateInputType("date")}
                onBlur={() => {
                  if (!dateStr) setDateInputType("text");
                }}
              />
              <input
                className="w-full md:w-[460px] rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base outline-none"
                placeholder={I18N[lang].lastCodePh}
                value={rotaCodeIn}
                onChange={(e) => setRotaCodeIn(e.target.value)}
              />
            </div>

            <div className="mt-3 text-xs md:text-sm text-neutral-400 px-1">{statusText}</div>

            {generationHistory.length > 0 && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-neutral-700 bg-neutral-800 p-3 md:flex-row md:items-center">
                <div className="shrink-0 text-sm font-semibold text-neutral-100">{I18N[lang].historyTitle}</div>
                <select
                  value={selectedHistoryId}
                  onChange={(e) => setSelectedHistoryId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
                  aria-label={I18N[lang].historySelect}
                >
                  {generationHistory.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatHistoryLabel(item)}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={loadSelectedHistory}
                    disabled={!selectedHistoryId}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-950 disabled:text-blue-100/50"
                  >
                    {I18N[lang].historyUse}
                  </button>
                  <button
                    onClick={clearGenerationHistory}
                    className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-bold hover:bg-neutral-600"
                  >
                    {I18N[lang].historyClear}
                  </button>
                </div>
              </div>
            )}

            {/* Layout: Fixed height on desktop to enable internal scrolling */}
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:h-[600px] md:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.7fr)]">
              
              {/* People Column */}
              <div className="bg-neutral-800 rounded-xl p-3 flex flex-col h-[40vh] md:h-full min-h-0">
                <div className="font-semibold mb-2 px-1 shrink-0">{I18N[lang].peopleSel}</div>
                <div className="flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
                  {personGroups.map((group) => (
                    <section key={group.dept} className="mb-3 last:mb-0">
                      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-600 bg-neutral-800 py-2 text-xs font-bold uppercase tracking-wide text-neutral-300">
                        <span
                          style={{ width: 12, height: 12, borderRadius: 999, background: group.style.bg, border: `1px solid ${group.style.border || "rgba(255,255,255,0.35)"}` }}
                          className="shrink-0"
                        />
                        <span>{group.dept}</span>
                      </div>
                      <div className="divide-y divide-neutral-700">
                        {group.people.map((p) => {
                          const st = deptStyleOf(p.dept);
                          return (
                            <div key={p.id} className="flex items-center justify-between py-2">
                              <label className="flex items-center gap-3 cursor-pointer flex-1">
                                <input type="checkbox" className="w-5 h-5 rounded accent-blue-600" checked={p.active} onChange={() => togglePerson(p.id)} />
                                <span
                                  style={{ width: 12, height: 12, borderRadius: 999, background: st.bg, border: `1px solid ${st.border || "rgba(0,0,0,0.25)"}` }}
                                  className="shrink-0"
                                />
                                <span className="text-sm md:text-base">{p.name}</span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer p-1">
                                <span className="text-xs text-neutral-400">{I18N[lang].ddLabel}</span>
                                <input type="checkbox" className="w-4 h-4 rounded accent-blue-600" checked={p.canDouble} onChange={() => toggleDouble(p.id)} />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </div>

              {/* Forms Column */}
              <div className="bg-neutral-800 rounded-xl p-3 flex flex-col h-[30vh] md:h-full min-h-0">
                <div className="font-semibold mb-2 px-1 shrink-0">{I18N[lang].formSel}</div>
                <div className="flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
                    {formGroups.map((group) => {
                      const selectedCount = group.forms.filter((form) => allowedForms.has(form)).length;
                      const allSelected = selectedCount === group.forms.length;
                      const partiallySelected = selectedCount > 0 && !allSelected;
                      return (
                        <div key={group.grade} className="rounded-lg border border-neutral-700 bg-neutral-900/50 p-2">
                          <label className="mb-2 flex cursor-pointer items-center justify-between gap-2 border-b border-neutral-700 pb-2">
                            <span className="text-xs font-bold uppercase tracking-wide text-neutral-200">{I18N[lang].gradeTitle(group.grade)}</span>
                            <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                              {I18N[lang].gradeToggle}
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded accent-emerald-500"
                                checked={allSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = partiallySelected;
                                }}
                                onChange={() => toggleGradeForms(group.forms)}
                              />
                            </span>
                          </label>
                          <div className="flex flex-col gap-1.5">
                            {group.forms.map((f) => (
                              <button
                                key={f}
                                onClick={() => toggleForm(f)}
                                className={`${allowedForms.has(f) ? "bg-emerald-600 text-white shadow" : "bg-neutral-700 text-neutral-300"} min-h-8 rounded-md px-2 py-1 text-xs font-semibold transition-colors`}
                              >
                                {f}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              </div>

              {/* Action Column */}
              <div className="flex h-auto justify-end">
                <button
                  onClick={() => doGenerate()}
                  aria-disabled={!canContinue}
                  disabled={!canContinue}
                  className={`${canContinue ? "bg-blue-600 hover:bg-blue-700 active:scale-95 shadow-blue-900/20" : "bg-blue-950 text-blue-100/50 cursor-not-allowed shadow-none"} w-full transition-transform rounded-xl py-4 font-bold text-lg shadow-lg md:w-72`}
                >
                  {I18N[lang].next}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="max-w-6xl mx-auto p-2 md:p-4 pb-20">
          <div ref={boardRef} className="bg-slate-50 text-slate-950 rounded-xl p-2.5 md:p-5 shadow-2xl">
            <div className="flex flex-col gap-1.5 border-b-2 border-slate-900 pb-2.5 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0 text-lg font-black leading-tight tracking-tight md:text-2xl">{title}</div>
              <div className="shrink-0 text-left md:text-right">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{I18N[lang].date}</div>
                <div className="text-lg font-black tabular-nums md:text-xl">{dateStr}</div>
              </div>
            </div>
            <div className="mt-2 rounded-md bg-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700">
              {I18N[lang].dragHint}
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border-2 border-slate-900 bg-white">
              <div className="divide-y divide-slate-200">
                {resultRows.map((row) => {
                  const cellStyle: React.CSSProperties = row.personName
                    ? { background: row.style.bg, color: row.style.fg, boxShadow: row.style.border ? `inset 0 0 0 1px ${row.style.border}` : undefined }
                    : { background: "#F8FAFC", color: "#94A3B8" };
                  const isSelectedForSwap = selectedSwapRoomId === row.room.id;
                  return (
                    <div key={row.room.id} className="grid min-h-[38px] grid-cols-[116px_minmax(0,1fr)] md:min-h-[42px] md:grid-cols-[132px_minmax(0,1fr)]">
                      <div className="flex items-center border-r border-slate-200 bg-slate-100 px-2.5 py-1.5 text-base font-black leading-tight tracking-tight text-slate-900 md:text-lg">
                        {row.formRoom}
                      </div>
                      <div
                        className={`${isSelectedForSwap ? "ring-2 ring-blue-600 ring-inset" : ""} flex min-w-0 items-center px-3 py-1.5 text-base transition md:text-lg ${row.personName ? "cursor-move select-none touch-manipulation" : ""}`}
                        style={cellStyle}
                        draggable={!!row.personName}
                        role={row.personName ? "button" : undefined}
                        tabIndex={row.personName ? 0 : undefined}
                        onClick={() => handleResultCellClick(row.room.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleResultCellClick(row.room.id);
                          }
                        }}
                        onDragStart={(e) => {
                          if (!row.personName) return;
                          setDragRoomId(row.room.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", row.room.id);
                        }}
                        onDragOver={(e) => {
                          if (row.personName) e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const sourceRoomId = e.dataTransfer.getData("text/plain") || dragRoomId;
                          if (sourceRoomId) swapAssignmentsByRoom(sourceRoomId, row.room.id);
                        }}
                        onDragEnd={() => setDragRoomId(null)}
                      >
                        <span className="min-w-0 truncate font-black leading-tight">{row.personName || "-"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            
          </div>

          <div className="mt-6 flex flex-col gap-3">
             <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="rounded-xl bg-neutral-700 hover:bg-neutral-600 py-3 px-6 font-bold flex-1">
                {I18N[lang].back}
              </button>
              <button onClick={downloadImage} className="rounded-xl bg-amber-600 hover:bg-amber-700 py-3 px-6 font-bold flex-1 shadow-lg">
                 {I18N[lang].download}
              </button>
             </div>
             <button onClick={shareImage} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 py-3 px-6 font-bold w-full shadow-lg shadow-emerald-900/20">
               {I18N[lang].exportShare}
             </button>
             <button onClick={downloadExcel} className="rounded-xl bg-sky-600 hover:bg-sky-700 py-3 px-6 font-bold w-full shadow-lg shadow-sky-900/20">
               {I18N[lang].downloadExcel}
             </button>
          </div>

          <div className="mt-6 bg-neutral-900 rounded-2xl p-4 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-sm md:text-base">{I18N[lang].codeBoxTitle}</div>
              <button onClick={copyCode} className="rounded bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
                {I18N[lang].copy}
              </button>
            </div>
            <textarea
              className="w-full h-20 rounded bg-neutral-800 border border-neutral-700 p-2 font-mono text-xs text-neutral-300 focus:outline-none"
              readOnly
              value={generatedCode}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
