import React, { useEffect, useMemo, useRef, useState } from "react";
import Munkres from "munkres-js";

// ---------- Types ----------
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
  id: string;      // e.g. N203
  form?: string;   // e.g. 9MY
  building: string;// N
  number: number;  // 203
  floor: number;   // 2
  enabled: boolean;
};
type Slot = { id: string; rooms: string[] };
type Assignment = { person: string; rooms: string[] };
type RosterJson = {
  people: { name: string; dept?: string }[];
  rooms: { id: string; form?: string }[];
  deptColors?: Record<string, string>;
};

// ---------- Utils ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const expectedLabels = new Set([
  "Academia","Art","Charity","Community","Media","Music","Sports","Theatre",
  "Blue House Captain","Green House Captain","Red House Captain","Yellow House Captain","no need"
]);
const isDeptWord = (s?: string) => !!s && expectedLabels.has(s);

// room parser
function parseRoomId(raw: string): { building: string; number: number; floor: number } | null {
  const m = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!m) return null;
  const building = m[1].toUpperCase();
  const number = parseInt(m[2], 10);
  const floor = parseInt(m[2][0], 10);
  return { building, number, floor };
}
// N10几 代号
const aliasCode = (r: Room) => `${r.building}${r.floor}0几`;
// pair key
const pairKey = (a: string, b: string) => [a, b].sort().join("+");

// RotaCode (保持不变，上一轮只用一条)
function crc32(str: string) {
  let c = ~0; for (let i=0;i<str.length;i++){ c^=str.charCodeAt(i); for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); }
  return (~c)>>>0;
}
function toBase64URL(u8: Uint8Array){ let s=btoa(String.fromCharCode(...Array.from(u8))); return s.replaceAll("+","-").replaceAll("/","_").replaceAll("=",""); }
function fromBase64URL(s: string){ s=s.replaceAll("-","+").replaceAll("_","/"); const pad=s.length%4?4-(s.length%4):0; s+="=".repeat(pad); const bin=atob(s); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); return u8; }
async function compressUTF8(json: string){ if((globalThis as any).CompressionStream){ const cs=new (globalThis as any).CompressionStream("deflate-raw"); const w=cs.writable.getWriter(); await w.write(new TextEncoder().encode(json)); await w.close(); const buf=await new Response(cs.readable).arrayBuffer(); return new Uint8Array(buf);} return new TextEncoder().encode(json); }
async function decompressUTF8(u8: Uint8Array){ if((globalThis as any).DecompressionStream){ const ds=new (globalThis as any).DecompressionStream("deflate-raw"); const w=ds.writable.getWriter(); await w.write(u8); await w.close(); const buf=await new Response(ds.readable).arrayBuffer(); return new TextDecoder().decode(buf);} return new TextDecoder().decode(u8); }
async function packRotaCode(payload:any){ const json=JSON.stringify(payload); const comp=await compressUTF8(json); const b64=toBase64URL(comp); const crc=crc32(b64).toString(16).toUpperCase().padStart(8,"0"); return `ROTAv1.${b64}.${crc}`;}
async function unpackRotaCode(code:string){ if(!code.startsWith("ROTAv1.")) throw new Error("Bad version"); const parts=code.split("."); if(parts.length<3) throw new Error("Malformed code"); const b64=parts.at(1)!; const crc=parts.at(2)!; const calc=crc32(b64).toString(16).toUpperCase().padStart(8,"0"); if(calc!==crc) throw new Error("CRC mismatch"); const u8=fromBase64URL(b64); const json=await decompressUTF8(u8); return JSON.parse(json); }

// ---------- Data loading (from /roster.json) ----------
async function loadRoster(): Promise<{people: Person[]; rooms: Room[]; deptColors: Record<string,string>}> {
  const res = await fetch("/roster.json");
  if (!res.ok) throw new Error("roster.json not found");
  const j: RosterJson = await res.json();

  const deptColors: Record<string,string> = j.deptColors || {};

  const people: Person[] = j.people.map(p => ({
    id: uid(),
    name: p.name,
    dept: isDeptWord(p.dept) ? p.dept : undefined,
    active: true,
    assignedCount: 0
  })).sort((a,b)=>a.name.localeCompare(b.name));

  const rooms: Room[] = j.rooms.map(rr => {
    const parsed = parseRoomId(rr.id);
    if (!parsed) throw new Error(`Bad room id: ${rr.id}`);
    return { id: rr.id, form: rr.form, building: parsed.building, number: parsed.number, floor: parsed.floor, enabled: true };
  }).sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building));

  return { people, rooms, deptColors };
}

// ---------- Matching ----------
function makeCost(p: Person, slot: Slot, strong=true): number {
  const last = new Set(p.lastRooms || []);
  if (strong){
    for (const r of slot.rooms) if (last.has(r)) return 1e6; // 连续同房禁止
    if (slot.rooms.length===2 && p.lastPairKey === pairKey(slot.rooms[0],slot.rooms[1])) return 1e6; // 连续同房对禁止
  }
  let c = 0;
  for (const r of slot.rooms) if (last.has(r)) c += 100;   // 软惩罚
  if (slot.rooms.length===2 && p.lastPairKey === pairKey(slot.rooms[0],slot.rooms[1])) c += 200;
  c += p.assignedCount * 5; // 公平性
  return c;
}
function greedyAdjacentPairs(rooms: Room[], need: number): Slot[] {
  const sorted = rooms.slice().sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building));
  const used = new Set<string>(); const pairs: Slot[] = [];
  for (let i=0;i<sorted.length-1 && pairs.length<need;i++){
    const a=sorted[i], b=sorted[i+1];
    if (used.has(a.id)||used.has(b.id)) continue;
    if (a.building===b.building && a.floor===b.floor && Math.abs(a.number-b.number)===1){
      pairs.push({ id: pairKey(a.id,b.id), rooms: [a.id,b.id] }); used.add(a.id); used.add(b.id);
    }
  }
  return pairs;
}
function hungarianAssign(people: Person[], slots: Slot[]): Assignment[] {
  const P = people.length, S = slots.length, N = Math.max(P,S);
  const M: number[][] = Array.from({length:N},()=>Array(N).fill(0));
  for (let i=0;i<N;i++){
    for (let j=0;j<N;j++){
      if (i<P && j<S) M[i][j] = makeCost(people[i], slots[j], true);
      else if (i<P && j>=S) M[i][j] = 500;     // person -> dummy
      else if (i>=P && j<S) M[i][j] = 1000;    // dummy -> real slot (尽量避免)
      else M[i][j] = 0;
    }
  }
  const MunkresCtor: any = (Munkres as any)?.Munkres || (Munkres as any);
  const mk: any = new MunkresCtor();
  const idxs: [number,number][] = mk.compute(M);
  const out: Assignment[] = [];
  for (const [ri,cj] of idxs) if (ri<P && cj<S) out.push({ person: people[ri].name, rooms: slots[cj].rooms.slice() });
  return out;
}
function generateAssignment(peopleIn: Person[], roomsIn: Room[]): Assignment[] {
  const people = peopleIn.filter(p=>p.active);
  const rooms  = roomsIn.filter(r=>r.enabled);
  if (!people.length || !rooms.length) return [];
  const R = rooms.length, P = people.length;
  const D = R>P ? (R-P) : 0; // 需要的双房位数量
  const pairs = greedyAdjacentPairs(rooms, D);
  const used = new Set<string>(pairs.flatMap(p=>p.rooms));
  const singles: Slot[] = rooms.filter(r=>!used.has(r.id)).map(r=>({id:r.id, rooms:[r.id]}));
  const slots: Slot[] = [...pairs, ...singles];
  return hungarianAssign(people, slots);
}

// ---------- UI (two-step wizard) ----------
export default function App(){
  // data
  const [loaded, setLoaded] = useState(false);
  const [deptColors, setDeptColors] = useState<Record<string,string>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  // wizard
  const [step, setStep] = useState<1|2>(1);
  const [title, setTitle] = useState("Morning Announcement Rota — SUIS GB");
  const [dateStr, setDateStr] = useState(()=>new Date().toISOString().slice(0,10));
  const [rotaCodeIn, setRotaCodeIn] = useState("");
  const [allowedGrades, setAllowedGrades] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

  // load once
  useEffect(()=>{
    loadRoster().then(({people, rooms, deptColors})=>{
      setDeptColors(deptColors);
      setPeople(people);
      setRooms(rooms);
      // init grades
      const grades = Array.from(new Set(rooms.map(r=>(r.form?.match(/^(\d{1,2})/)?.[1] ?? ""))).values()).filter(Boolean).sort((a,b)=>+a-+b);
      setAllowedGrades(new Set(grades));
      setLoaded(true);
    }).catch(e=>{
      console.error(e);
      alert("无法加载 roster.json，请确认已放在 public/ 目录。");
    });
  },[]);

  // apply last rota code (上一轮)
  useEffect(()=>{
    if (!rotaCodeIn.trim()) return;
    (async ()=>{
      try{
        const ro = await unpackRotaCode(rotaCodeIn.trim());
        const map = new Map(people.map(p=>[p.name,p]));
        for (const a of (ro?.assignments||[])){
          const p = map.get(a.person);
          if (p){ p.lastRooms = a.rooms.slice(); p.lastPairKey = a.rooms.length===2 ? pairKey(a.rooms[0],a.rooms[1]) : undefined; }
        }
        setPeople(Array.from(map.values()));
      }catch(e){ console.warn("Rota code invalid:", e); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotaCodeIn]);

  // derived filtered rooms
  const filteredRooms = useMemo(()=>{
    return rooms.map(r => ({...r, enabled: r.form ? allowedGrades.has((r.form.match(/^(\d{1,2})/)?.[1] ?? "")) : true}));
  },[rooms, allowedGrades]);

  // status check
  const statusText = useMemo(()=>{
    const activeCount = people.filter(p=>p.active).length;
    const roomCount = filteredRooms.filter(r=>r.enabled).length;
    const needPairs = Math.max(0, roomCount - activeCount);
    return `人员: ${activeCount}，房间: ${roomCount}（需 ${needPairs} 位二班）`;
  },[people, filteredRooms]);

  function toggleGrade(g: string){
    setAllowedGrades(prev => {
      const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n;
    });
  }
  function togglePerson(id: string){
    setPeople(prev => prev.map(p => p.id===id ? {...p, active: !p.active} : p));
  }

  function doGenerate(){
    const A = generateAssignment(people, filteredRooms);
    setAssignments(A);
    setStep(2);
  }

  async function exportJPG(){
    if (!boardRef.current) return;
    const { toJpeg } = await import("html-to-image"); // 动态导入，减小主包
    const dataUrl = await toJpeg(boardRef.current, { quality: 0.95, pixelRatio: 3, backgroundColor: "#ffffff" });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${title.replace(/\s+/g,'_')}_${dateStr}.jpg`;
    link.click();
  }

  async function exportRotaCode(){
    const payload = { date: dateStr, assignments };
    const code = await packRotaCode(payload);
    await navigator.clipboard.writeText(code).catch(()=>{});
    alert("已复制排布码：\n\n" + code);
  }

  // --- Render ---
  if (!loaded) return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading roster…</div>;

  // forms/grades
  const grades = Array.from(new Set(rooms.map(r=>(r.form?.match(/^(\d{1,2})/)?.[1] ?? ""))).values()).filter(Boolean).sort((a,b)=>+a-+b);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Step header */}
      <div className="max-w-6xl mx-auto p-4">
        <div className="text-2xl font-bold">{step===1 ? "准备界面" : "成品界面"}</div>
      </div>

      {/* STEP 1: 准备界面 */}
      {step===1 && (
        <div className="max-w-6xl mx-auto p-4">
          <div className="bg-neutral-900 rounded-2xl p-4">
            {/* 标题 + 日期 + 排布码 */}
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input className="flex-1 rounded px-3 py-2 bg-neutral-800 border border-neutral-700" placeholder="输入标题（默认含 SUIS GB）" value={title} onChange={e=>setTitle(e.target.value)} />
              <input type="date" className="rounded px-3 py-2 bg-neutral-800 border border-neutral-700" value={dateStr} onChange={e=>setDateStr(e.target.value)} />
              <input className="w-full md:w-[420px] rounded px-3 py-2 bg-neutral-800 border border-neutral-700" placeholder="上一轮排布码（可选）" value={rotaCodeIn} onChange={e=>setRotaCodeIn(e.target.value)} />
            </div>

            {/* 状态条 */}
            <div className="mt-3 text-sm text-neutral-400">{statusText}</div>

            {/* 人员选择 & 年级选择 */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 人员 */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">人员选择</div>
                <div className="h-64 overflow-auto divide-y divide-neutral-700">
                  {people.map(p=>(
                    <label key={p.id} className="flex items-center gap-2 py-1">
                      <input type="checkbox" checked={p.active} onChange={()=>togglePerson(p.id)} />
                      <span>{p.name}</span>
                      {p.dept && deptColors[p.dept] && <span className="ml-auto w-3 h-3 rounded" style={{background: deptColors[p.dept]}}/>}
                    </label>
                  ))}
                </div>
              </div>
              {/* 年级 */}
              <div className="bg-neutral-800 rounded-xl p-3">
                <div className="font-semibold mb-2">年级选择</div>
                <div className="flex flex-wrap gap-2">
                  {grades.map(g=>(
                    <button key={g} onClick={()=>toggleGrade(g)}
                      className={(allowedGrades.has(g) ? "bg-emerald-600" : "bg-neutral-700") + " px-3 py-1.5 rounded-full text-sm"}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              {/* 下一步 */}
              <div className="flex items-end">
                <button onClick={doGenerate} className="w-full bg-blue-600 hover:bg-blue-700 rounded-xl py-3 font-semibold">下一步</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: 成品界面 */}
      {step===2 && (
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
                    <th className="p-2 border">年级</th>
                    <th className="p-2 border">代号 + 房号</th>
                    <th className="p-2 border">部门 + 姓名</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRooms
                    .filter(r=>r.enabled)
                    .sort((a,b)=>{
                      const ga=(a.form?.match(/^(\d{1,2})/)?.[1] ?? "99");
                      const gb=(b.form?.match(/^(\d{1,2})/)?.[1] ?? "99");
                      if (ga!==gb) return (+ga)-(+gb);
                      if (a.building!==b.building) return a.building.localeCompare(b.building);
                      if (a.floor!==b.floor) return a.floor-b.floor;
                      return a.number-b.number;
                    })
                    .map(r=>{
                      const a = assignments.find(x=>x.rooms.includes(r.id));
                      const grade = r.form?.match(/^(\d{1,2})/)?.[1] ?? "";
                      const code = `${aliasCode(r)} / ${r.id}`;
                      const dept = a ? people.find(p=>p.name===a.person)?.dept : undefined;
                      const color = dept && deptColors[dept] ? deptColors[dept] : undefined;
                      return (
                        <tr key={r.id}>
                          <td className="p-2 border text-center">{grade}</td>
                          <td className="p-2 border">{code}</td>
                          <td className="p-2 border">
                            {dept && <span className="inline-block w-3 h-3 mr-2 align-middle rounded" style={{background: color}}/>}
                            <span className="align-middle">{dept ? `${dept} ` : ""}{a ? a.person : "未分配"}</span>
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
            <button onClick={()=>setStep(1)} className="px-3 py-2 rounded bg-neutral-700 hover:bg-neutral-600">返回</button>
            <button onClick={exportJPG} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700">导出 JPG</button>
            <button onClick={exportRotaCode} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-700">导出排布码</button>
          </div>
        </div>
      )}
    </div>
  );
}
