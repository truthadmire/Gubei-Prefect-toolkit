# Editorial Campus Redesign and Sites Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox - [ ] syntax for tracking.

**Goal:** Rebuild Gubei Prefect Toolkit as the approved Editorial Campus Desk interface, preserve every shipped rota capability, and publish the direct-to-tool site publicly through Sites.

**Architecture:** Keep src/App.tsx as the client workflow orchestrator, extract pure rota/history/export logic into tested modules, and render setup/result states through focused components backed by one central stylesheet. Migrate the static Vite entrypoint to the bundled Vinext/Cloudflare Worker shell required by Sites while keeping roster and user data device-local.

**Tech Stack:** TypeScript, React 19, Vinext, Next App Router compatibility, Vite, Cloudflare Workers, Vitest, Testing Library, munkres-js, html-to-image, and Sites hosting.

---

## File structure

### Application shell

- Create app/layout.tsx for the document shell and host-derived metadata.
- Create app/page.tsx to render the rota application directly.
- Create app/globals.css for the Editorial Campus Desk system.
- Create worker/index.ts and build/sites-vite-plugin.ts for Sites output.
- Create .openai/hosting.json and add project_id only after create_site returns it.
- Modify vite.config.ts, next.config.ts, tsconfig.json, and package.json for Vinext.
- Delete index.html and src/main.tsx after the Vinext route renders.

### Domain and browser boundaries

- Create src/types.ts for shared types.
- Create src/i18n.ts for typed bilingual copy.
- Create src/lib/departments.ts for department semantics.
- Create src/lib/rota.ts for code compatibility, assignment, validation, and swaps.
- Create src/lib/history.ts for validated local history.
- Create src/lib/export.ts for SpreadsheetML, filenames, export keys, and JPG helpers.
- Keep src/App.tsx as the state/effect orchestrator.

### Presentation

- Create src/components/Masthead.tsx.
- Create src/components/SetupWorkspace.tsx.
- Create src/components/ResultWorkspace.tsx.
- Create src/components/SelectionConfirmDialog.tsx.
- Create src/components/ToastRegion.tsx.

### Tests and assets

- Create vitest.config.ts and src/test/setup.ts.
- Create src/lib/rota.test.ts, src/lib/history.test.ts, and src/lib/export.test.ts.
- Create src/App.test.tsx and src/components/ResultWorkspace.test.tsx.
- Create tests/rendered-html.test.mjs.
- Create public/og.png after site copy and styling are stable.

## Task 1: Establish tests and shared types

**Files:**
- Modify: package.json
- Create: vitest.config.ts
- Create: src/test/setup.ts
- Create: src/types.ts
- Create: src/lib/rota.ts
- Create: src/lib/rota.test.ts

- [ ] **Step 1: Install dependencies and test tools**

Run:

~~~bash
npm install
npm install --save-dev vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
~~~

Expected: package-lock.json and node_modules are created; both commands exit 0.

- [ ] **Step 2: Add deterministic test configuration**

Add package scripts:

~~~json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
~~~

Create vitest.config.ts:

~~~ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
});
~~~

Create src/test/setup.ts:

~~~ts
import "@testing-library/jest-dom/vitest";
~~~

- [ ] **Step 3: Write the first failing parser test**

Create src/lib/rota.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { parseRoomId } from "./rota";

describe("parseRoomId", () => {
  it("normalizes a valid room and rejects malformed input", () => {
    expect(parseRoomId(" n203 ")).toEqual({
      building: "N",
      number: 203,
      floor: 2,
    });
    expect(parseRoomId("North 203")).toBeNull();
  });
});
~~~

- [ ] **Step 4: Verify the red state**

Run: npm test -- src/lib/rota.test.ts

Expected: FAIL because src/lib/rota.ts does not exist.

- [ ] **Step 5: Create types and the minimal parser**

Move the existing Person, Room, Slot, Assignment, RoomGroup, FormGroup, DeptStyle, PersonGroup, ResultRow, JpegExport, JpegExportCache, GenerationHistoryItem, RosterJson, and Lang declarations into src/types.ts and export them without changing fields.

Create src/lib/rota.ts:

~~~ts
export function parseRoomId(
  raw: string,
): { building: string; number: number; floor: number } | null {
  const match = raw.trim().match(/^([A-Za-z]+)(\d{3})$/);
  if (!match) return null;
  return {
    building: match[1].toUpperCase(),
    number: Number.parseInt(match[2], 10),
    floor: Number.parseInt(match[2][0], 10),
  };
}
~~~

- [ ] **Step 6: Verify green and baseline build**

Run:

~~~bash
npm test -- src/lib/rota.test.ts
npm run build
~~~

Expected: parser test PASS and Vite build exit 0.

- [ ] **Step 7: Commit**

~~~bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/types.ts src/lib/rota.ts src/lib/rota.test.ts
git commit -m "test: establish rota test harness"
~~~

## Task 2: Protect the rota engine and code format

**Files:**
- Modify: src/lib/rota.test.ts
- Modify: src/lib/rota.ts
- Modify: src/App.tsx
- Modify: src/types.ts

- [ ] **Step 1: Add failing assignment tests**

Add deterministic fixtures:

~~~ts
import type { Assignment, Person, Room } from "../types";
import {
  applyImportedAssignments,
  generateAssignment,
  packRotaCodeV2,
  unpackRotaCodeCompat,
  unpackRotaCodeV2,
} from "./rota";

const person = (name: string, canDouble = true): Person => ({
  id: name,
  name,
  active: true,
  canDouble,
  assignedCount: 0,
});

const room = (id: string, form: string): Room => {
  const parsed = parseRoomId(id);
  if (!parsed) throw new Error("Invalid test room: " + id);
  return { id, form, enabled: true, ...parsed };
};
~~~

Add tests that assert:

1. Every enabled room occurs exactly once and inputs are not mutated.
2. Inactive people and disabled rooms never appear.
3. The paired slot goes only to canDouble true.
4. Hepburn He never receives a Form beginning with 12.
5. Empty active people or enabled rooms returns [].
6. v2 round-trips Unicode names and paired rooms.
7. A changed payload/CRC character throws CRC mismatch.
8. Unknown prefixes and malformed segment counts reject.
9. Imported assignments update cloned people and ignore unknown names.
10. Malformed nested assignments reject with Invalid rota payload.

Store these independently generated literal fixtures in the test file; do not generate them with the decoder under test:

~~~ts
const V1_UNCOMPRESSED = "ROTAv1.eyJkYXRlIjoiMjAyNi0wNy0xMSIsImFzc2lnbm1lbnRzIjpbeyJwZXJzb24iOiJIaXN0b3JpYyIsInJvb21zIjpbIk4yMDEiLCJOMjAyIl19XX0.868849C0";
const V1_DEFLATE_RAW = "ROTAv1.FcsxCsAgDAXQu_xZIWZowRN08gLFQVopDppi3MS7l86PN3GnkeHBxJul3ToHg6RanlZzGwp_Try5qzR4HEWH9HLBoIvUXxGY_hOYGHHF9QE.8EB5DC60";
~~~

- [ ] **Step 2: Verify the red state**

Run: npm test -- src/lib/rota.test.ts

Expected: FAIL because assignment, codec, validation, and import exports are missing.

- [ ] **Step 3: Move the existing engine without algorithm changes**

Move pairKey, makeRNG, randomSeed, shuffle, toBase64URL, fromBase64URL, crc32, makeCost, greedyAdjacentPairs, distance, fillPairsByNearest, isHepburnGrade12Blocked, hungarianAssign, and generateAssignment into src/lib/rota.ts.

Export only parseRoomId, pairKey, makeRNG, randomSeed, packRotaCodeV2, unpackRotaCodeV2, unpackRotaCodeCompat, applyImportedAssignments, isHepburnGrade12Blocked, and generateAssignment.

Add structural validation:

~~~ts
function isAssignment(value: unknown): value is Assignment {
  if (!value || typeof value !== "object") return false;
  const item = value as Assignment;
  return typeof item.person === "string" &&
    Array.isArray(item.rooms) &&
    item.rooms.every((roomId) => typeof roomId === "string");
}

function assertRotaPayload(value: unknown): asserts value is {
  date?: string;
  assignments: Assignment[];
} {
  if (!value || typeof value !== "object") throw new Error("Invalid rota payload");
  const payload = value as { date?: unknown; assignments?: unknown };
  if (
    (payload.date !== undefined && typeof payload.date !== "string") ||
    !Array.isArray(payload.assignments) ||
    !payload.assignments.every(isAssignment)
  ) {
    throw new Error("Invalid rota payload");
  }
}
~~~

Add immutable import application:

~~~ts
export function applyImportedAssignments(
  people: Person[],
  assignments: Assignment[],
): Person[] {
  const imported = new Map(assignments.map((item) => [item.person, item]));
  return people.map((current) => {
    const assignment = imported.get(current.name);
    if (!assignment) return current;
    const rooms = assignment.rooms.slice();
    return {
      ...current,
      lastRooms: rooms,
      lastPairKey: rooms.length === 2 ? pairKey(rooms[0], rooms[1]) : undefined,
    };
  });
}
~~~

- [ ] **Step 4: Integrate imports in App**

Remove the extracted declarations from src/App.tsx. Replace the mutating import loop with:

~~~ts
const payload = await unpackRotaCodeCompat(rotaCodeIn.trim());
setPeople((current) => applyImportedAssignments(current, payload.assignments));
~~~

Keep loadRoster in App because it is a fetch boundary.

- [ ] **Step 5: Verify and commit**

Run:

~~~bash
npm test -- src/lib/rota.test.ts
npm run build
~~~

Expected: all rota tests PASS and build exit 0.

~~~bash
git add src/App.tsx src/types.ts src/lib/rota.ts src/lib/rota.test.ts
git commit -m "refactor: isolate tested rota engine"
~~~

## Task 3: Validate local history

**Files:**
- Create: src/lib/history.ts
- Create: src/lib/history.test.ts
- Modify: src/App.tsx

- [ ] **Step 1: Write failing history tests**

Create fixtures and tests for malformed nested assignments, corrupt JSON, mixed valid/invalid entries, a 20-item limit, code deduplication, newest-first order, and deep-cloned assignments.

Use this storage boundary:

~~~ts
export type HistoryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
~~~

A core test:

~~~ts
it("deduplicates, clones, and caps history", () => {
  const existing = Array.from(
    { length: GENERATION_HISTORY_LIMIT },
    (_, index) => item(String(index)),
  );
  const nextItem = item("new", "5");
  const merged = mergeGenerationHistory(existing, nextItem);
  expect(merged).toHaveLength(GENERATION_HISTORY_LIMIT);
  expect(merged[0].id).toBe("new");
  expect(merged.filter((entry) => entry.code === "5")).toHaveLength(1);
  nextItem.assignments[0].rooms[0] = "C999";
  expect(merged[0].assignments[0].rooms[0]).toBe("N201");
});
~~~

- [ ] **Step 2: Verify red**

Run: npm test -- src/lib/history.test.ts

Expected: FAIL because src/lib/history.ts is missing.

- [ ] **Step 3: Implement the history module**

Export GENERATION_HISTORY_KEY, GENERATION_HISTORY_LIMIT, isGenerationHistoryItem, readGenerationHistory, writeGenerationHistory, mergeGenerationHistory, and formatHistoryLabel.

Nested assignment validation must require string person plus a string-array rooms property. Reads return [] for missing/corrupt storage. Writes store only the first 20. Merge clones every rooms array.

- [ ] **Step 4: Hydrate history only after mount**

Initialize App history to []. In a mount effect, call readGenerationHistory(window.localStorage). Replace inline merging with mergeGenerationHistory and writeGenerationHistory.

- [ ] **Step 5: Verify and commit**

~~~bash
npm test -- src/lib/history.test.ts
npm test
npm run build
git add src/App.tsx src/lib/history.ts src/lib/history.test.ts
git commit -m "refactor: validate local generation history"
~~~

Expected: all tests PASS and build exit 0.

## Task 4: Centralize exports, validation, and swaps

**Files:**
- Create: src/lib/export.ts
- Create: src/lib/export.test.ts
- Modify: src/lib/rota.ts
- Modify: src/lib/rota.test.ts
- Modify: src/App.tsx

- [ ] **Step 1: Write failing export tests**

Create src/lib/export.test.ts. Assert:

- SpreadsheetML has MIME application/vnd.ms-excel;charset=utf-8.
- Title, headers, rooms, and names are XML escaped.
- Empty people render a visible dash.
- Result-row order is preserved.
- safeFilePart removes illegal filename characters and falls back to rota.
- buildBoardExportKey changes for language, title, date, room, person, or department style changes.
- dataUrlToBlob preserves MIME and bytes.

Use this key signature:

~~~ts
export function buildBoardExportKey(
  lang: Lang,
  title: string,
  dateStr: string,
  rows: ResultRow[],
): string;
~~~
+
The test file starts with this executable case:

~~~ts
import { describe, expect, it } from "vitest";
import type { ResultRow } from "../types";
import {
  buildBoardExportKey,
  buildExcelBlob,
  safeFilePart,
} from "./export";

const rows: ResultRow[] = [{
  room: {
    id: "N201",
    form: "9&A",
    building: "N",
    number: 201,
    floor: 2,
    enabled: true,
  },
  formRoom: "N201 (9&A)",
  personName: "A < B",
  style: { bg: "#FFFFFF", fg: "#000000" },
}];

describe("exports", () => {
  it("escapes SpreadsheetML and preserves semantic data", async () => {
    const blob = buildExcelBlob(rows, {
      title: "Morning & Assembly",
      dateStr: "2026-07-11",
      dateLabel: "Date",
      roomHeader: "Class + Room",
      nameHeader: "Name",
    });
    expect(blob.type).toBe("application/vnd.ms-excel;charset=utf-8");
    const xml = await blob.text();
    expect(xml).toContain("Morning &amp; Assembly");
    expect(xml).toContain("N201 (9&amp;A)");
    expect(xml).toContain("A &lt; B");
  });

  it("changes the export key when the assigned person changes", () => {
    const first = buildBoardExportKey("en", "Morning", "2026-07-11", rows);
    const second = buildBoardExportKey("en", "Morning", "2026-07-11", [
      { ...rows[0], personName: "C" },
    ]);
    expect(second).not.toBe(first);
  });

  it("sanitizes download names", () => {
    expect(safeFilePart(" Morning / Rota: 1 ")).toBe("Morning_Rota_1");
    expect(safeFilePart("   ")).toBe("rota");
  });
});
~~~


- [ ] **Step 2: Write failing generation/swap tests**

Add tests for getGenerationSummary, validateGeneration, and swapAssignments.

Validation must return reasons title, date, empty-people, empty-rooms, capacity, or infeasible. It must trim title/date and expose requiredDouble/availableDouble.

Swap tests must prove:

- A valid swap changes person only and preserves room-slot arrays.
- Inputs are never mutated.
- Unknown/identical/same-slot room IDs are no-ops.
- A non-double person cannot enter a paired slot.
- Hepburn cannot enter a Grade 12 slot.
+
Add this concrete swap case to src/lib/rota.test.ts:

~~~ts
it("swaps people without changing room slots", () => {
  const assignments: Assignment[] = [
    { person: "A", rooms: ["N201"] },
    { person: "B", rooms: ["N202", "N203"] },
  ];
  const people = [person("A", true), person("B", true)];
  const rooms = [
    room("N201", "9A"),
    room("N202", "9B"),
    room("N203", "9C"),
  ];
  const result = swapAssignments(
    assignments,
    "N201",
    "N202",
    people,
    rooms,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.assignments).toEqual([
      { person: "B", rooms: ["N201"] },
      { person: "A", rooms: ["N202", "N203"] },
    ]);
  }
  expect(assignments[0].person).toBe("A");
});

it("blocks a non-double person from a paired slot", () => {
  const result = swapAssignments(
    [
      { person: "A", rooms: ["N201"] },
      { person: "B", rooms: ["N202", "N203"] },
    ],
    "N201",
    "N202",
    [person("A", false), person("B", true)],
    [room("N201", "9A"), room("N202", "9B"), room("N203", "9C")],
  );
  expect(result).toEqual({ ok: false, reason: "double-duty" });
});
~~~


- [ ] **Step 3: Verify red**

Run: npm test -- src/lib/export.test.ts src/lib/rota.test.ts

Expected: FAIL because the new exports and pure workflow helpers are missing.

- [ ] **Step 4: Extract helpers**

Move xmlEscape, safeFilePart, excelColor, loadImageExporter, dataUrlToBlob, downloadBlob, and buildExcelBlob into src/lib/export.ts. Add buildBoardExportKey using all current row/style fields.

In src/lib/rota.ts add:

~~~ts
export type SwapResult =
  | { ok: true; assignments: Assignment[] }
  | { ok: false; reason: "missing" | "same-slot" | "double-duty" | "grade-12" };

export type GenerationFailure =
  "title" | "date" | "empty-people" | "empty-rooms" | "capacity" | "infeasible";
~~~

Implement getGenerationSummary, validateGeneration, and swapAssignments using existing constraints and immutable copies.

- [ ] **Step 5: Integrate one source of truth**

Use getGenerationSummary for live status and Generate disabled state. Use validateGeneration in doGenerate. Use swapAssignments for drag, keyboard, and two-tap flows. Map typed reasons to bilingual messages.

Guard navigator.clipboard?.writeText so clipboard support cannot prevent results. Wrap Excel and JPG actions in try/catch with dedicated messages.

- [ ] **Step 6: Verify and commit**

~~~bash
npm test
npm run build
git add src/App.tsx src/lib/rota.ts src/lib/rota.test.ts src/lib/export.ts src/lib/export.test.ts
git commit -m "refactor: centralize rota validation and exports"
~~~

Expected: all tests PASS and build exit 0.

## Task 5: Migrate to the Sites-supported Vinext shell

**Files:**
- Modify: package.json, package-lock.json, vite.config.ts, tsconfig.json, src/App.tsx
- Create: next.config.ts, next-env.d.ts, .openai/hosting.json
- Create: build/sites-vite-plugin.ts, worker/index.ts
- Create: app/layout.tsx, app/page.tsx, app/globals.css
- Create: tests/rendered-html.test.mjs
- Delete: index.html, src/main.tsx

- [ ] **Step 1: Write the failing Worker test**

Create tests/rendered-html.test.mjs:

~~~js
import assert from "node:assert/strict";
import test from "node:test";

test("server-renders the rota workspace directly", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Gubei Prefect Toolkit/i);
  assert.doesNotMatch(html, /landing page|learn more|codex-preview/i);
});
~~~

- [ ] **Step 2: Verify static Vite cannot satisfy Sites**

~~~bash
npm run build
node --test tests/rendered-html.test.mjs
~~~

Expected: Vite builds, then the Node test FAILS because dist/server/index.js is missing.

- [ ] **Step 3: Install the bundled runtime versions**

~~~bash
npm install next@16.2.6 react@19.2.6 react-dom@19.2.6
npm install --save-dev @cloudflare/vite-plugin@1.37.1 @types/node@22.19.19 @types/react@19.2.14 @types/react-dom@19.2.3 @vitejs/plugin-react@6.0.2 @vitejs/plugin-rsc@0.5.26 react-server-dom-webpack@19.2.6 typescript@5.9.3 vinext@0.0.50 vite@8.0.13 wrangler@4.92.0
~~~

Keep html-to-image and munkres-js.

- [ ] **Step 4: Add the exact Sites build shell**

Create .openai/hosting.json:

~~~json
{}
~~~

Copy the bundled build/sites-vite-plugin.ts. Use the bundled async vite.config.ts with vinext(), sites(), and cloudflare(), without D1 or R2.

Create worker/index.ts:

~~~ts
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
~~~

Use the bundled next.config.ts and tsconfig.json, retaining strict TypeScript and the @/* path.

- [ ] **Step 5: Create the direct route and safe hydration**

Create app/page.tsx:

~~~tsx
import App from "../src/App";

export default function HomePage() {
  return <App />;
}
~~~

Create app/layout.tsx with title Gubei Prefect Toolkit, description Build balanced SUIS Gubei prefect room rotas quickly., and app/globals.css imported.

Add "use client"; to src/App.tsx. Initialize language/history to zh/[] during server rendering, then hydrate localStorage values in a mount effect before persisting future changes.

Delete index.html and src/main.tsx only after app/page.tsx renders.

- [ ] **Step 6: Verify Worker output**

~~~bash
npm test
npm run build
node --test tests/rendered-html.test.mjs
test -f dist/server/index.js
test -f dist/.openai/hosting.json
~~~

Assert the bundled public asset exists with `test -f dist/client/roster.json`.

Expected: every command exits 0.

- [ ] **Step 7: Commit**

~~~bash
git add package.json package-lock.json vite.config.ts tsconfig.json next.config.ts next-env.d.ts .openai/hosting.json build worker app tests/rendered-html.test.mjs src/App.tsx index.html src/main.tsx
git commit -m "build: migrate rota app to Sites worker shell"
~~~

## Task 6: Build the Editorial Campus setup workspace

**Files:**
- Create: src/i18n.ts, src/lib/departments.ts
- Create: src/components/Masthead.tsx
- Create: src/components/SetupWorkspace.tsx
- Create: src/components/SelectionConfirmDialog.tsx
- Create: src/components/ToastRegion.tsx
- Create: src/App.test.tsx
- Modify: src/App.tsx, app/globals.css

- [ ] **Step 1: Write failing setup tests**

Mock fetch with two people and three rooms. Test:

1. The app opens directly into a Prefect Rota heading and labeled title/date fields.
2. No Get started or landing link exists.
3. Impossible staffing disables Generate and shows required/available counts.
4. Deselecting a person then generating opens a role=dialog exclusion list.
5. Cancel restores focus to Generate.
6. Fetch failure renders the bilingual recovery surface, not alert/loading forever.
7. Invalid imported code leaves selections unchanged and announces an error.

Use Testing Library roles/names, not class assertions or snapshots.
+
Create src/App.test.tsx with this executable baseline:

~~~tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const roster = {
  people: [
    { name: "Cindy Jing", dept: "Academia" },
    { name: "Amber Wang", dept: "Charity" },
  ],
  rooms: [
    { id: "N201", form: "9A" },
    { id: "N202", form: "9B" },
    { id: "N203", form: "9C" },
  ],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("lang", "en");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(roster), { status: 200 })),
  );
});

describe("setup workspace", () => {
  it("opens directly into the labeled rota form", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /prefect rota/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/announcement title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/announcement date/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /get started/i })).not.toBeInTheDocument();
  });

  it("disables generation for impossible staffing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/announcement title/i), "Morning");
    await user.type(screen.getByLabelText(/announcement date/i), "2026-07-11");
    await user.click(screen.getByRole("checkbox", { name: /cindy jing double/i }));
    await user.click(screen.getByRole("checkbox", { name: /amber wang double/i }));
    expect(screen.getByRole("button", { name: /generate rota/i })).toBeDisabled();
    expect(screen.getByText(/need 1 double-duty.*available 0/i)).toBeInTheDocument();
  });

  it("restores Generate focus when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByLabelText(/announcement title/i), "Morning");
    await user.type(screen.getByLabelText(/announcement date/i), "2026-07-11");
    await user.click(screen.getByRole("checkbox", { name: /cindy jing selected/i }));
    const generate = screen.getByRole("button", { name: /generate rota/i });
    await user.click(generate);
    expect(screen.getByRole("dialog", { name: /continue/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /go back/i }));
    expect(generate).toHaveFocus();
  });

  it("shows roster recovery instead of alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load roster/i);
    expect(screen.queryByText(/loading roster/i)).not.toBeInTheDocument();
  });
});
~~~


- [ ] **Step 2: Verify red**

Run: npm test -- src/App.test.tsx

Expected: FAIL because labels, disabled staffing state, dialog semantics, focus restoration, and recovery UI are missing.

- [ ] **Step 3: Extract copy and department semantics**

Move I18N/Lang to src/i18n.ts. Move normalizeDept, DEPT_STYLE, DEPT_ORDER, deptStyleOf, and deptOrderOf to src/lib/departments.ts. Preserve exact color values because result JPG and SpreadsheetML use them.

- [ ] **Step 4: Create setup components**

Masthead renders SUIS Gubei, Prefect Rota, the current date, and language selector.

SetupWorkspace renders, in order:

1. Announcement brief sheet with visible labels.
2. Previous-code and local-history controls.
3. Department-grouped Prefects with selected and double-duty labels containing names.
4. Grade-grouped Forms with native whole-grade checks and pressed form buttons.
5. Live summary rail.
6. Generate action.

SelectionConfirmDialog uses role=dialog, aria-modal=true, a labeled heading, Escape handling, initial focus on Go Back, and focus restoration.

ToastRegion uses role=status, aria-live=polite, and aria-atomic=true.

- [ ] **Step 5: Implement exact visual tokens**

Add:

~~~css
:root {
  --canvas: #f3eddf;
  --paper: #fffdf7;
  --ink: #252723;
  --muted-ink: #6f7069;
  --line: #bdb5a6;
  --cobalt: #2452d4;
  --cobalt-pressed: #173a9e;
  --offset-shadow: #d8cebb;
  --display-font: "Iowan Old Style", Baskerville, Georgia, serif;
  --ui-font: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --mono-font: "SFMono-Regular", Menlo, monospace;
}
~~~

Sheets use a 1px ink border, 3px radius, paper fill, and 7px 7px offset shadow. Hover moves -1px/-1px and extends shadow to 9px. Use 18px region gaps, 22–28px padding, 44px mobile controls, and a single cobalt primary action.

At 1180px+, use main columns plus a 328px rail. At 880–1179px, use two selection columns with rail below. At 721–879px, stack selections. At 720px and below, stack everything without horizontal scrolling.

Settle sheets once with at most 120ms stagger; use 160–200ms control transitions; remove decorative motion under prefers-reduced-motion.

- [ ] **Step 6: Integrate setup and error states**

Replace setup JSX with components/semantic class names. Add loading/error/ready roster states. Fetch failure shows a recovery sheet instead of alert.

- [ ] **Step 7: Verify and commit**

~~~bash
npm test -- src/App.test.tsx
npm test
npm run build
rg -n 'alert\(' src
~~~

Expected: tests/build PASS and search finds no production alert call.

~~~bash
git add src/App.tsx src/App.test.tsx src/i18n.ts src/lib/departments.ts src/components app/globals.css
git commit -m "feat: build editorial rota setup workspace"
~~~

## Task 7: Build results and accessible feedback

**Files:**
- Create: src/components/ResultWorkspace.tsx
- Create: src/components/ResultWorkspace.test.tsx
- Modify: src/App.tsx, src/i18n.ts, app/globals.css

- [ ] **Step 1: Write failing result tests**

With a two-row fixture, test:

1. Click, Enter, and Space invoke onActivateRoom with the same room ID.
2. Selected rows expose aria-pressed.
3. Back, Download JPG, Share, Download Excel, and Copy rota code exist by role/name.
4. Whole assignment slots remain intact for paired rooms.
5. A blocked swap announces the typed rule and leaves names unchanged.
+
Create src/components/ResultWorkspace.test.tsx:

~~~tsx
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  ResultWorkspace,
  type ResultWorkspaceProps,
} from "./ResultWorkspace";

const baseProps: ResultWorkspaceProps = {
  title: "Morning Announcements",
  date: "2026-07-11",
  dateLabel: "Date",
  dragHint: "Select two rows to swap.",
  rowsByGrade: [{
    grade: 9,
    rows: [
      {
        room: { id: "N201", form: "9A", building: "N", number: 201, floor: 2, enabled: true },
        formRoom: "N201 (9A)",
        personName: "Cindy Jing",
        style: { bg: "#B59ACB", fg: "#000000" },
      },
      {
        room: { id: "N202", form: "9B", building: "N", number: 202, floor: 2, enabled: true },
        formRoom: "N202 (9B)",
        personName: "Amber Wang",
        style: { bg: "#D6A07E", fg: "#000000" },
      },
    ],
  }],
  selectedSwapRoomId: null,
  generatedCode: "ROTAv2.demo",
  boardRef: createRef<HTMLDivElement>(),
  labels: {
    back: "Back",
    downloadJpg: "Download JPG",
    share: "Share",
    downloadExcel: "Download Excel",
    copyCode: "Copy rota code",
  },
  onActivateRoom: vi.fn(),
  onBack: vi.fn(),
  onDownloadJpg: vi.fn(),
  onShare: vi.fn(),
  onDownloadExcel: vi.fn(),
  onCopyCode: vi.fn(),
  onDragStart: vi.fn(),
  onDrop: vi.fn(),
  onDragEnd: vi.fn(),
};

it("uses click, Enter, and Space through one room callback", async () => {
  const user = userEvent.setup();
  const onActivateRoom = vi.fn();
  render(<ResultWorkspace {...baseProps} onActivateRoom={onActivateRoom} />);
  const row = screen.getByRole("button", { name: /N201.*Cindy Jing/i });
  await user.click(row);
  row.focus();
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  expect(onActivateRoom).toHaveBeenNthCalledWith(1, "N201");
  expect(onActivateRoom).toHaveBeenNthCalledWith(2, "N201");
  expect(onActivateRoom).toHaveBeenNthCalledWith(3, "N201");
});

it("exposes every export action by accessible name", () => {
  render(<ResultWorkspace {...baseProps} />);
  expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download JPG" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Excel" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy rota code" })).toBeInTheDocument();
});
~~~


- [ ] **Step 2: Verify red**

Run: npm test -- src/components/ResultWorkspace.test.tsx

Expected: FAIL because ResultWorkspace is missing.

- [ ] **Step 3: Implement ResultWorkspace**

Export this prop contract from ResultWorkspace.tsx:

~~~ts
export type ResultWorkspaceProps = {
  title: string;
  date: string;
  dateLabel: string;
  dragHint: string;
  rowsByGrade: Array<{ grade: number; rows: ResultRow[] }>;
  selectedSwapRoomId: string | null;
  generatedCode: string;
  boardRef: RefObject<HTMLDivElement>;
  labels: {
    back: string;
    downloadJpg: string;
    share: string;
    downloadExcel: string;
    copyCode: string;
  };
  onActivateRoom(roomId: string): void;
  onBack(): void;
  onDownloadJpg(): void;
  onShare(): void;
  onDownloadExcel(): void;
  onCopyCode(): void;
  onDragStart(roomId: string): void;
  onDrop(roomId: string): void;
  onDragEnd(): void;
};
~~~

Render:

- A paper assignment sheet with title/date and dense room/person rows.
- Department color paired with visible name/department text.
- Pointer drag plus click/Enter/Space through one activation callback.
- Back, JPG, share, Excel, and copy-code controls.
- Compact pointer/two-tap/keyboard instructions.

A visible row activates its assignment slot; swaps change person values on slot objects and never move room IDs.

- [ ] **Step 4: Complete result CSS**

Use the same paper/ink/cobalt/shadow tokens. Add data-exporting=true during JPG capture so hover transforms, focus rings, selection outlines, and motion are suppressed in exports.

Animate successful swaps for 220ms; apply final state immediately under reduced motion.

- [ ] **Step 5: Finish recovery copy**

Add bilingual messages for roster retry, invalid import, impossible assignment, Excel failure, JPG failure, clipboard unavailable, and share unavailable. Every failure keeps the current workspace visible.

- [ ] **Step 6: Verify and commit**

~~~bash
npm test
npm run build
node --test tests/rendered-html.test.mjs
rg -n 'className=.*(bg-|text-|rounded-|grid-cols-|md:|lg:)' src
~~~

Expected: tests/build PASS and no runtime Tailwind utility strings.

~~~bash
git add src/App.tsx src/i18n.ts src/components/ResultWorkspace.tsx src/components/ResultWorkspace.test.tsx app/globals.css
git commit -m "feat: complete editorial rota result workflow"
~~~

## Task 8: Add social metadata and final hardening

**Files:**
- Create: public/og.png
- Modify: app/layout.tsx
- Modify: tests/rendered-html.test.mjs

- [ ] **Step 1: Write failing metadata assertions**

Assert the built HTML contains the exact title/description and an absolute og:image based on http://localhost/.

Run: npm run build && node --test tests/rendered-html.test.mjs

Expected: FAIL because social metadata is not complete.

- [ ] **Step 2: Generate one cohesive social card**

Read the imagegen skill. Make one image-generation request with:

~~~text
Create a complete 1200×630 social preview card for “Gubei Prefect Toolkit”. Match the finished Editorial Campus Desk interface: warm ivory paper, charcoal ink, cobalt blue action accents, crisp offset sheet shadows, refined editorial serif heading, and compact school-rota structure. Include the exact text “Gubei Prefect Toolkit” and “Build balanced prefect rotas, quickly.” Make typography highly legible in X, Slack, iMessage, and other link previews. No browser chrome, device frame, unrelated logo, watermark, people, or invented feature claims.
~~~

Inspect exact text and legibility. Retry once only if unusable. Save the accepted image as public/og.png.

- [ ] **Step 3: Derive metadata from incoming host**

Implement generateMetadata:

~~~ts
import type { Metadata } from "next";
import { headers } from "next/headers";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(protocol + "://" + host);
  const image = new URL("/og.png", base).toString();
  const title = "Gubei Prefect Toolkit";
  const description = "Build balanced SUIS Gubei prefect room rotas quickly.";
  return {
    metadataBase: base,
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
~~~

- [ ] **Step 4: Verify and commit**

~~~bash
npm test
npm run build
node --test tests/rendered-html.test.mjs
test -f public/og.png
test -f dist/server/index.js
git diff --check
git add public/og.png app/layout.tsx tests/rendered-html.test.mjs
git commit -m "feat: add site-specific social preview"
~~~

Expected: all commands exit 0.

## Task 9: Validate and publish publicly

**Files:**
- Modify: .openai/hosting.json
- Produce: /tmp/gubei-prefect-toolkit-site.tgz

- [ ] **Step 1: Run complete pre-hosting verification**

~~~bash
npm test
npm run build
node --test tests/rendered-html.test.mjs
git diff --check
git status --short --branch
~~~

Verify dist/server/index.js, emitted client assets, roster.json, and dist/.openai/hosting.json exist. Expected: zero failures and no uncommitted product changes.

- [ ] **Step 2: Create the Sites project exactly once**

Read .openai/hosting.json. If project_id is absent, call sites_create_site with:

~~~json
{
  "title": "Gubei Prefect Toolkit",
  "slug": "gubei-prefect-toolkit",
  "description": "A fast bilingual SUIS Gubei prefect rota builder."
}
~~~

Persist the response id unchanged as project_id. Keep only project_id and any actual d1/r2 bindings; this site needs neither D1 nor R2.

- [ ] **Step 3: Rebuild and commit hosting metadata**

~~~bash
npm run build
npm test
node --test tests/rendered-html.test.mjs
git diff --check
git add .openai/hosting.json
git commit -m "chore: bind Sites project"
~~~

Expected: all checks pass.

- [ ] **Step 4: Push the exact source state**

Use the short-lived credential returned by create_site, or request create_source_repository_write_credential. Push HEAD to its returned branch/remote with a per-command HTTP Authorization header derived from auth_mode and token. Never store or print the token.

Read git rev-parse HEAD and retain that exact SHA as commit_sha.

- [ ] **Step 5: Package the validated build**

~~~bash
/Users/jasonchen/.codex/plugins/cache/openai-bundled/sites/0.1.27/scripts/package-site.sh /Users/jasonchen/Movies/Gubei-Prefect-toolkit /tmp/gubei-prefect-toolkit-site.tgz
~~~

Expected: archive includes dist/server/index.js and dist/.openai/hosting.json.

- [ ] **Step 6: Save and deploy**

Call sites_save_site_version with exact project_id, pushed commit_sha, and archive. Retain version id.

Because the user explicitly requested a public site, call sites_deploy_site_version with project_id/version id. Retain deployment id.

- [ ] **Step 7: Poll to terminal state**

Call sites_get_deployment_status with matching project, version, and deployment IDs until succeeded or failed. On success, use the returned production URL as primary handoff. If an open_in_codex tool is present, call it with that URL; otherwise return the link without substituting browser automation. On failure, report failure_message without claiming publication.

- [ ] **Step 8: Final evidence**

~~~bash
git status --short --branch
git log -8 --oneline --decorate
~~~

Expected: clean implementation branch with focused commits. Report the public URL, preserved capabilities, and fresh verification evidence.
