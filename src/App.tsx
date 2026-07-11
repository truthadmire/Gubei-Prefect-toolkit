"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Masthead from "./components/Masthead";
import SelectionConfirmDialog from "./components/SelectionConfirmDialog";
import SetupWorkspace from "./components/SetupWorkspace";
import ToastRegion from "./components/ToastRegion";
import { I18N } from "./i18n";
import type { Lang } from "./i18n";
import { deptOrderOf, deptStyleOf, normalizeDept } from "./lib/departments";
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
  FormGroup,
  GenerationHistoryItem,
  JpegExport,
  JpegExportCache,
  Person,
  PersonGroup,
  ResultRow,
  Room,
  RoomGroup,
  RosterJson,
} from "./types";

/** =========================
 * Utils
 * ========================= */
const uid = () => Math.random().toString(36).slice(2, 10);

/** ---- roster.json ---- */
async function loadRoster(): Promise<{ people: Person[]; rooms: Room[] }> {
  const res = await fetch("/roster.json");
  if (!res.ok) throw new Error("roster.json not found");
  const value: unknown = await res.json();
  if (!value || typeof value !== "object") throw new Error("Invalid roster.json");
  const candidate = value as Partial<RosterJson>;
  if (!Array.isArray(candidate.people) || !Array.isArray(candidate.rooms)) {
    throw new Error("Invalid roster.json");
  }
  if (!candidate.people.every((person) => (
    !!person && typeof person === "object" &&
    typeof person.name === "string" &&
    (person.dept === undefined || typeof person.dept === "string")
  ))) {
    throw new Error("Invalid roster.json people");
  }
  if (!candidate.rooms.every((room) => (
    !!room && typeof room === "object" &&
    typeof room.id === "string" &&
    (room.form === undefined || typeof room.form === "string")
  ))) {
    throw new Error("Invalid roster.json rooms");
  }
  const j = candidate as RosterJson;

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
  const [clientStateHydrated, setClientStateHydrated] = useState(false);
  const L = I18N[lang];

  function updateLanguage(nextLanguage: Lang) {
    setLang(nextLanguage);
  }

  const [rosterState, setRosterState] = useState<"loading" | "error" | "ready">("loading");
  const [rosterAttempt, setRosterAttempt] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
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
    let cancelled = false;
    setRosterState("loading");
    loadRoster()
      .then(({ people, rooms }) => {
        if (cancelled) return;
        setPeople(people);
        setRooms(rooms);
        const forms = Array.from(new Set(rooms.map((r) => r.form || ""))).filter(Boolean).sort();
        setAllowedForms(new Set(forms));
        setRosterState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setRosterState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [rosterAttempt]);

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

  if (rosterState !== "ready") {
    return (
      <div className="app-shell">
        <Masthead copy={L} lang={lang} onLanguageChange={updateLanguage} />
        <main className="roster-state">
          {rosterState === "loading" ? (
            <section className="sheet roster-loading" aria-labelledby="roster-loading-heading">
              <p className="sheet-kicker">Roster</p>
              <h2 id="roster-loading-heading">{L.loading}</h2>
            </section>
          ) : (
            <section className="sheet recovery-sheet" role="alert" aria-labelledby="roster-recovery-heading">
              <p className="sheet-kicker">Recovery</p>
              <h2 id="roster-recovery-heading">{L.rosterRecoveryTitle}</h2>
              <p>{L.rosterRecoveryBody}</p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => setRosterAttempt((attempt) => attempt + 1)}
              >
                {L.rosterRetry}
              </button>
            </section>
          )}
        </main>
        <ToastRegion message={toast?.text} />
      </div>
    );
  }

  return (
    <div className={step === 1 ? "app-shell" : "min-h-screen bg-black text-white"}>
      <ToastRegion message={toast?.text} />
      {confirmOpen && (
        <SelectionConfirmDialog
          copy={L}
          deselectedPeople={deselectedPeople}
          deselectedForms={deselectedForms}
          opener={generateButtonRef}
          onCancel={() => setConfirmOpen(false)}
          onContinue={() => doGenerate(true)}
        />
      )}

      {step === 1 && <Masthead copy={L} lang={lang} onLanguageChange={updateLanguage} />}

      {step === 1 && (
        <SetupWorkspace
          copy={L}
          title={title}
          date={dateStr}
          rotaCode={rotaCodeIn}
          history={generationHistory}
          selectedHistoryId={selectedHistoryId}
          personGroups={personGroups}
          formGroups={formGroups}
          allowedForms={allowedForms}
          summary={generationSummary}
          canGenerate={canContinue}
          generateButtonRef={generateButtonRef}
          onTitleChange={setTitle}
          onDateChange={setDateStr}
          onRotaCodeChange={setRotaCodeIn}
          onHistorySelectionChange={setSelectedHistoryId}
          onHistoryLoad={loadSelectedHistory}
          onHistoryClear={clearGenerationHistory}
          onPersonToggle={togglePerson}
          onDoubleToggle={toggleDouble}
          onFormToggle={toggleForm}
          onGradeToggle={toggleGradeForms}
          onGenerate={() => doGenerate()}
        />
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
