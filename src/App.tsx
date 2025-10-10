import React, { useMemo, useRef, useState } from "react";
import { toJpeg } from "html-to-image";
import Munkres from "munkres-js";

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
  id: string;
  building: string;
  number: number;
  floor: number;
  form?: string;
  enabled: boolean;
};

type Slot = { id: string; rooms: string[] };
type Assignment = { person: string; rooms: string[] };

type ParsedExcel = {
  people: Person[];
  rooms: Room[];
  deptColors: Record<string, string>;
  formsSet: string[];
  gradesSet: string[];
};

const expectedLabels = new Set([
  "Academia","Art","Charity","Community","Media","Music","Sports","Theatre",
  "Blue House Captain","Green House Captain","Red House Captain","Yellow House Captain","no need"
]);

const uid = () => Math.random().toString(36).slice(2, 10);
const isNameLike = (s: string) => /[A-Za-z]+\s+[A-Za-z]+/.test(s.trim());
const isDeptWord = (s: string) => expectedLabels.has(s.trim());

function parseRoom(raw: string): { building: string; number: number; floor: number } | null {
  const m = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!m) return null;
  const building = m[1].toUpperCase();
  const number = parseInt(m[2], 10);
  const floor = parseInt(m[2][0], 10);
  return { building, number, floor };
}

function pairKey(a: string, b: string) { return [a, b].sort().join("+"); }

function crc32(str: string) {
  let c = ~0;
  for (let i=0;i<str.length;i++) {
    c ^= str.charCodeAt(i);
    for (let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (~c) >>> 0;
}
function toBase64URL(u8: Uint8Array) {
  let s = btoa(String.fromCharCode(...Array.from(u8)));
  s = s.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return s;
}
function fromBase64URL(s: string) {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  s += "=".repeat(pad);
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function compressUTF8(json: string): Promise<Uint8Array> {
  if ((globalThis as any).CompressionStream) {
    const cs = new (globalThis as any).CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    await writer.write(new TextEncoder().encode(json));
    await writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  return new TextEncoder().encode(json);
}
async function decompressUTF8(u8: Uint8Array): Promise<string> {
  if ((globalThis as any).DecompressionStream) {
    const ds = new (globalThis as any).DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    await writer.write(u8);
    await writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  return new TextDecoder().decode(u8);
}
async function packRotaCode(payload: any): Promise<string> {
  const json = JSON.stringify(payload);
  const comp = await compressUTF8(json);
  const b64 = toBase64URL(comp);
  const crc = crc32(b64).toString(16).toUpperCase().padStart(8, "0");
  return `ROTAv1.${b64}.${crc}`;
}
async function unpackRotaCode(code: string): Promise<any> {
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

// Excel parsing
async function parseExcel(file: File): Promise<ParsedExcel> {
  const XLSX = await import("xlsx-js-style");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellStyles: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(ws, { defval: "" }) as any[];

  const deptColors: Record<string, string> = {};
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  for (let r=range.s.r; r<=range.e.r; r++) {
    for (let c=range.s.c; c<=range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell || typeof cell.v !== "string") continue;
      const text = String(cell.v).trim();
      if (!expectedLabels.has(text)) continue;
      const s = (cell as any).s;
      const rgb = s?.fill?.fgColor?.rgb || s?.fill?.fgColor?.RGB || s?.fill?.fgColor?.argb;
      if (rgb && /^([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6})$/.test(rgb)) {
        const hex = (rgb.length === 8 ? rgb.slice(2) : rgb).toUpperCase();
        deptColors[text] = `#${hex}`;
      }
    }
  }

  const peopleMap = new Map<string, Person>();
  const roomsMap = new Map<string, Room>();
  const formsSet = new Set<string>();

  for (const row of json) {
    const Form = String(row["Form"] || "").trim();
    const RoomRaw = String(row["Room"] || "").trim();
    if (Form) formsSet.add(Form);
    if (RoomRaw) {
      const parsed = parseRoom(RoomRaw);
      if (parsed) {
        roomsMap.set(RoomRaw, {
          id: RoomRaw,
          building: parsed.building,
          number: parsed.number,
          floor: parsed.floor,
          form: Form,
          enabled: true,
        });
      }
    }
    const Prefect = String(row["Prefect"] || "").trim();
    const Role = String(row["Role"] || "").trim();
    let name = ""; let dept = "";
    if (isNameLike(Prefect) && (isDeptWord(Role) || Role === "")) { name = Prefect; dept = Role || ""; }
    else if (isDeptWord(Prefect) && isNameLike(Role)) { name = Role; dept = Prefect; }
    else if (isNameLike(Prefect) && !isNameLike(Role)) { name = Prefect; dept = Role || ""; }
    else if (isNameLike(Role)) { name = Role; dept = Prefect || ""; }
    if (name) {
      if (!peopleMap.has(name)) peopleMap.set(name, { id: uid(), name, dept, active: true, assignedCount: 0 });
      else {
        const p = peopleMap.get(name)!; if (dept && !p.dept) p.dept = dept;
      }
    }
  }

  const gradesSet = Array.from(formsSet)
    .map(f => (f.match(/^(\\d{1,2})/)?.[1] ?? ""))
    .filter(Boolean)
    .sort((a,b)=>Number(a)-Number(b));

  return {
    people: Array.from(peopleMap.values()).sort((a,b)=>a.name.localeCompare(b.name)),
    rooms: Array.from(roomsMap.values()).sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building)),
    deptColors,
    formsSet: Array.from(formsSet).sort(),
    gradesSet: Array.from(new Set(gradesSet)),
  };
}

// Matching + costs
function pairKeyOf(slot: Slot) { return slot.rooms.length===2 ? pairKey(slot.rooms[0],slot.rooms[1]) : ""; }
function makeCost(p: Person, slot: Slot, strong=true): number {
  const lastRooms = new Set(p.lastRooms || []);
  if (strong) {
    for (const r of slot.rooms) if (lastRooms.has(r)) return 1e6;
    if (slot.rooms.length===2 && p.lastPairKey === pairKeyOf(slot)) return 1e6;
  }
  let c = 0;
  for (const r of slot.rooms) if (lastRooms.has(r)) c += 100;
  if (slot.rooms.length===2 && p.lastPairKey === pairKeyOf(slot)) c += 200;
  c += p.assignedCount * 5;
  return c;
}
function greedyAdjacentPairs(rooms: Room[], need: number): Slot[] {
  const sorted = rooms.slice().sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building));
  const used = new Set<string>();
  const pairs: Slot[] = [];
  for (let i=0;i<sorted.length-1 && pairs.length < need;i++) {
    const a = sorted[i], b = sorted[i+1];
    if (used.has(a.id) || used.has(b.id)) continue;
    if (a.building===b.building && a.floor===b.floor && Math.abs(a.number-b.number)===1) {
      pairs.push({ id: pairKey(a.id,b.id), rooms: [a.id,b.id] });
      used.add(a.id); used.add(b.id);
    }
  }
  return pairs;
}
function hungarianAssign(people: Person[], slots: Slot[]): Assignment[] {
  const P = people.length;
  const S = slots.length;
  const N = Math.max(P, S);
  const dummyHigh = 1000;
  const M: number[][] = Array.from({length: N}, ()=> Array(N).fill(0));
  for (let i=0;i<N;i++) {
    for (let j=0;j<N;j++) {
      if (i < P && j < S) M[i][j] = makeCost(people[i], slots[j], true);
      else if (i < P && j >= S) M[i][j] = 500;           // person -> dummy slot
      else if (i >= P && j < S) M[i][j] = dummyHigh;     // dummy person -> real slot (avoid)
      else M[i][j] = 0;                                  // dummy-dummy
    }
  }
  const mk: any = new (Munkres as any)();
  const indexes: [number, number][] = mk.compute(M);
  const out: Assignment[] = [];
  for (const [ri, cj] of indexes) if (ri < P && cj < S) out.push({ person: people[ri].name, rooms: slots[cj].rooms.slice() });
  return out;
}
function generateAssignment(peopleIn: Person[], roomsIn: Room[], seedStr: string): Assignment[] {
  const people = peopleIn.filter(p => p.active);
  const rooms = roomsIn.filter(r => r.enabled);
  if (!people.length || !rooms.length) return [];
  const R = rooms.length, P = people.length;
  const D = R > P ? (R - P) : 0;
  const pairs = greedyAdjacentPairs(rooms, D);
  const used = new Set<string>(pairs.flatMap(p => p.rooms));
  const singles = rooms.filter(r => !used.has(r.id)).map(r => ({ id: r.id, rooms: [r.id] } as Slot));
  const slots: Slot[] = [...pairs, ...singles];
  return hungarianAssign(people, slots);
}

// UI
export default function App() {
  const [parsed, setParsed] = useState<ParsedExcel | null>(null);
  const [title, setTitle] = useState<string>("Morning Announcement Rota — SUIS GB");
  const [dateStr, setDateStr] = useState<string>(() => new Date().toISOString().slice(0,10));
  const [seed, setSeed] = useState<string>(() => Math.random().toString(36).slice(2,6));
  const [rotaCodeIn, setRotaCodeIn] = useState<string>("");
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allowedGrades, setAllowedGrades] = useState<Set<string>>(new Set());

  const boardRef = useRef<HTMLDivElement>(null);

  const filteredRooms = useMemo(() => {
    if (!parsed) return [] as Room[];
    if (allowedGrades.size === 0 && parsed.gradesSet.length) setAllowedGrades(new Set(parsed.gradesSet));
    return parsed.rooms.map(r => ({...r, enabled: r.form ? allowedGrades.has((r.form.match(/^(\\d{1,2})/)?.[1] ?? "")) : true}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, allowedGrades]);

  const peopleForGen = useMemo(() => {
    if (!parsed) return [] as Person[];
    const map = new Map(parsed.people.map(p => [p.name, { ...p }]));
    (async () => {
      if (rotaCodeIn.trim()) {
        try {
          const ro = await unpackRotaCode(rotaCodeIn.trim());
          const A: Assignment[] = ro?.assignments || [];
          for (const a of A) {
            const p = map.get(a.person); if (!p) continue;
            p.lastRooms = a.rooms.slice();
            p.lastPairKey = a.rooms.length===2 ? pairKey(a.rooms[0], a.rooms[1]) : undefined;
          }
        } catch (e) { console.warn("Rota code invalid:", e); }
      }
    })();
    return Array.from(map.values());
  }, [parsed, rotaCodeIn]);

  const formsSet = parsed?.formsSet ?? [];
  const gradesSet = parsed?.gradesSet ?? [];

  async function onExcelChange(file?: File | null) {
    if (!file) return;
    const res = await parseExcel(file);
    setParsed(res);
    setAllowedGrades(new Set(res.gradesSet));
  }
  function toggleGrade(g: string) {
    setAllowedGrades(prev => {
      const n = new Set(prev);
      if (n.has(g)) n.delete(g); else n.add(g);
      return n;
    });
  }
  async function doGenerate() {
    if (!parsed) return;
    const A = generateAssignment(peopleForGen, filteredRooms, seed);
    setAssignments(A);
  }
  async function exportJPG() {
    if (!boardRef.current) return;
    const dataUrl = await toJpeg(boardRef.current, { quality: 0.95, pixelRatio: 3, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/\\s+/g,'_')}_${dateStr}.jpg`;
    link.click();
  }
  async function exportRotaCode() {
    const payload = { date: dateStr, seed, assignments };
    const code = await packRotaCode(payload);
    await navigator.clipboard.writeText(code).catch(()=>{});
    alert("已生成排布码并复制到剪贴板:\\n\\n" + code);
  }

  const [dragPerson, setDragPerson] = useState<string | null>(null);
  function onDragStartPerson(name: string) { setDragPerson(name); }
  function onDropToRoom(roomId: string) {
    if (!dragPerson) return;
    setAssignments(prev => {
      const out: Assignment[] = [];
      for (const a of prev) {
        if (a.rooms.includes(roomId)) {
          const nr = a.rooms.filter(r => r !== roomId);
          if (nr.length > 0) out.push({ person: a.person, rooms: nr });
        } else out.push(a);
      }
      const idx = out.findIndex(x => x.person === dragPerson);
      if (idx >= 0) {
        const cur = out[idx];
        if (cur.rooms.length < 2) out[idx] = { person: cur.person, rooms: [...cur.rooms, roomId] };
        else out[idx] = { person: cur.person, rooms: [cur.rooms[0], roomId] };
      } else out.push({ person: dragPerson, rooms: [roomId] });
      return out;
    });
    setDragPerson(null);
  }
  function colorForPerson(p: Person): string | undefined {
    if (!parsed) return undefined;
    if (p.dept && parsed.deptColors[p.dept]) return parsed.deptColors[p.dept];
    return undefined;
  }
  function assignedForRoom(rid: string): Assignment | null {
    for (const a of assignments) if (a.rooms.includes(rid)) return a;
    return null;
  }
  function personHasTwo(a: Assignment): boolean { return a.rooms.length === 2; }

  const boardGroups = useMemo(() => {
    if (!parsed) return [] as { key: string; rooms: Room[] }[];
    const enabledRooms = filteredRooms.filter(r => r.enabled);
    const groups = new Map<string, Room[]>();
    for (const r of enabledRooms) {
      const k = `${r.building}-F${r.floor}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    return Array.from(groups.entries()).sort((a,b)=> a[0].localeCompare(b[0]))
      .map(([key, rooms]) => ({ key, rooms: rooms.sort((a,b)=> a.number-b.number) }));
  }, [filteredRooms, parsed]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="w-full border-b bg-white sticky top-0 z-50">
        <div className="max-w-7xl mx-auto p-4 flex flex-wrap items-center gap-3">
          <div className="font-semibold text-lg">Rota Builder — Offline (MVP)</div>
          <label className="ml-auto flex items-center gap-2 text-sm">Seed
            <input className="border rounded px-2 py-1" value={seed} onChange={e=>setSeed(e.target.value)} />
          </label>
          <button className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700" onClick={doGenerate}>生成排布</button>
          <button className="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700" onClick={exportJPG}>导出 JPG</button>
          <button className="px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700" onClick={exportRotaCode}>导出排布码</button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-white rounded-2xl shadow p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input className="flex-1 border rounded px-3 py-2" value={title} onChange={e=>setTitle(e.target.value)} placeholder="表格标题" />
            <input type="date" className="border rounded px-3 py-2" value={dateStr} onChange={e=>setDateStr(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              导入 Excel
              <input type="file" accept=".xlsx,.xls" onChange={e=>onExcelChange(e.target.files?.[0])} />
            </label>
          </div>
          <div className="mt-4 text-sm text-gray-500">默认标题已设为 <b>SUIS GB</b>；你可直接修改。排布避免重复：仅需在下方粘贴“上一轮排布码”。</div>

          <div className="mt-4">
            <label className="text-sm font-medium">上一轮排布码（粘贴 1 条即可）</label>
            <textarea className="w-full border rounded px-3 py-2 mt-2" rows={2} placeholder="ROTAv1...."
              value={rotaCodeIn} onChange={e=>setRotaCodeIn(e.target.value)} />
            <div className="text-xs text-gray-500 mt-1">只看最近 1 轮；若排布码损坏会在控制台给出警告。</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4">
          <div className="font-semibold mb-2">年级过滤（临时取消某年级）</div>
          {gradesSet.length === 0 && <div className="text-sm text-gray-500">请先导入 Excel</div>}
          <div className="flex flex-wrap gap-2">
            {gradesSet.map(g => (
              <button key={g}
                className={(allowedGrades.has(g) ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700") + " px-3 py-1.5 rounded-full text-sm"}
                onClick={()=>toggleGrade(g)}>{g}</button>
            ))}
          </div>

          <div className="mt-4 font-semibold mb-2">临时剔除人员</div>
          <div className="h-56 overflow-auto border rounded p-2">
            {!parsed && <div className="text-sm text-gray-500">请先导入 Excel</div>}
            {parsed && parsed.people.map(p => (
              <label key={p.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={p.active}
                  onChange={() => setParsed(prev => prev ? ({...prev, people: prev.people.map(x => x.id===p.id?{...x, active:!x.active}:x)}) : prev)} />
                <span>{p.name}</span>
                {p.dept && <span className="ml-auto inline-flex items-center gap-1">
                  <span className="text-gray-500">{p.dept}</span>
                  {parsed.deptColors[p.dept] && <span className="w-3 h-3 rounded" style={{background: parsed.deptColors[p.dept]}}/>}
                </span>}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <div ref={boardRef} className="bg-white rounded-2xl shadow p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xl font-bold">{title}</div>
              <div className="text-sm text-gray-500">Forms: {formsSet.join(", ")}</div>
            </div>
            <div className="text-right">
              <div className="text-sm">Date</div>
              <div className="font-semibold">{dateStr}</div>
            </div>
          </div>

          <div className="mt-6 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {boardGroups.map(g => (
              <div key={g.key} className="border rounded-xl p-3">
                <div className="font-semibold mb-2">{g.key}</div>
                <div className="space-y-2">
                  {g.rooms.map(r => {
                    const a = assignedForRoom(r.id);
                    return (
                      <div key={r.id}
                        className="border rounded-lg p-2 hover:bg-gray-50"
                        onDragOver={e=>e.preventDefault()}
                        onDrop={()=>onDropToRoom(r.id)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-mono w-16">{r.id}</div>
                          {a ? (
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-sm" style={{background: parsed?.people.find(p=>p.name===a.person)?.dept && parsed?.deptColors[parsed?.people.find(p=>p.name===a.person)?.dept!] ? parsed!.deptColors[parsed!.people.find(p=>p.name===a.person)!.dept!] : undefined}}>
                                {a.person}
                              </span>
                              {personHasTwo(a) && <span className="text-xs text-gray-500">(2 rooms)</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">未分配（可拖拽人员到此）</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="font-semibold mb-2">人员（拖拽到教室上可手动修改）</div>
            <div className="flex flex-wrap gap-2">
              {parsed?.people.filter(p=>p.active).map(p => (
                <div key={p.id}
                  draggable
                  onDragStart={()=>onDragStartPerson(p.name)}
                  className="px-2 py-1 rounded border cursor-grab active:cursor-grabbing"
                  style={{background: colorForPerson(p)}}
                >{p.name}{p.dept?` · ${p.dept}`:""}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 text-xs text-gray-500">
        <div>说明：1) 年级按 Form 开头数字识别；2) 默认标题包含 SUIS GB；3) 排布码只看上一轮（粘贴 1 条）。</div>
      </div>
    </div>
  );
}
