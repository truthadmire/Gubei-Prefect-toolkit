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
    titlePh: "输入标题（默认含 SUIS GB）",
    date: "日期",
    lastCodePh: "上一轮排布码（粘贴最近一条；支持 v1/v2）",
    status: (peo: number, rooms: number, pairs: number, can: number) =>
      `人员: ${peo}，房间: ${rooms}（需 ${pairs} 位双班；可双班: ${can}）`,
    peopleSel: "人员选择",
    formSel: "班级（Form）选择",
    next: "下一步",
    back: "返回",
    exportShare: "分享 (手机/AirDrop)",
    download: "下载图片",
    copyJPG: "复制图片",
    copyJPGOk: "图片已复制到剪贴板",
    shareFail: "当前设备不支持直接分享，已自动为您复制图片",
    codeBoxTitle: "排布码（已生成，粘贴到下一轮以避免重复）",
    copy: "复制",
    copyOk: "排布码已复制",
    copyFail: "复制失败，请手动选择复制",
    importOk: "已导入上一轮排布码",
    importFail: "排布码无效或不兼容",
    colFormRoom: "班级 + 房号",
    colNameDept: "姓名 + 部门",
    languageLabel: "语言/Language",
    ddLabel: "双班",
    ddTooFew: (need: number, have: number) =>
      `可双班人员不足：需要 ${need} 位，当前 ${have} 位。请勾选更多“双班”或减少房间数。`,
  },
  en: {
    setup: "Setup",
    result: "Result",
    titlePh: "Title (includes SUIS GB by default)",
    date: "Date",
    lastCodePh: "Last rota code (paste the latest; supports v1/v2)",
    status: (peo: number, rooms: number, pairs: number, can: number) =>
      `People: ${peo}, Rooms: ${rooms} (need ${pairs} double-duty; available: ${can})`,
    peopleSel: "People",
    formSel: "Forms",
    next: "Next",
    back: "Back",
    exportShare: "Share (Mobile/AirDrop)",
    download: "Download JPG",
    copyJPG: "Copy Image",
    copyJPGOk: "Image copied to clipboard",
    shareFail: "Sharing not supported on this device, image copied instead.",
    codeBoxTitle: "Rota Code (paste next time to avoid repeats)",
    copy: "Copy",
    copyOk: "Rota code copied",
    copyFail: "Copy failed, please select and copy",
    importOk: "Imported last rota code",
    importFail: "Invalid or incompatible rota code",
    colFormRoom: "Class + Room",
    colNameDept: "Name + Department",
    languageLabel: "语言/Language",
    ddLabel: "Double",
    ddTooFew: (need: number, have: number) =>
      `Not enough double-duty people: need ${need}, have ${have}. Enable more "Double" or reduce rooms.`,
  },
};

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

function deptStyleOf(raw?: string): DeptStyle {
  const dept = normalizeDept(raw);
  if (!dept) return { bg: "#FFFFFF", fg: "#000000" };
  return DEPT_STYLE[dept] || { bg: "#FFFFFF", fg: "#000000" };
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
  return s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromBase64URL(s: string) {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
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

function hungarianAssign(
  people: Person[],
  slots: Slot[],
  randJitter: (() => number) | null
): Assignment[] {
  const P = people.length, S = slots.length, N = Math.max(P, S);
  const M: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i < P && j < S) M[i][j] = makeCost(people[i], slots[j], true, randJitter);
      else if (i < P && j >= S) M[i][j] = 500 + (randJitter ? Math.floor(randJitter() * 2) : 0);
      else if (i >= P && j < S) M[i][j] = 1000 + (randJitter ? Math.floor(randJitter() * 2) : 0);
      else M[i][j] = 0;
    }
  }
  const MunkresCtor: any = (Munkres as any)?.Munkres || (Munkres as any);
  const mk: any = new MunkresCtor();
  const idxs: [number, number][] = mk.compute(M);
  const out: Assignment[] = [];
  for (const [ri, cj] of idxs) if (ri < P && cj < S) out.push({ person: people[ri].name, rooms: slots[cj].rooms.slice() });
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

  const base = hungarianAssign(people, slots, randJitter);

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
        if (cur === 0 || (cur >= 1 && cand.canDouble)) {
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
  const [title, setTitle] = useState("Morning Announcement Rota — SUIS GB");
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [rotaCodeIn, setRotaCodeIn] = useState("");
  const [allowedForms, setAllowedForms] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

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
        alert("无法加载 roster.json，请确认已放在 public/ 目录。");
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
  function togglePerson(id: string) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  }
  function toggleDouble(id: string) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, canDouble: !p.canDouble } : p)));
  }

  function doGenerate() {
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

    const payload = { date: dateStr, assignments: A };
    packRotaCodeV2(payload).then((code) => {
      setGeneratedCode(code);
      navigator.clipboard.writeText(code).then(
        () => showToast(L.copyOk),
        () => showToast(L.codeBoxTitle)
      );
    });
  }

  // 1. Try Native Share (Mobile)
  // 2. Fallback to Copy Image (Desktop Safari sometimes allows this)
  // 3. Fallback to Download (Universal)
  async function shareImage() {
    if (!boardRef.current) return;
    try {
      const { toJpeg } = await import("html-to-image");
      const dataUrl = await toJpeg(boardRef.current, {
        quality: 0.95,
        pixelRatio: 3,
        backgroundColor: "#ffffff",
      });
      
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `${title.replace(/\s+/g, "_")}_${dateStr}.jpg`, { type: "image/jpeg" });

      // Try Native Share
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: title,
          text: dateStr,
        });
        return;
      }

      // If we are here, browser refused share (common on Mac/Desktop).
      // Auto-fallback to Copy
      const canWrite =
        typeof navigator.clipboard?.write === "function" &&
        typeof ClipboardItem !== "undefined";
        
      if (canWrite) {
        await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": blob })]);
        showToast(L.shareFail); // Tell user we copied instead
        return;
      }

      throw new Error("No share/copy support");
    } catch (e) {
      console.warn(e);
      showToast(L.copyFail);
    }
  }

  async function downloadImage() {
    if (!boardRef.current) return;
    try {
      const { toJpeg } = await import("html-to-image");
      const url = await toJpeg(boardRef.current, { quality: 0.95, pixelRatio: 3, backgroundColor: "#fff" });
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/\s+/g, "_")}_${dateStr}.jpg`;
      link.click();
    } catch (e) {
      console.error(e);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast(L.copyOk);
    } catch {
      showToast(L.copyFail);
    }
  }

  const gradeOf = (form?: string) => {
    if (!form) return 999;
    const m = form.match(/^(\d{1,2})/);
    if (!m) return 999;
    const g = parseInt(m[1], 10);
    if (g >= 9 && g <= 12) return g;
    return 999;
  };

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading roster…</div>;
  }

  const allForms = Array.from(new Set(rooms.map((r) => r.form || ""))).filter(Boolean).sort();

  return (
    <div className="min-h-screen bg-black text-white">
      {toast && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 w-max max-w-[90vw]">
          <div className="bg-white text-black rounded-full shadow-lg px-6 py-3 font-medium text-center">{toast.text}</div>
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
                <option value="zh">中文</option>
                <option value="en">English</option>
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
                className="flex-1 rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder={I18N[lang].titlePh}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                type="date"
                className="rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base outline-none"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <input
                className="w-full md:w-[460px] rounded-lg px-4 py-3 bg-neutral-800 border border-neutral-700 text-sm md:text-base outline-none"
                placeholder={I18N[lang].lastCodePh}
                value={rotaCodeIn}
                onChange={(e) => setRotaCodeIn(e.target.value)}
              />
            </div>

            <div className="mt-3 text-xs md:text-sm text-neutral-400 px-1">{statusText}</div>

            {/* Layout: Fixed height on desktop to enable internal scrolling */}
            <div className="mt-4 flex flex-col md:grid md:grid-cols-3 gap-4 h-auto md:h-[600px]">
              
              {/* People Column */}
              <div className="bg-neutral-800 rounded-xl p-3 flex flex-col h-[40vh] md:h-full min-h-0">
                <div className="font-semibold mb-2 px-1 shrink-0">{I18N[lang].peopleSel}</div>
                <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-neutral-700 pr-1 custom-scrollbar">
                  {people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
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
              </div>

              {/* Forms Column */}
              <div className="bg-neutral-800 rounded-xl p-3 flex flex-col h-[30vh] md:h-full min-h-0">
                <div className="font-semibold mb-2 px-1 shrink-0">{I18N[lang].formSel}</div>
                <div className="flex-1 overflow-y-auto min-h-0 pr-1 custom-scrollbar">
                  <div className="flex flex-wrap gap-2 content-start">
                    {allForms.map((f) => (
                      <button
                        key={f}
                        onClick={() => toggleForm(f)}
                        className={`${allowedForms.has(f) ? "bg-emerald-600 text-white shadow-lg" : "bg-neutral-700 text-neutral-300"} px-3 py-1.5 text-xs md:text-sm rounded-full transition-all`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Column */}
              <div className="flex flex-col justify-end h-auto md:h-full">
                <button
                  onClick={doGenerate}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:scale-95 transition-transform rounded-xl py-4 font-bold text-lg shadow-lg shadow-blue-900/20"
                >
                  {I18N[lang].next}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="max-w-3xl mx-auto p-2 md:p-4 pb-20">
          <div className="bg-neutral-900 rounded-2xl p-4 mb-4 shadow-lg">
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

          <div ref={boardRef} className="bg-white text-black rounded-2xl p-4 md:p-8 shadow-2xl">
            <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-4">
              <div className="text-xl md:text-3xl font-bold tracking-tight">{title}</div>
              <div className="text-right">
                <div className="text-xs text-gray-500 uppercase tracking-widest">{I18N[lang].date}</div>
                <div className="text-lg font-bold">{dateStr}</div>
              </div>
            </div>

            {/* Responsive Table / Grid */}
            <div className="w-full border border-gray-200">
              {/* Desktop Header */}
              <div className="hidden md:grid grid-cols-2 bg-gray-800 text-white font-bold text-sm uppercase tracking-wide">
                <div className="p-3 border-r border-gray-600">{I18N[lang].colFormRoom}</div>
                <div className="p-3">{I18N[lang].colNameDept}</div>
              </div>

              {/* List with Zebra Striping (even:bg-gray-50) */}
              <div className="grid grid-cols-1 md:grid-cols-1 divide-y divide-gray-200">
                {rooms
                  .filter((r) => filteredRooms.find((fr) => fr.id === r.id)?.enabled)
                  .sort((a, b) => {
                    const ga = gradeOf(a.form), gb = gradeOf(b.form);
                    if (ga !== gb) return ga - gb;
                    if (a.building !== b.building) return a.building.localeCompare(b.building);
                    if (a.floor !== b.floor) return a.floor - b.floor;
                    return a.number - b.number;
                  })
                  .map((r) => {
                    const a = assignments.find((x) => x.rooms.includes(r.id));
                    const formRoom = r.form ? `${r.form} ${r.id}` : r.id;

                    const personName = a?.person ?? "";
                    const rawDept = personName ? (people.find((p) => p.name === personName)?.dept ?? "") : "";
                    const dept = normalizeDept(rawDept);
                    const st = deptStyleOf(rawDept);

                    const cellStyle: React.CSSProperties = personName
                      ? { background: st.bg, color: st.fg }
                      : {};
                    const innerBorder = st.border || "rgba(0,0,0,0.1)";

                    return (
                      <div key={r.id} className="md:grid md:grid-cols-2 group even:bg-gray-50 hover:bg-gray-100 transition-colors">
                        {/* Mobile Card Style */}
                        <div className="md:hidden p-3 border rounded-lg mb-2 shadow-sm break-inside-avoid" style={{ ...cellStyle, border: `1px solid ${personName ? innerBorder : '#e5e7eb'}` }}>
                          <div className="flex justify-between items-center mb-1">
                             <span className="font-bold text-lg">{formRoom}</span>
                             {dept && <span className="text-xs font-bold uppercase opacity-80 border border-current px-1 rounded">{dept}</span>}
                          </div>
                          <div className="text-xl font-bold">{personName || <span className="text-gray-300">-</span>}</div>
                        </div>

                        {/* Desktop Table Row Style */}
                        <div className="hidden md:block p-3 border-r border-gray-200 font-mono text-lg font-bold text-gray-700">{formRoom}</div>
                        <div className="hidden md:flex items-center p-3 font-bold text-lg" style={cellStyle}>
                          <span>{personName}</span>
                          {dept && <span className="ml-3 text-xs opacity-75 border border-current px-1 rounded">{dept}</span>}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
            
            <div className="mt-8 text-center text-gray-400 text-xs font-mono">
              Generated via Gubei Prefect Toolkit
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
          </div>
        </div>
      )}
    </div>
  );
}
