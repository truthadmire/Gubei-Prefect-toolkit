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

// ---------- Utils ----------
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

// ---- RotaCode(上一轮) 压缩/校验 ----
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

// ---------- Load roster ----------
async function loadRoster(): Promise<{people: Person[]; rooms: Room[]; deptColors: Record<string,string>}> {
  const res = await fetch("/roster.json");
  if (!res.ok) throw new Error("roster.json not found");
  const j: RosterJson = await res.json();

  const people: Person[] = j.people.map(p => ({
    id: uid(),
    name: p.name,
    dept: p.dept,          // 接受任何部门名
    active: true,
    assignedCount: 0
  })).sort((a,b)=>a.name.localeCompare(b.name));

  const rooms: Room[] = j.rooms.map(rr => {
    const parsed = parseRoomId(rr.id);
    if (!parsed) throw new Error(`Bad room id: ${rr.id}`);
    return { id: rr.id, form: rr.form, building: parsed.building, number: parsed.number, floor: parsed.floor, enabled: true };
  }).sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building));

  return { people, rooms, deptColors: j.deptColors || {} };
}

// ---------- Matching ----------
function makeCost(p: Person, slot: Slot, strong=true): number {
  const last = new Set(p.lastRooms || []);
  if (strong){
    for (const r of slot.rooms) if (last.has(r)) return 1e6; // 连续同房禁止
    if (slot.rooms.length===2 && p.lastPairKey === pairKey(slot.rooms[0],slot.rooms[1])) return 1e6; // 连续同房对禁止
  }
  let c = 0;
  for (const r of slot.rooms) if (last.has(r)) c += 100;   // 软惩罚（上一轮同房）
  if (slot.rooms.length===2 && p.lastPairKey === pairKey(slot.rooms[0],slot.rooms[1])) c += 200; // 软惩罚（上一轮同房对）
  c += p.assignedCount * 5; // 公平性
  return c;
}

// 相邻优先的贪心配对
function greedyAdjacentPairs(rooms: Room[], need: number, used: Set<string>): Slot[] {
  const sorted = rooms.slice().sort((a,b)=> a.building===b.building ? (a.floor===b.floor ? a.number-b.number : a.floor-b.floor) : a.building.localeCompare(b.building));
  const pairs: Slot[] = [];
  for (let i=0;i<sorted.length-1 && pairs.length<need;i++){
    const a=sorted[i], b=sorted[i+1];
    if (used.has(a.id)||used.has(b.id)) continue;
    if (a.building===b.building && a.floor===b.floor && Math.abs(a.number-b.number)===1){
      pairs.push({ id: pairKey(a.id,b.id), rooms: [a.id,b.id] }); used.add(a.id); used.add(b.id);
    }
  }
  return pairs;
}

// 不足相邻对时，用“最近邻距离”补足配对（同楼同层优先）
function distance(a: Room, b: Room): number {
  if (a.building !== b.building) return 1e9 + Math.abs(a.number-b.number);
  const floorPenalty = Math.abs(a.floor - b.floor) * 1000; // 楼层差距重罚
  return floorPenalty + Math.abs(a.number - b.number);
}
function fillPairsByNearest(rooms: Room[], need: number, used: Set<string>): Slot[] {
  const candidates: {a: Room; b: Room; d: number}[] = [];
  const free = ro
