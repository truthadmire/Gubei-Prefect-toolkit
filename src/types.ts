export type Person = {
  id: string;
  name: string;
  dept?: string;
  active: boolean;
  canDouble: boolean;
  assignedCount: number;
  lastRooms?: string[];
  lastPairKey?: string;
};

export type Room = {
  id: string;
  form?: string;
  building: string;
  number: number;
  floor: number;
  enabled: boolean;
};

export type Slot = { id: string; rooms: string[] };
export type Assignment = { person: string; rooms: string[] };
export type RoomGroup = { grade: number; rooms: Room[] };
export type FormGroup = { grade: number; forms: string[] };
export type DeptStyle = { bg: string; fg: string; border?: string };
export type PersonGroup = { dept: string; people: Person[]; style: DeptStyle };

export type ResultRow = {
  room: Room;
  formRoom: string;
  personName: string;
  style: DeptStyle;
};

export type JpegExport = {
  blob: Blob;
  dataUrl: string;
};

export type JpegExportCache = {
  key: string;
  exportData?: JpegExport;
  promise?: Promise<JpegExport>;
};

export type GenerationHistoryItem = {
  id: string;
  savedAt: string;
  title: string;
  date: string;
  code: string;
  assignments: Assignment[];
};

export type RosterJson = {
  people: { name: string; dept?: string }[];
  rooms: { id: string; form?: string }[];
};

export type Lang = "zh" | "en";
