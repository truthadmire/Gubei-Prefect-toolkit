"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Masthead from "./components/Masthead";
import ResultWorkspace from "./components/ResultWorkspace";
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
  createEditToken,
  createHistoryId,
  GENERATION_HISTORY_KEY,
  LEGACY_GENERATION_HISTORY_KEY,
  mergeGenerationHistory,
  mergeLocalAndSharedHistory,
  readGenerationHistoryFrom,
  writeGenerationHistory,
} from "./lib/history";
import { computeRosterRevision } from "./lib/roster-revision";
import {
  fetchSharedHistoryPage,
  queueSharedHistoryItem,
  readSharedHistoryOutbox,
  SHARED_HISTORY_ENABLED,
  SHARED_HISTORY_OUTBOX_KEY,
  syncQueuedSharedHistory,
} from "./lib/shared-history-client";
import {
  buildBoardExportKey,
  buildExcelBlob,
  dataUrlToBlob,
  downloadBlob,
  exportPixelRatio,
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
async function loadRoster(): Promise<{ people: Person[]; rooms: Room[]; revision: string }> {
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

  return { people, rooms, revision: await computeRosterRevision(j.people, j.rooms) };
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
  const [rosterRevision, setRosterRevision] = useState("");

  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const [dragRoomId, setDragRoomId] = useState<string | null>(null);
  const [selectedSwapRoomId, setSelectedSwapRoomId] = useState<string | null>(null);
  const [rotaCodeIn, setRotaCodeIn] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const importRequest = useRef(0);
  const [allowedForms, setAllowedForms] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const imageExportCache = useRef<JpegExportCache | null>(null);
  const pngExportCache = useRef<JpegExportCache | null>(null);
  const shouldPersistGenerationHistory = useRef(false);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
  const generationHistoryRef = useRef<GenerationHistoryItem[]>([]);
  const [sharedHistory, setSharedHistory] = useState<GenerationHistoryItem[]>([]);
  const [sharedHistoryCursor, setSharedHistoryCursor] = useState<string | null>(null);
  const [sharedHistoryLoading, setSharedHistoryLoading] = useState(false);
  const sharedHistoryStarted = useRef(false);
  const autoPublishStarted = useRef(false);
  const syncRunning = useRef(false);
  const syncTimer = useRef<number | null>(null);
  const currentGeneration = useRef<{
    id: string;
    editToken?: string;
    savedAt: string;
    title: string;
    date: string;
  } | null>(null);
  const generationRevision = useRef(0);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  const [generatedCode, setGeneratedCode] = useState("");
  const [exportBusy, setExportBusy] = useState<"jpg" | "share" | "excel" | null>(null);
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
      const localHistory = readGenerationHistoryFrom(() => storage);
      generationHistoryRef.current = localHistory;
      setGenerationHistory(localHistory);
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
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  useEffect(() => {
    generationHistoryRef.current = generationHistory;
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
      .then(({ people, rooms, revision }) => {
        if (cancelled) return;
        setPeople(people);
        setRooms(rooms);
        setRosterRevision(revision);
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

  function changeRotaCode(value: string) {
    importRequest.current += 1;
    setImportBusy(false);
    setRotaCodeIn(value);
  }

  async function applyPreviousCode() {
    const code = rotaCodeIn.trim();
    if (!code || !people.length) return;
    const request = ++importRequest.current;
    setImportBusy(true);
    try {
      const payload = await unpackRotaCodeCompat(code);
      if (request !== importRequest.current) return;
      setPeople((current) => applyImportedAssignments(current, payload.assignments));
      showToast(L.importOk);
    } catch (error) {
      if (request !== importRequest.current) return;
      console.warn(error);
      showToast(L.importFail);
    } finally {
      if (request === importRequest.current) setImportBusy(false);
    }
  }

  function clearImportedAssignments() {
    importRequest.current += 1;
    setImportBusy(false);
    setPeople((current) => current.map((person) => {
      const { lastRooms: _lastRooms, lastPairKey: _lastPairKey, ...rest } = person;
      return rest;
    }));
    showToast(L.importCleared);
  }

  const combinedHistory = useMemo(
    () => mergeLocalAndSharedHistory(generationHistory, sharedHistory),
    [generationHistory, sharedHistory],
  );

  useEffect(() => {
    setSelectedHistoryId((current) => {
      if (combinedHistory.some((item) => item.id === current)) return current;
      return combinedHistory[0]?.id || "";
    });
  }, [combinedHistory]);

  function replaceLocalHistory(items: GenerationHistoryItem[]) {
    generationHistoryRef.current = items;
    shouldPersistGenerationHistory.current = true;
    setGenerationHistory(items);
  }

  function scheduleSharedHistorySync(delayMs = 0) {
    if (!SHARED_HISTORY_ENABLED) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null;
      void flushSharedHistoryOutbox();
    }, delayMs);
  }

  async function flushSharedHistoryOutbox() {
    if (!SHARED_HISTORY_ENABLED || syncRunning.current) return;
    syncRunning.current = true;
    try {
      const results = await syncQueuedSharedHistory(window.localStorage);
      if (results.length) {
        let nextLocal = generationHistoryRef.current.map((item) => ({ ...item }));
        for (const result of results) {
          const index = nextLocal.findIndex((item) => item.id === result.id);
          if (index >= 0) {
            nextLocal[index] = result.status === "shared" && result.item
              ? {
                  ...nextLocal[index],
                  savedAt: result.item.savedAt,
                  updatedAt: result.item.updatedAt,
                  expiresAt: result.item.expiresAt,
                  syncStatus: "shared",
                  source: "device",
                }
              : { ...nextLocal[index], syncStatus: "failed" };
          }
          if (result.status === "shared" && result.item) {
            setSharedHistory((current) => mergeGenerationHistory(current, result.item!));
          }
        }
        replaceLocalHistory(nextLocal);
      }
    } catch {
      // The local copy and outbox remain available for the next retry.
    } finally {
      syncRunning.current = false;
      const queued = readSharedHistoryOutbox(window.localStorage);
      if (queued.length) {
        const nextAttempt = Math.min(...queued.map((item) => new Date(item.nextAttemptAt).getTime()));
        const delay = Number.isFinite(nextAttempt) ? Math.max(250, nextAttempt - Date.now()) : 5_000;
        scheduleSharedHistorySync(Math.min(delay, 5 * 60_000));
      }
    }
  }

  function storeGenerationHistoryItem(item: GenerationHistoryItem, syncDelayMs: number) {
    let stored: GenerationHistoryItem = { ...item, source: "device" };
    if (SHARED_HISTORY_ENABLED) {
      try {
        stored = queueSharedHistoryItem(window.localStorage, stored);
      } catch {
        stored = { ...stored, syncStatus: "local" };
      }
    }
    replaceLocalHistory(mergeGenerationHistory(generationHistoryRef.current, stored));
    if (stored.syncStatus === "queued") scheduleSharedHistorySync(syncDelayMs);
  }

  async function finalizeCurrentGeneration(
    nextAssignments: Assignment[],
    copyAfterGeneration: boolean,
    syncDelayMs: number,
  ) {
    const session = currentGeneration.current;
    if (!session) return;
    const revision = ++generationRevision.current;
    const code = await packRotaCodeV2({ date: session.date, assignments: nextAssignments });
    if (currentGeneration.current !== session || revision !== generationRevision.current) return;

    setGeneratedCode(code);
    const existing = generationHistoryRef.current.find((item) => item.id === session.id);
    const now = new Date().toISOString();
    storeGenerationHistoryItem({
      ...existing,
      id: session.id,
      savedAt: session.savedAt,
      updatedAt: now,
      title: session.title,
      date: session.date,
      code,
      assignments: nextAssignments.map((assignment) => ({
        person: assignment.person,
        rooms: assignment.rooms.slice(),
      })),
      rosterRevision,
      editToken: session.editToken,
      source: "device",
      syncStatus: existing?.syncStatus || "local",
    }, syncDelayMs);

    if (copyAfterGeneration) {
      const clipboard = navigator.clipboard;
      if (!clipboard?.writeText) {
        showToast(L.clipboardUnavailable);
      } else {
        clipboard.writeText(code).then(
          () => showToast(L.copyOk),
          () => showToast(L.copyFail),
        );
      }
    }
  }

  async function loadNextSharedHistoryPage(reset = false) {
    if (!SHARED_HISTORY_ENABLED || sharedHistoryLoading) return;
    setSharedHistoryLoading(true);
    try {
      const page = await fetchSharedHistoryPage(reset ? null : sharedHistoryCursor);
      setSharedHistory((current) => reset
        ? page.items
        : mergeLocalAndSharedHistory(current, page.items));
      setSharedHistoryCursor(page.nextCursor);
    } catch {
      // Shared history is additive; setup remains fully usable from local state.
    } finally {
      setSharedHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (!SHARED_HISTORY_ENABLED || !clientStateHydrated) return;
    const onOnline = () => scheduleSharedHistorySync(0);
    window.addEventListener("online", onOnline);
    scheduleSharedHistorySync(0);
    return () => {
      window.removeEventListener("online", onOnline);
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, [clientStateHydrated]);

  useEffect(() => {
    if (!SHARED_HISTORY_ENABLED || !clientStateHydrated || !rosterRevision || autoPublishStarted.current) return;
    autoPublishStarted.current = true;
    const queued = generationHistoryRef.current.map((item) => item.syncStatus === "shared"
      ? item
      : queueSharedHistoryItem(
          window.localStorage,
          {
            ...item,
            editToken: item.editToken || createEditToken(),
            rosterRevision,
            source: "device",
          },
        ));
    if (queued.length) replaceLocalHistory(queued);
    scheduleSharedHistorySync(0);
  }, [clientStateHydrated, rosterRevision]);

  useEffect(() => {
    if (!SHARED_HISTORY_ENABLED || rosterState !== "ready" || sharedHistoryStarted.current) return;
    sharedHistoryStarted.current = true;
    void loadNextSharedHistoryPage(true);
  }, [rosterState]);

  function loadSelectedHistory() {
    const selected = combinedHistory.find((item) => item.id === selectedHistoryId);
    if (!selected) return;
    setTitle(selected.title);
    setDateStr(selected.date);
    changeRotaCode(selected.code);
    showToast(L.historyLoaded);
  }

  function clearGenerationHistory() {
    shouldPersistGenerationHistory.current = false;
    generationHistoryRef.current = [];
    setGenerationHistory([]);
    setSelectedHistoryId(sharedHistory[0]?.id || "");
    currentGeneration.current = null;
    generationRevision.current += 1;
    try {
      window.localStorage.removeItem(GENERATION_HISTORY_KEY);
      window.localStorage.removeItem(LEGACY_GENERATION_HISTORY_KEY);
      window.localStorage.removeItem(SHARED_HISTORY_OUTBOX_KEY);
    } catch (error) {
      console.warn("Could not clear generation history", error);
    }
    showToast(L.historyCleared);
  }

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
    clearTransientSwapState();

    const hasHistory = people.some((p) => (p.lastRooms?.length || 0) > 0 || p.lastPairKey);
    const seed = randomSeed();
    const rng = makeRNG(seed);
    const randJitter = hasHistory ? null : rng;

    const A = generateAssignment(people, filteredRooms, randJitter, !hasHistory);
    const savedAt = new Date().toISOString();
    currentGeneration.current = {
      id: createHistoryId(),
      editToken: createEditToken(),
      savedAt,
      title: cleanTitle,
      date: cleanDate,
    };
    generationRevision.current += 1;
    setAssignments(A);
    setStep(2);
    void finalizeCurrentGeneration(A, true, 0);
  }

  async function copyCode() {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) {
      showToast(L.clipboardUnavailable);
      return;
    }
    try {
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
    void finalizeCurrentGeneration(result.assignments, false, 500);
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

  function clearTransientSwapState() {
    setSelectedSwapRoomId(null);
    setDragRoomId(null);
  }

  function returnToSetup() {
    clearTransientSwapState();
    setStep(1);
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
          departmentName: personName ? (normalizeDept(rawDept) || L.noDept) : "",
          style: deptStyleOf(rawDept),
        };
      }),
    }));
  }, [assignmentByRoom, personByName, resultRoomGroups, L.noDept]);
  const resultRows = useMemo(() => resultRowsByGrade.flatMap((group) => group.rows), [resultRowsByGrade]);
  const exportFileBase = useMemo(() => `${safeFilePart(title)}_${safeFilePart(dateStr)}`, [title, dateStr]);
  const nameHeader = useMemo(() => I18N[lang].colNameDept.split(" + ")[0] || "Name", [lang]);
  const boardExportKey = useMemo(
    () => buildBoardExportKey(lang, title, dateStr, resultRows),
    [dateStr, lang, resultRows, title],
  );

  async function getBoardImageExport(format: "jpeg" | "png") {
    const node = boardRef.current;
    if (!node) return null;

    const cacheRef = format === "jpeg" ? imageExportCache : pngExportCache;
    const cacheKey = `${boardExportKey}:${format}`;
    const cached = cacheRef.current;
    if (cached?.key === cacheKey && cached.exportData) return cached.exportData;
    if (cached?.key === cacheKey && cached.promise) return cached.promise;

    const promise = (async (): Promise<JpegExport> => {
      node.setAttribute("data-exporting", "true");
      try {
        const exporter = await loadImageExporter();
        const width = node.scrollWidth || node.offsetWidth;
        const height = node.scrollHeight || node.offsetHeight;
        const pixelRatio = exportPixelRatio(width, height);
        const dataUrl = format === "jpeg"
          ? await exporter.toJpeg(node, { quality: 0.92, pixelRatio, backgroundColor: "#ffffff" })
          : await exporter.toPng(node, { pixelRatio, backgroundColor: "#ffffff" });
        return { dataUrl, blob: dataUrlToBlob(dataUrl) };
      } finally {
        node.removeAttribute("data-exporting");
      }
    })();

    cacheRef.current = { key: cacheKey, promise };
    try {
      const exportData = await promise;
      cacheRef.current = { key: cacheKey, exportData };
      return exportData;
    } catch (error) {
      if (cacheRef.current?.promise === promise) cacheRef.current = null;
      throw error;
    }
  }

  async function downloadImage() {
    if (exportBusy) return;
    setExportBusy("jpg");
    try {
      const image = await getBoardImageExport("jpeg");
      if (!image) return;
      downloadBlob(image.blob, `${exportFileBase}.jpg`);
    } catch (e) {
      console.error(e);
      showToast(L.jpgFail);
    } finally {
      setExportBusy(null);
    }
  }

  // 1. Try Native Share (Mobile)
  // 2. Fallback to Copy Image
  // 3. Show a normal failure toast
  async function shareImage() {
    if (exportBusy) return;
    setExportBusy("share");
    let image: JpegExport | null;
    try {
      image = await getBoardImageExport("jpeg");
    } catch (e) {
      console.warn(e);
      showToast(L.jpgFail);
      setExportBusy(null);
      return;
    }
    if (!image) {
      setExportBusy(null);
      return;
    }

    const file = new File([image.blob], `${exportFileBase}.jpg`, { type: "image/jpeg" });
    const copyImageFallback = async (): Promise<boolean> => {
      if (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem === "undefined") {
        return false;
      }
      const clipboardItemWithSupport = ClipboardItem as typeof ClipboardItem & {
        supports?: (type: string) => boolean;
      };
      if (clipboardItemWithSupport.supports && !clipboardItemWithSupport.supports("image/png")) return false;
      try {
        const png = await getBoardImageExport("png");
        if (!png) return false;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png.blob })]);
        showToast(L.shareFail);
        return true;
      } catch (error) {
        console.warn(error);
        return false;
      }
    };

    if (navigator.canShare?.({ files: [file] }) && typeof navigator.share === "function") {
      try {
        await navigator.share({ files: [file], title, text: dateStr });
        setExportBusy(null);
        return;
      } catch (error) {
        if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
          setExportBusy(null);
          return;
        }
        console.warn(error);
      }
    }

    if (!await copyImageFallback()) showToast(L.shareUnavailable);
    setExportBusy(null);
  }

  async function downloadExcel() {
    if (exportBusy) return;
    setExportBusy("excel");
    try {
      const excelExportBlob = await buildExcelBlob(resultRows, {
        title,
        dateStr,
        dateLabel: L.date,
        roomHeader: I18N[lang].colFormRoom,
        nameHeader,
      });
      downloadBlob(excelExportBlob, `${exportFileBase}.xlsx`);
      showToast(L.excelOk);
    } catch (error) {
      console.error(error);
      showToast(L.excelFail);
    } finally {
      setExportBusy(null);
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
    <div className={step === 1 ? "app-shell" : "result-shell"}>
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
          history={combinedHistory}
          historyHasMore={sharedHistoryCursor !== null}
          historyLoading={sharedHistoryLoading}
          sharedHistoryEnabled={SHARED_HISTORY_ENABLED}
          selectedHistoryId={selectedHistoryId}
          personGroups={personGroups}
          formGroups={formGroups}
          allowedForms={allowedForms}
          summary={generationSummary}
          canGenerate={canContinue}
          generateButtonRef={generateButtonRef}
          onTitleChange={setTitle}
          onDateChange={setDateStr}
          importBusy={importBusy}
          onRotaCodeChange={changeRotaCode}
          onRotaCodeApply={applyPreviousCode}
          onImportedHistoryClear={clearImportedAssignments}
          onHistorySelectionChange={setSelectedHistoryId}
          onHistoryLoad={loadSelectedHistory}
          onHistoryClear={clearGenerationHistory}
          onHistoryLoadMore={() => void loadNextSharedHistoryPage(false)}
          onPersonToggle={togglePerson}
          onDoubleToggle={toggleDouble}
          onFormToggle={toggleForm}
          onGradeToggle={toggleGradeForms}
          onGenerate={() => doGenerate()}
        />
      )}

      {step === 2 && (
        <ResultWorkspace
          title={title}
          date={dateStr}
          dateLabel={L.date}
          dragHint={L.dragHint}
          rowsByGrade={resultRowsByGrade}
          selectedSwapRoomId={selectedSwapRoomId}
          generatedCode={generatedCode}
          exportBusy={exportBusy}
          boardRef={boardRef}
          labels={{
            back: L.back,
            downloadJpg: L.download,
            share: L.exportShare,
            downloadExcel: L.downloadExcel,
            copyCode: L.copy,
            gradeTitle: L.gradeTitle,
            codeTitle: L.codeBoxTitle,
            assignmentSheet: L.assignmentSheet,
            actionsLabel: L.actionsLabel,
            unassigned: L.unassigned,
          }}
          onActivateRoom={handleResultCellClick}
          onBack={returnToSetup}
          onDownloadJpg={downloadImage}
          onShare={shareImage}
          onDownloadExcel={downloadExcel}
          onCopyCode={copyCode}
          onDragStart={setDragRoomId}
          onDrop={(targetRoomId) => {
            if (dragRoomId) swapAssignmentsByRoom(dragRoomId, targetRoomId);
          }}
          onDragEnd={() => setDragRoomId(null)}
        />
      )}
    </div>
  );
}
