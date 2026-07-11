"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  applyImportedAssignments,
  generateAssignment,
  getGenerationSummary,
  makeRNG,
  packRotaCodeV2,
  parseRoomId,
  randomSeed,
  swapAssignments,
  unpackRotaCodeCompat,
  validateGeneration,
} from "./lib/rota";
import type { GenerationFailure, GenerationSummary, SwapResult } from "./lib/rota";
import {
  GENERATION_HISTORY_KEY,
  formatHistoryLabel,
  mergeGenerationHistory,
  readGenerationHistoryFrom,
  writeGenerationHistory,
} from "./lib/history";
import {
  buildBoardExportKey,
  buildExcelBlob,
  dataUrlToBlob,
  downloadBlob,
  loadImageExporter,
  safeFilePart,
} from "./lib/export";
import type {
  Assignment,
  DeptStyle,
  FormGroup,
  GenerationHistoryItem,
  JpegExport,
  JpegExportCache,
  Lang,
  Person,
  PersonGroup,
  ResultRow,
  Room,
  RoomGroup,
  RosterJson,
} from "./types";

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
    emptyPeople: "请至少选择一位 Prefect。",
    emptyRooms: "请至少选择一个班级。",
    generationInfeasible: "当前选择无法满足房间覆盖规则，请调整人员或班级。",
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
    jpgFail: "图片生成失败，请重试。",
    excelOk: "Excel 表格已下载",
    excelFail: "Excel 表格生成失败，请重试。",
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
    dragDoubleBlockedGeneric: "此交换会将未开启双班的人员移到双班位置。",
    dragHepburnBlocked: "Hepburn He 不能被安排到 12 年级班级。",
    dragMissing: "无法找到要交换的排布位置。",
    dragSameSlot: "请选择另一行进行交换。",
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
    emptyPeople: "Select at least one Prefect.",
    emptyRooms: "Select at least one form.",
    generationInfeasible: "These selections cannot satisfy the room-coverage rules. Adjust the people or forms.",
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
    jpgFail: "Could not generate the image. Please try again.",
    excelOk: "Excel table downloaded",
    excelFail: "Could not generate the Excel table. Please try again.",
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
    dragDoubleBlockedGeneric: "This swap would move someone without double-duty permission into a paired slot.",
    dragHepburnBlocked: "Hepburn He cannot be assigned to Grade 12 forms.",
    dragMissing: "Could not find the rota positions to swap.",
    dragSameSlot: "Choose a different row to swap.",
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

/** =========================
 * Dept color (from Key)
 * ========================= */
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
 * Component
 * ========================= */
export default function App() {
  const [lang, setLang] = useState<Lang>("zh");
  const currentLanguage = useRef<Lang>("zh");
  const [clientStateHydrated, setClientStateHydrated] = useState(false);
  const L = I18N[lang];

  function updateLanguage(nextLanguage: Lang) {
    currentLanguage.current = nextLanguage;
    setLang(nextLanguage);
  }

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
  const shouldPersistGenerationHistory = useRef(false);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  const [generatedCode, setGeneratedCode] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const showToast = (text: string, ms = 2000) => {
    const id = Date.now();
    setToast({ id, text });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), ms);
  };

  useEffect(() => {
    try {
      const storage = window.localStorage;
      const storedLanguage = storage.getItem("lang");
      if (storedLanguage === "zh" || storedLanguage === "en") {
        updateLanguage(storedLanguage);
      }
      setGenerationHistory(readGenerationHistoryFrom(() => storage));
    } catch (error) {
      console.warn("Could not hydrate local preferences", error);
    } finally {
      setClientStateHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!clientStateHydrated) return;
    try {
      window.localStorage.setItem("lang", lang);
    } catch (error) {
      console.warn("Could not save language preference", error);
    }
  }, [clientStateHydrated, lang]);

  useEffect(() => {
    if (!shouldPersistGenerationHistory.current) return;
    shouldPersistGenerationHistory.current = false;
    try {
      writeGenerationHistory(window.localStorage, generationHistory);
    } catch (error) {
      console.warn("Could not save generation history", error);
    }
  }, [generationHistory]);

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
        alert(I18N[currentLanguage.current].rosterLoadFail);
      });
  }, []);

  useEffect(() => {
    if (!rotaCodeIn.trim() || !people.length) return;
    (async () => {
      try {
        const payload = await unpackRotaCodeCompat(rotaCodeIn.trim());
        setPeople((current) => applyImportedAssignments(current, payload.assignments));
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

    shouldPersistGenerationHistory.current = true;
    setGenerationHistory((prev) => mergeGenerationHistory(prev, item));
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
    shouldPersistGenerationHistory.current = false;
    setGenerationHistory([]);
    setSelectedHistoryId("");
    try {
      window.localStorage.removeItem(GENERATION_HISTORY_KEY);
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

  const generationSummary = useMemo(
    () => getGenerationSummary(people, filteredRooms),
    [people, filteredRooms],
  );

  const statusText = useMemo(() => {
    return L.status(
      generationSummary.activePeople,
      generationSummary.enabledRooms,
      generationSummary.requiredDouble,
      generationSummary.availableDouble,
    );
  }, [generationSummary, L]);

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

  function generationFailureMessage(reason: GenerationFailure, summary: GenerationSummary): string {
    switch (reason) {
      case "title": return L.titleRequired;
      case "date": return L.dateRequired;
      case "empty-people": return L.emptyPeople;
      case "empty-rooms": return L.emptyRooms;
      case "capacity": return L.ddTooFew(summary.requiredDouble, summary.availableDouble);
      case "infeasible": return L.generationInfeasible;
    }
  }

  function swapFailureMessage(reason: Extract<SwapResult, { ok: false }>["reason"]): string {
    switch (reason) {
      case "missing": return L.dragMissing;
      case "same-slot": return L.dragSameSlot;
      case "double-duty": return L.dragDoubleBlockedGeneric;
      case "grade-12": return L.dragHepburnBlocked;
    }
  }

  function doGenerate(skipSelectionConfirm = false) {
    const validation = validateGeneration(title, dateStr, people, filteredRooms);
    if (!validation.ok) {
      showToast(generationFailureMessage(validation.reason, validation.summary));
      return;
    }
    const cleanTitle = validation.title;
    const cleanDate = validation.date;
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

    const A = generateAssignment(people, filteredRooms, randJitter, !hasHistory);
    setAssignments(A);
    setStep(2);

    const payload = { date: cleanDate, assignments: A };
    packRotaCodeV2(payload).then((code) => {
      setGeneratedCode(code);
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        showToast(L.codeBoxTitle);
        return;
      }
      clipboard.writeText(code).then(
        () => showToast(L.copyOk),
        () => showToast(L.codeBoxTitle),
      );
    });
  }

  async function copyCode() {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
      await clipboard.writeText(generatedCode);
      showToast(L.copyOk);
    } catch {
      showToast(L.copyFail);
    }
  }

  function swapAssignmentsByRoom(sourceRoomId: string, targetRoomId: string) {
    const result = swapAssignments(assignments, sourceRoomId, targetRoomId, people, rooms);
    setSelectedSwapRoomId(null);
    setDragRoomId(null);
    if (!result.ok) {
      showToast(swapFailureMessage(result.reason));
      return;
    }

    setAssignments(result.assignments);
    showToast(L.dragUpdated);
  }

  function handleResultCellClick(roomId: string) {
    if (!assignmentByRoom.has(roomId)) return;
    if (!selectedSwapRoomId) {
      setSelectedSwapRoomId(roomId);
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
  const boardExportKey = useMemo(
    () => buildBoardExportKey(lang, title, dateStr, resultRows),
    [dateStr, lang, resultRows, title],
  );

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
      showToast(L.jpgFail);
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
      showToast(L.jpgFail);
    }
  }

  function downloadExcel() {
    try {
      const excelExportBlob = buildExcelBlob(resultRows, {
        title,
        dateStr,
        dateLabel: L.date,
        roomHeader: I18N[lang].colFormRoom,
        nameHeader,
      });
      downloadBlob(excelExportBlob, `${exportFileBase}.xls`);
      showToast(L.excelOk);
    } catch (error) {
      console.error(error);
      showToast(L.excelFail);
    }
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

  const canContinue = title.trim().length > 0 &&
    dateStr.trim().length > 0 &&
    generationSummary.activePeople > 0 &&
    generationSummary.enabledRooms > 0 &&
    generationSummary.hasCapacity &&
    generationSummary.feasible;

  if (!loaded) {
    return (
      <main className="min-h-screen flex items-center justify-center text-neutral-400">
        <h1 className="visually-hidden">Gubei Prefect Toolkit</h1>
        <div>{L.loading}</div>
      </main>
    );
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
                onChange={(e) => updateLanguage(e.target.value as Lang)}
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
