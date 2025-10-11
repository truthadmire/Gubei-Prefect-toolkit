import React, { useEffect, useMemo, useRef, useState } from "react";
import Munkres from "munkres-js";

/** =========================
 *        Type 定义
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
  deptColors?: Record<string, string>;
};

/** =========================
 *        工具函数
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

/** ---- 排布码（跨浏览器稳定） ----
 *  ROTAv2：不压缩，直接 UTF-8 → base64url（所有浏览器都能解）
 *  同时兼容 ROTAv1（之前可能压缩过）
 */
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

// v2（推荐）：无压缩
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

// 兼容旧的 v1：若设备不支持解压，尝试直接按“无压缩”解
async function unpackRotaCodeCompat(code: string) {
  // 优先 v2
  if (code.startsWith("ROTAv2.")) return unpackRotaCodeV2(code);

  // v1（可能压缩也可能无压缩）
  if (!code.startsWith("ROTAv1.")) throw new Error("Unknown code");
  const parts = code.split(".");
  if (parts.length < 3) throw new Error("Malformed");
  const b64 = parts[1];
  const crc = parts[2];
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");

  // 先按“无压缩”尝试（兼容有人在不支持解压的设备上生成）
  try {
    const u8raw = fromBase64URL(b64);
    const raw = new TextDecoder().decode(u8raw);
    return JSON.parse(raw);
  } catch {}

  // 再尝试浏览器原生解压（若有）
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

  const people: Person[] = j.people
    .map((p) => ({
      id: uid(),
      name: p.name,
      dept: p.dept, // 接受任何部门名
      active: true,
      assignedCount: 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rooms: Room[] = j.rooms
    .map((rr) => {
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
 *        匹配算法
 *  ========================= */
function makeCost(p: Person, slot: Slot, strong = true): number {
  const last = new Set(p.lastRooms || []);
  if (strong) {
    for (const r of slot.rooms) if (last.has(r)) return 1e6; // 连续同房禁止
    if (slot.rooms.length === 2 && p.lastPairKey === pairKey(slot.rooms[0], slot.rooms[1])) return 1e6; // 连续同房对禁止
  }
  let c = 0;
  for (const r of slot.rooms) if (last.has(r)) c += 100; // 软惩罚（上一轮同房）
  if (slot.rooms.length === 2 && p.lastPairKey === pairKey(slot.rooms[0], slot.rooms[1])) c += 200; // 软惩罚（上一轮同房对）
  c += p.assignedCount * 5; // 公平性
  return c;
}

// 相邻优先的贪心配对
function greedyAdjacentPairs(rooms: Room[], need: number, used: Set<string>): Slot[] {
  const sorted = rooms
    .slice()
    .sort((a, b) =>
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

// 不足相邻对时，用“最近邻距离”补足配对（同楼同层优先）
function distance(a: Room, b: Room): number {
  if (a.building !== b.building) return 1e9 + Math.abs(a.number - b.number);
  const floorPenalty = Math.abs(a.floor - b.floor) * 1000; // 楼层差距重罚
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

function hungarianAssign(people: Person[], slots: Slot[]): Assignment[] {
  const P = people.length, S = slots.length, N = Math.max(P, S);
  const M: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i < P && j < S) M[i][j] = makeCost(people[i], slots[j], true);
      else if (i < P && j >= S) M[i][j] = 500;   // person -> dummy
      else if (i >= P && j < S) M[i][j] = 1000;  // dummy -> real slot (尽量避免)
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

// 生成：保证“房间必有人”
function generateAssignment(peopleIn: Person[], roomsIn: Room[]): Assignment[] {
  const people = peopleIn.filter((p) => p.active);
  const enabledRooms = roomsIn.filter((r) => r.enabled);
  if (!people.length || !enabledRooms.length) return [];

  const R = enabledRooms.length, P = people.length;
  const D = Math.max(0, R - P); // 需要二班的数量

  const used = new Set<string>();
  const pairs1 = greedyAdjacentPairs(enabledRooms, D, used);
  let pairs = pairs1.slice();
  if (pairs.length < D) {
    const extra = fillPairsByNearest(enabledRooms, D - pairs.length, used);
    pairs = pairs.concat(extra);
  }

  const singles: Slot[] = enabledRooms.filter((r) => !used.has(r.id)).map((r) => ({ id: r.id, rooms: [r.id] }));
  const slots: Slot[] = [...pairs, ...singles]; // slots 数量 = min(R, P)

  const base = hungarianAssign(people, slots);

  // 兜底：任何遗漏的房间也强行分给“当轮最少被用的人”
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
 *        组件主体
 *  ========================= */
export default function App() {
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

  // RotaCode 展示 & Toast
  const [generatedCode, setGeneratedCode] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = (text: string, ms = 1600) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms);
  };

  // load once
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

  // 应用上一轮排布码（只需贴最近一条）
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
        showToast("已导入上一轮排布码");
      } catch (e: any) {
        console.warn(e);
        showToast("排布码无效或不兼容");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotaCodeIn, people.length]);

  // 过滤后的房间
  const filteredRooms = useMemo(() => {
    return rooms.map((r) => ({ ...r, enabled: r.form ? allowedForms.has(r.form) : true }));
  }, [rooms, allowedForms]);

  // 状态条
  const statusText = useMemo(() => {
    const activeCount = people.filter((p) => p.active).length;
    const roomCount = filteredRooms.filter((r) => r.enabled).length;
    const needPairs = Math.max(0, roomCount - activeCount);
    return `人员: ${activeCount}，房间: ${roomCount}（需 ${needPairs} 位二班）`;
  }, [people, filteredRooms]);

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
    const A = generateAssignment(people, filteredRooms);
    setAssignments(A);
    setStep(2);

    // 生成并展示 v2 排布码
    const payload = { date: dateStr, assignments: A };
    packRotaCodeV2(payload).then((code) => {
      setGeneratedCode(code);
      // 自动尝试复制
      navigator.clipboard.writeText(code).then(
        () => showToast("排布码已复制"),
        () => showToast("已生成排布码，可手动复制")
      );
    });
  }

  async function exportJPG() {
    if (!boardRef.current) return;
    const { toJpeg } = await import("html-to-image"); // 动态导入，减小主包
    const dataUrl = await toJpeg(boardRef.current, { quality: 0.95, pixelRatio: 3, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/\s+/g, "_")}_${dateStr}.jpg`;
    link.click();
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      showToast("排布码已复制");
    } catch {
      showToast("复制失败，请手动选择复制");
    }
  }

  // 解析 form 的年级（用于排序）
  const gradeOf = (form?: string) => {
    if (!form) return 999;
    const m = form.match(/^(\d{1,2})/);
    if (!m) return 999;
    const g = parseInt(m[1], 10);
    if (g >= 9 && g <= 12) return g;
    return 999;
  };

  if (!loaded)
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading roster…</div>;

  const allForms = Array.from(new Set(rooms.map((r) => r.form || ""))).filter(Boolean).sort();

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className="bg-white text-black rounded-xl shadow px-4 py-2">
            {toast.text}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4">
        <div className="text-2xl font-bold">{step === 1 ? "准备界面" : "成品界面"}</div>
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="max-w-6xl mx-auto p-4">
          <div className="bg-neutral-900 rounded-2xl p-4">
            {/* 标题 + 日期 + 排布码输入 */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                className="flex-1 rounded px-3 py-2 bg-neutral-800 border border-neutral-700"
                placeholder="输入标题（默认含 SUIS GB）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <input
                type="date"
                className="rounded px-3 py-2 bg-neutral-800 border border-neutral-700"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
              <input
                className="w-full md:w-[460px] rounded px-3 py-2 bg-neutral-800 border border-neutral-700"
                placeholder="上一轮排布码（粘贴最近一条；支持 v1/v2）"
                value={rotaCodeIn}
                onChange={(e) => setRotaCodeIn(e.target.value)}
              />
            </div>

            {/* 状态条 */}
            <div className="mt-3 text-sm text-neutral-400">{statusText}</div>

            {/* 人员选择 & Form 选择 */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 人员 */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">人员选择</div>
                <div className="h-64 overflow-auto divide-y divide-neutral-700">
                  {people.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 py-1">
                      <input type="checkbox" checked={p.active} onChange={() => togglePerson(p.id)} />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Form */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">班级（Form）选择</div>
                <div className="flex flex-wrap gap-2">
                  {allForms.map((f) => (
                    <button
                      key={f}
                      onClick={() => toggleForm(f)}
                      className={(allowedForms.has(f) ? "bg-emerald-600" : "bg-neutral-700") + " px-3 py-1.5 rounded-full text-sm"}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* 下一步 */}
              <div className="flex items-end">
                <button onClick={doGenerate} className="w-full bg-blue-600 hover:bg-blue-700 rounded-xl py-3 font-semibold">
                  下一步
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="max-w-6xl mx-auto p-4">
          {/* 排布码直接展示 */}
          <div className="bg-neutral-900 rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">排布码（已生成，粘贴到下一轮以避免重复）</div>
              <button onClick={copyCode} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700">复制</button>
            </div>
            <textarea
              className="w-full h-28 mt-2 rounded bg-neutral-800 border border-neutral-700 p-2 font-mono text-xs"
              readOnly
              value={generatedCode}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>

          <div ref={boardRef} className="bg-white text-black rounded-2xl p-4">
            {/* 页眉 */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-bold">{title}</div>
              </div>
              <div className="text-right">
                <div className="text-sm">Date</div>
                <div className="font-semibold">{dateStr}</div>
              </div>
            </div>

            {/* 表格 */}
            <div className="mt-4 overflow-auto">
              <table className="w-full border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="p-2 border">班级 + 房号</th>
                    <th className="p-2 border">姓名 + 部门</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms
                    .filter((r) => filteredRooms.find((fr) => fr.id === r.id)?.enabled)
                    .sort((a, b) => {
                      // 先按年级 9→12，再按房间先后（building→floor→number）
                      const ga = gradeOf(a.form), gb = gradeOf(b.form);
                      if (ga !== gb) return ga - gb;
                      if (a.building !== b.building) return a.building.localeCompare(b.building);
                      if (a.floor !== b.floor) return a.floor - b.floor;
                      return a.number - b.number;
                    })
                    .map((r) => {
                      const a = assignments.find((x) => x.rooms.includes(r.id));
                      const formRoom = r.form ? `${r.form} ${r.id}` : r.id; // 固定显示：Form Room
                      const person = a?.person ?? "";
                      const dept = person ? (people.find((p) => p.name === person)?.dept ?? "") : "";
                      return (
                        <tr key={r.id}>
                          <td className="p-2 border">{formRoom}</td>
                          <td className="p-2 border">
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

          {/* 操作按钮 */}
          <div className="mt-3 flex gap-3">
            <button onClick={() => setStep(1)} className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600">
              返回
            </button>
            <button onClick={exportJPG} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700">
              导出 JPG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
