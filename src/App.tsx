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

/** ---- 上一轮排布码（压缩/校验） ---- */
function crc32(str: string) {
  let c = ~0;
  for (let i = 0; i < str.length; i++) {
    c ^= str.charCodeAt(i);
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (~c) >>> 0;
}
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
async function compressUTF8(json: string) {
  if ((globalThis as any).CompressionStream) {
    const cs = new (globalThis as any).CompressionStream("deflate-raw");
    const w = cs.writable.getWriter();
    await w.write(new TextEncoder().encode(json));
    await w.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  return new TextEncoder().encode(json);
}
async function decompressUTF8(u8: Uint8Array) {
  if ((globalThis as any).DecompressionStream) {
    const ds = new (globalThis as any).DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter();
    await w.write(u8);
    await w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  return new TextDecoder().decode(u8);
}
async function packRotaCode(payload: any) {
  const json = JSON.stringify(payload);
  const comp = await compressUTF8(json);
  const b64 = toBase64URL(comp);
  const crc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  return `ROTAv1.${b64}.${crc}`;
}
async function unpackRotaCode(code: string) {
  if (!code.startsWith("ROTAv1.")) throw new Error("Bad version");
  const parts = code.split(".");
  if (parts.length < 3) throw new Error("Malformed code");
  const b64 = parts.at(1)!;
  const crc = parts.at(2)!;
  const calc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  if (calc !== crc) throw new Error("CRC mismatch");
  const u8 = fromBase64URL(b64);
  const json = await decompressUTF8(u8);
  return JSON.parse(json);
}

/** ---- roster.json ---- */
async function loadRoster(): Promise<{ people: Person[]; rooms: Room[]; deptColors: Record<string, string> }> {
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
    })
    .sort((a, b) =>
      a.building === b.building
        ? a.floor === b.floor
          ? a.number - b.number
          : a.floor - b.floor
        : a.building.localeCompare(b.building)
    );

  return { people, rooms, deptColors: j.deptColors || {} };
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
    const a = sorted[i],
      b = sorted[i + 1];
    if (used.has(a.id) || used.has(b.id)) continue;
    if (a.building === b.building && a.floor === b.floor && Math.abs(a.number - b.number) === 1) {
      pairs.push({ id: pairKey(a.id, b.id), rooms: [a.id, b.id] });
      used.add(a.id);
      used.add(b.id);
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
    used.add(c.a.id);
    used.add(c.b.id);
  }
  return picked;
}

function hungarianAssign(people: Person[], slots: Slot[]): Assignment[] {
  const P = people.length,
    S = slots.length,
    N = Math.max(P, S);
  const M: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i < P && j < S) M[i][j] = makeCost(people[i], slots[j], true);
      else if (i < P && j >= S) M[i][j] = 500; // person -> dummy
      else if (i >= P && j < S) M[i][j] = 1000; // dummy -> real slot（尽量避免）
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

  const R = enabledRooms.length,
    P = people.length;
  const D = Math.max(0, R - P); // 需要二班的数量

  // 先相邻，再最近邻补齐
  const used = new Set<string>();
  const pairs1 = greedyAdjacentPairs(enabledRooms, D, used);
  let pairs = pairs1.slice();
  if (pairs.length < D) {
    const extra = fillPairsByNearest(enabledRooms, D - pairs.length, used);
    pairs = pairs.concat(extra);
  }

  // singles = 未被配对的房间
  const singles: Slot[] = enabledRooms.filter((r) => !used.has(r.id)).map((r) => ({ id: r.id, rooms: [r.id] }));
  const slots: Slot[] = [...pairs, ...singles]; // slots 数量 = min(R, P)

  // Hungarian
  const base = hungarianAssign(people, slots);

  // 兜底：极端情况下仍有漏房，强行分配给“当轮最少用的人”
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
  const [deptColors, setDeptColors] = useState<Record<string, string>>({});
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

  // modal for RotaCode
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [copied, setCopied] = useState(false);

  // load once
  useEffect(() => {
    loadRoster()
      .then(({ people, rooms, deptColors }) => {
        setDeptColors(deptColors);
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

  // apply last rota code (上一轮)
  useEffect(() => {
    if (!rotaCodeIn.trim() || !people.length) return;
    (async () => {
      try {
        const ro = await unpackRotaCode(rotaCodeIn.trim());
        const map = new Map(people.map((p) => [p.name, p]));
        for (const a of ro?.assignments || []) {
          const p = map.get(a.person);
          if (p) {
            p.lastRooms = a.rooms.slice();
            p.lastPairKey = a.rooms.length === 2 ? pairKey(a.rooms[0], a.rooms[1]) : undefined;
          }
        }
        setPeople(Array.from(map.values()));
      } catch (e) {
        console.warn("Rota code invalid:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotaCodeIn, people.length]);

  // derived filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.map((r) => ({ ...r, enabled: r.form ? allowedForms.has(r.form) : true }));
  }, [rooms, allowedForms]);

  // status check
  const statusText = useMemo(() => {
    const activeCount = people.filter((p) => p.active).length;
    const roomCount = filteredRooms.filter((r) => r.enabled).length;
    const needPairs = Math.max(0, roomCount - activeCount);
    return `人员: ${activeCount}，房间: ${roomCount}（需 ${needPairs} 位二班）`;
  }, [people, filteredRooms]);

  function toggleForm(form: string) {
    setAllowedForms((prev) => {
      const n = new Set(prev);
      if (n.has(form)) n.delete(form);
      else n.add(form);
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

  /** 新功能：导出排布码 → 弹窗展示 + 一键复制 */
  async function exportRotaCode() {
    const payload = { date: dateStr, assignments };
    const code = await packRotaCode(payload);
    setGeneratedCode(code);
    setShowCodeModal(true);
    // 尝试自动复制（失败也不报错）
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("复制失败，请手动选中复制。");
    }
  }

  if (!loaded)
    return <div className="min-h-screen flex items-center justify-center text-neutral-400">Loading roster…</div>;

  const allForms = Array.from(new Set(rooms.map((r) => r.form || ""))).filter(Boolean).sort();

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto p-4">
        <div className="text-2xl font-bold">{step === 1 ? "准备界面" : "成品界面"}</div>
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="max-w-6xl mx-auto p-4">
          <div className="bg-neutral-900 rounded-2xl p-4">
            {/* 标题 + 日期 + 排布码 */}
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
                className="w-full md:w-[420px] rounded px-3 py-2 bg-neutral-800 border border-neutral-700"
                placeholder="上一轮排布码（可选）"
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
                    <th className="p-2 border">部门 + 姓名</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms
                    .filter((r) => filteredRooms.find((fr) => fr.id === r.id)?.enabled)
                    .sort((a, b) => {
                      const fa = a.form || "zzz",
                        fb = b.form || "zzz";
                      if (fa !== fb) return fa.localeCompare(fb);
                      if (a.building !== b.building) return a.building.localeCompare(b.building);
                      if (a.floor !== b.floor) return a.floor - b.floor;
                      return a.number - b.number;
                    })
                    .map((r) => {
                      const a = assignments.find((x) => x.rooms.includes(r.id));
                      const formRoom = r.form ? `${r.form} ${r.id}` : r.id; // 固定显示：Form Room
                      const dept = a ? people.find((p) => p.name === a.person)?.dept : undefined;
                      return (
                        <tr key={r.id}>
                          <td className="p-2 border">{formRoom}</td>
                          <td className="p-2 border">
                            <span className="align-middle">{dept ? `${dept} ` : ""}{a?.person ?? ""}</span>
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
            <button onClick={exportRotaCode} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-700">
              导出排布码
            </button>
          </div>
        </div>
      )}

      {/* RotaCode 弹窗 */}
      {showCodeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white text-black w-[92vw] max-w-2xl rounded-2xl shadow-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-lg font-semibold">排布码</div>
              <button
                onClick={() => setShowCodeModal(false)}
                className="px-2 py-1 rounded bg-neutral-200 hover:bg-neutral-300"
              >
                关闭
              </button>
            </div>

            <div className="mt-3">
              <textarea
                className="w-full h-36 rounded border border-neutral-300 p-2 font-mono text-sm"
                readOnly
                value={generatedCode}
                onFocus={(e) => e.currentTarget.select()}
              />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button onClick={copyCode} className="px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white">
                复制到剪贴板
              </button>
              {copied && <span className="text-emerald-600 text-sm">已复制 ✅</span>}
            </div>

            <div className="mt-2 text-xs text-neutral-600">
              小贴士：你也可以手动全选（Ctrl/Cmd + A）后复制发给同事；下次生成时粘贴这串排布码，可避免重复去同一间教室。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
