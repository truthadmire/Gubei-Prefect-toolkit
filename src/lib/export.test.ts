import { describe, expect, it } from "vitest";
import type { ResultRow } from "../types";
import {
  buildBoardExportKey,
  buildExcelBlob,
  dataUrlToBlob,
  safeFilePart,
} from "./export";

function resultRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
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
    departmentName: "Academia",
    style: { bg: "#FFFFFF", fg: "#000000", border: "#BDBDBD" },
    ...overrides,
  };
}

const excelOptions = {
  title: "Morning & <Assembly>",
  dateStr: "2026-07-11 & onward",
  dateLabel: "Date <published>",
  roomHeader: "Class & Room",
  nameHeader: "Name <Department>",
};

describe("SpreadsheetML exports", () => {
  it("uses the Excel MIME type and escapes every user-facing field", async () => {
    const blob = buildExcelBlob([resultRow()], excelOptions);

    expect(blob.type).toBe("application/vnd.ms-excel;charset=utf-8");
    const xml = await blob.text();
    expect(xml).toContain("Morning &amp; &lt;Assembly&gt;");
    expect(xml).toContain("2026-07-11 &amp; onward");
    expect(xml).toContain("Date &lt;published&gt;");
    expect(xml).toContain("Class &amp; Room");
    expect(xml).toContain("Name &lt;Department&gt;");
    expect(xml).toContain("N201 (9&amp;A)");
    expect(xml).toContain("A &lt; B");
  });

  it("renders an empty assignment as a visible dash", async () => {
    const xml = await buildExcelBlob([resultRow({ personName: "" })], excelOptions).text();

    expect(xml).toContain('<Data ss:Type="String">-</Data>');
  });

  it("preserves result-row order", async () => {
    const rows = [
      resultRow({ formRoom: "FIRST-ROOM", personName: "First person" }),
      resultRow({
        room: { ...resultRow().room, id: "N202", number: 202 },
        formRoom: "SECOND-ROOM",
        personName: "Second person",
      }),
    ];

    const xml = await buildExcelBlob(rows, excelOptions).text();
    expect(xml.indexOf("FIRST-ROOM")).toBeLessThan(xml.indexOf("SECOND-ROOM"));
    expect(xml.indexOf("First person")).toBeLessThan(xml.indexOf("Second person"));
  });
});

describe("export utility boundaries", () => {
  it("sanitizes illegal filename characters and whitespace", () => {
    expect(safeFilePart(' Morning / Rota: * 1? "draft" ')).toBe("Morning_Rota_1_draft");
    expect(safeFilePart(" \\/:*?\"<>| \t\n ")).toBe("rota");
  });

  it("changes the board key for every semantic board field", () => {
    const row = resultRow();
    const first = buildBoardExportKey("en", "Morning", "2026-07-11", [row]);
    const variants: Array<[string, Parameters<typeof buildBoardExportKey>]> = [
      ["language", ["zh", "Morning", "2026-07-11", [row]]],
      ["title", ["en", "Afternoon", "2026-07-11", [row]]],
      ["date", ["en", "Morning", "2026-07-12", [row]]],
      ["room id", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, id: "N299" } })]]],
      ["room form", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, form: "10A" } })]]],
      ["room building", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, building: "S" } })]]],
      ["room number", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, number: 299 } })]]],
      ["room floor", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, floor: 3 } })]]],
      ["room enabled state", ["en", "Morning", "2026-07-11", [resultRow({ room: { ...row.room, enabled: false } })]]],
      ["displayed room", ["en", "Morning", "2026-07-11", [resultRow({ formRoom: "N299 (9A)" })]]],
      ["person", ["en", "Morning", "2026-07-11", [resultRow({ personName: "C" })]]],
      ["department", ["en", "Morning", "2026-07-11", [resultRow({ departmentName: "Charity" })]]],
      ["background", ["en", "Morning", "2026-07-11", [resultRow({ style: { ...row.style, bg: "#EEEEEE" } })]]],
      ["foreground", ["en", "Morning", "2026-07-11", [resultRow({ style: { ...row.style, fg: "#111111" } })]]],
      ["border", ["en", "Morning", "2026-07-11", [resultRow({ style: { ...row.style, border: "#AAAAAA" } })]]],
    ];

    for (const [label, args] of variants) {
      expect(buildBoardExportKey(...args), label).not.toBe(first);
    }
  });

  it("preserves the MIME type and exact bytes of a base64 data URL", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,AAEC/w==");

    expect(blob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([0, 1, 2, 255]);
  });
});
