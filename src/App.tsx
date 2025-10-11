import React, { useEffect, useMemo, useRef, useState } from "react";
import Munkres from "munkres-js";

/** =========================
 *        Types
 *  ========================= */
type Person = {
  id: string;
  name: string;
  dept?: string;
  active: boolean;
  assignedCount: number;
  lastRooms?: string[];
  lastPairKey?: string;
};
type Room = {
  id: string;      // e.g. N102
  form?: string;   // e.g. 9AG
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
 *        I18N
 *  ========================= */
const I18N: Record<Lang, any> = {
  zh: {
    setup: "准备界面",
    result: "成品界面",
    titlePh: "输入标题（默认含 SUIS GB）",
    date: "日期",
    lastCodePh: "上一轮排布码（粘贴最近一条；支持 v1/v2）",
    status: (peo: number, rooms: number, pairs: number) =>
      `人员: ${peo}，房间: ${rooms}（需 ${pairs} 位二班）`,
    peopleSel: "人员选择",
    formSel: "班级（Form）选择",
    next: "下一步",
    back: "返回",
    exportJPG: "下载 JPG",
    copyJPG: "复制 JPG",
    copyJPGOk: "JPG 已复制",
    copyJPGFail: "当前浏览器不支持复制 JPG，请改用“下载 JPG”",
    codeBoxTitle: "排布码（已生成，粘贴到下一轮以避免重复）",
    copy: "复制",
    copyOk: "排布码已复制",
    copyFail: "复制失败，请手动选择复制",
    importOk: "已导入上一轮排布码",
    importFail: "排布码无效或不兼容",
    colFormRoom: "班级 + 房号",
    colNameDept: "姓名 + 部门",
    languageLabel: "语言/Language",
  },
  en: {
    setup: "Setup",
    result: "Result",
    titlePh: "Title (includes SUIS GB by default)",
    date: "Date",
    lastCodePh: "Last rota code (paste the latest; supports v1/v2)",
    status: (peo: number, rooms: number, pairs: number) =>
      `People: ${peo}, Rooms: ${rooms} (need ${pairs} double-duty)`,
    peopleSel: "People",
    formSel: "Forms",
    next: "Next",
    back: "Back",
    exportJPG: "Download JPG",
    copyJPG: "Copy JPG",
    copyJPGOk: "JPG copied",
    copyJPGFail: "Clipboard image not supported, please use Download JPG",
    codeBoxTitle: "Rota Code (paste next time to avoid repeats)",
    copy: "Copy",
    copyOk: "Rota code copied",
    copyFail: "Copy failed, please select and copy",
    importOk: "Imported last rota code",
    importFail: "Invalid or incompatible rota code",
    colFormRoom: "Class + Room",
    colNameDept: "Name + Department",
    languageLabel: "语言/Language",
  },
};

/** =========================
 *        Utils
 *  ========================= */
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

// 简单可复现的伪随机（用于无排布码时“打乱 + 轻微抖动”）
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

// v2: no compression
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
// v1 compatibility (compressed or not)
async function unpackRotaCodeCompat(code: string) {
  if (code.startsWith("ROTAv2.")) return unpackRotaCodeV2(code);
  if (!code.startsWith("ROTAv1.")) throw new Error("Unknown code");
  const parts = code.split(".");
  if (parts.length < 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  // try plain (no compression)
  try {
    const raw = new TextDecoder().decode(fromBase64URL(b64));
    return JSON.parse(raw);
  } catch {}
  // try native inflate if available
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
 *        Matching
 *  ========================= */
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
  if (randJitter) c += Math.floor(randJitter() * 2); // 0/1 抖动打破固定解
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

  // 兜底
  const assignedRooms = new Set(base.flatMap((a) => a.rooms));
  const still = enabledRooms.filter((r) => !assignedRooms.has(r.id));
  if (still.length) {
    const usedBy: Map<string, number> = new Map();
    for (const a of base) usedBy.set(a.person, (usedBy.get(a.person) || 0) + a.rooms.length);
    const pool = people.slice().sort((a, b) => (usedBy.get(a.name) || 0) - (usedBy.get(b.name) || 0));
    let pi = 0;
    for (const r of still) {
      const p = pool[pi % pool.length];
      base.push({ person: p.name, rooms: [r.id] });
      usedBy.set(p.name, (usedBy.get(p.name) || 0) + 1);
      pi++;
    }
  }
  return base;
}

/** =========================
 *        Component
 *  ========================= */
export default function App() {
  // language
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") as Lang) || "zh");
  const L = I18N[lang];
  useEffect(() => { localStorage.setItem("lang", lang); }, [lang]);

  // device detection（iPad 归“电脑”）
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isiPad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
    const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
    const isiPhoneOriPod = /iPhone|iPod/i.test(ua);
    setIsMobile(!isiPad && (isAndroidPhone || isiPhoneOriPod));
  }, []);

  // data
  const [loaded, setLoaded] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // wizard
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("Morning Announcement Rota — SUIS GB");
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [rotaCodeIn, setRotaCodeIn] = useState("");
  const [allowedForms, setAllowedForms] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

  // RotaCode + Toast
  const [generatedCode, setGeneratedCode] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = (text: string, ms = 1600) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms);
  };

  // load roster
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

  // import last rota
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

  // helpers
  const filteredRooms = useMemo(() => {
    return rooms.map((r) => ({ ...r, enabled: r.form ? allowedForms.has(r.form) : true }));
  }, [rooms, allowedForms]);

  const statusText = useMemo(() => {
    const activeCount = people.filter((p) => p.active).length;
    const roomCount = filteredRooms.filter((r) => r.enabled).length;
    const needPairs = Math.max(0, roomCount - activeCount);
    return L.status(activeCount, roomCount, needPairs);
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

  function doGenerate() {
    // 是否存在“上一轮数据”
    const hasHistory = people.some((p) => (p.lastRooms?.length || 0) > 0 || p.lastPairKey);
    // 无历史：随机
    const seed = randomSeed();
    const rng = makeRNG(seed);
    const randJitter = hasHistory ? null : rng;

    const A = generateAssignment(people, filteredRooms, randJitter, !hasHistory);
    setAssignments(A);
    setStep(2);

    // 生成 v2 排布码并复制
    const payload = { date: dateStr, assignments: A };
    packRotaCodeV2(payload).then((code) => {
      setGeneratedCode(code);
      navigator.clipboard.writeText(code).then(
        () => showToast(L.copyOk),
        () => showToast(L.codeBoxTitle) // 提示已生成，可手动复制
      );
    });
  }

  // 导出 JPG（下载）
  async function exportJPG() {
    if (!boardRef.current) return;
    const { toJpeg } = await import("html-to-image");
    const dataUrl = await toJpeg(boardRef.current, {
      quality: 0.95,
      pixelRatio: isMobile ? 2 : 3,
      backgroundColor: "#ffffff",
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/\s+/g, "_")}_${dateStr}.jpg`;
    link.click();
  }

  // 复制 JPG 到剪贴板
  async function copyJPGToClipboard() {
    if (!boardRef.current) return;
    const canWrite =
      !!(navigator as any).clipboard &&
      typeof (navigator as any).clipboard.write === "function" &&
      typeof (window as any).ClipboardItem !== "undefined";
    if (!canWrite) {
      showToast(L.copyJPGFail);
      return;
    }
    try {
      const { toJpeg } = await import("html-to-image");
      const dataUrl = await toJpeg(boardRef.current, {
        quality: 0.92,
        pixelRatio: isMobile ? 2 : 3,
        backgroundColor: "#ffffff",
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob(); // image/jpeg
      await (navigator as any).clipboard.write([
        new (window as any).ClipboardItem({ "image/jpeg": blob }),
      ]);
      showToast(L.copyJPGOk);
    } catch (e) {
      console.warn(e);
      showToast(L.copyJPGFail);
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

  // grade parse for sorting 9→12
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

  // ======== 根据 isMobile 自适配样式 ========
  const shellPad = isMobile ? "p-2" : "p-4";
  const wrapW   = isMobile ? "max-w-full" : "max-w-6xl";
  const cardPad = isMobile ? "p-3" : "p-4";
  const headerText = isMobile ? "text-xl" : "text-2xl";
  const listHeight = isMobile ? "h-[38vh]" : "h-64";
  const tableText = isMobile ? "text-[12px] leading-tight" : "text-base";
  const thPad = isMobile ? "p-1.5" : "p-2";
  const tdPad = isMobile ? "p-1.5" : "p-2";
  const btnStack = isMobile ? "flex-col" : "flex-row";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className="bg-white text-black rounded-xl shadow px-4 py-2">{toast.text}</div>
        </div>
      )}

      <div className={`${wrapW} mx-auto ${shellPad}`}>
        <div className={`flex items-center justify-between ${isMobile ? "mb-2" : "mb-0"}`}>
          <div className={`${headerText} font-bold`}>{step === 1 ? I18N[lang].setup : I18N[lang].result}</div>

          {/* 语言切换（准备界面） */}
          {step === 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">{I18N[lang].languageLabel}</span>
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

      {/* STEP 1 */}
      {step === 1 && (
        <div className={`${wrapW} mx-auto ${shellPad}`}>
          <div className={`bg-neutral-900 rounded-2xl ${cardPad}`}>
            {/* 标题 + 日期 + 排布码输入 */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                className={`flex-1 rounded px-3 py-2 bg-neutral-800 border border-neutral-700 ${isMobile ? "text-sm" : ""}`}
                placeholder={I18N[lang].titlePh}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                type="date"
                className={`rounded px-3 py-2 bg-neutral-800 border border-neutral-700 ${isMobile ? "text-sm" : ""}`}
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                aria-label={I18N[lang].date}
                title={I18N[lang].date}
              />
              <input
                className={`w-full md:w-[460px] rounded px-3 py-2 bg-neutral-800 border border-neutral-700 ${isMobile ? "text-sm" : ""}`}
                placeholder={I18N[lang].lastCodePh}
                value={rotaCodeIn}
                onChange={(e) => setRotaCodeIn(e.target.value)}
              />
            </div>

            {/* 状态条 */}
            <div className="mt-2 text-sm text-neutral-400">{statusText}</div>

            {/* 人员选择 & Form 选择 */}
            <div className={`mt-3 grid grid-cols-1 ${isMobile ? "gap-3" : "md:grid-cols-3 gap-4"}`}>
              {/* 人员 */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">{I18N[lang].peopleSel}</div>
                <div className={`${listHeight} overflow-auto divide-y divide-neutral-700 ${isMobile ? "text-sm" : ""}`}>
                  {/* 勾选列表按名字升序；分配时已引入随机 */}
                  {people.slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 py-1">
                      <input type="checkbox" checked={p.active} onChange={() => togglePerson(p.id)} />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Form（移动端换行按钮更紧凑） */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">{I18N[lang].formSel}</div>
                <div className="flex flex-wrap gap-2">
                  {allForms.map((f) => (
                    <button
                      key={f}
                      onClick={() => toggleForm(f)}
                      className={`${allowedForms.has(f) ? "bg-emerald-600" : "bg-neutral-700"} ${isMobile ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"} rounded-full`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* 下一步 */}
              <div className={`flex items-end`}>
                <button
                  onClick={doGenerate}
                  className={`w-full bg-blue-600 hover:bg-blue-700 rounded-xl ${isMobile ? "py-2 text-sm" : "py-3 font-semibold"}`}
                >
                  {I18N[lang].next}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className={`${wrapW} mx-auto ${shellPad}`}>
          {/* 排布码直接展示 */}
          <div className={`bg-neutral-900 rounded-2xl ${cardPad} mb-3`}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">{I18N[lang].codeBoxTitle}</div>
              <button onClick={copyCode} className={`rounded bg-blue-600 hover:bg-blue-700 ${isMobile ? "px-2 py-1 text-sm" : "px-3 py-1.5"}`}>
                {I18N[lang].copy}
              </button>
            </div>
            <textarea
              className={`w-full ${isMobile ? "h-24" : "h-28"} mt-2 rounded bg-neutral-800 border border-neutral-700 p-2 font-mono ${isMobile ? "text-[11px]" : "text-xs"}`}
              readOnly
              value={generatedCode}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>

          {/* 成品卡片 */}
          <div
            ref={boardRef}
            className={`bg-white text-black rounded-2xl ${cardPad} ${tableText}`}
          >
            {/* 页眉 */}
            <div className={`flex items-start justify-between ${isMobile ? "gap-2" : ""}`}>
              <div className={`${isMobile ? "text-base" : "text-xl"} font-bold`}>{title}</div>
              <div className="text-right">
                <div className={`${isMobile ? "text-[11px]" : "text-sm"}`}>{I18N[lang].date}</div>
                <div className={`${isMobile ? "text-sm" : "font-semibold"}`}>{dateStr}</div>
              </div>
            </div>

            {/* 表格（移动端紧凑 + 可横向滚动） */}
            <div className={`mt-3 overflow-x-auto`}>
              <table className="w-full table-fixed border border-gray-300">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className={`${thPad} border whitespace-nowrap`}>{I18N[lang].colFormRoom}</th>
                    <th className={`${thPad} border`}>{I18N[lang].colNameDept}</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms
                    .filter((r) => filteredRooms.find((fr) => fr.id === r.id)?.enabled)
                    .sort((a, b) => {
                      // 先 9→12 年级，再 building→floor→number
                      const ga = gradeOf(a.form), gb = gradeOf(b.form);
                      if (ga !== gb) return ga - gb;
                      if (a.building !== b.building) return a.building.localeCompare(b.building);
                      if (a.floor !== b.floor) return a.floor - b.floor;
                      return a.number - b.number;
                    })
                    .map((r) => {
                      const a = assignments.find((x) => x.rooms.includes(r.id));
                      const formRoom = r.form ? `${r.form} ${r.id}` : r.id;
                      const person = a?.person ?? "";
                      const dept = person ? (people.find((p) => p.name === person)?.dept ?? "") : "";
                      return (
                        <tr key={r.id} className={`${isMobile ? "align-top" : ""}`}>
                          <td className={`${tdPad} border whitespace-nowrap`}>{formRoom}</td>
                          <td className={`${tdPad} border break-words`}>
                            <span className="font-semibold">{person}</span>
                            {dept ? <span className="text-neutral-600"> {dept}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 操作按钮（移动端竖排） */}
          <div className={`mt-3 flex ${btnStack} gap-3`}>
            <button onClick={() => setStep(1)} className={`rounded bg-neutral-700 hover:bg-neutral-600 ${isMobile ? "w-full py-2 text-sm" : "px-3 py-2"}`}>
              {I18N[lang].back}
            </button>
            <button onClick={exportJPG} className={`rounded bg-emerald-600 hover:bg-emerald-700 ${isMobile ? "w-full py-2 text-sm" : "px-3 py-2"}`}>
              {I18N[lang].exportJPG}
            </button>
            <button onClick={copyJPGToClipboard} className={`rounded bg-amber-600 hover:bg-amber-700 ${isMobile ? "w-full py-2 text-sm" : "px-3 py-2"}`}>
              {I18N[lang].copyJPG}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
