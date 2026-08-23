import type { Lang } from "../i18n";
import type { ResultRow } from "../types";

export type ExcelExportOptions = {
  title: string;
  dateStr: string;
  dateLabel: string;
  roomHeader: string;
  nameHeader: string;
};

export function xmlEscape(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function safeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/^_+|_+$/g, "") || "rota";
}

export function excelColor(color?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color!.toUpperCase() : "#FFFFFF";
}

type ImageExporter = {
  toJpeg: (
    node: HTMLElement,
    options: { quality: number; pixelRatio: number; backgroundColor: string },
  ) => Promise<string>;
  toPng: (
    node: HTMLElement,
    options: { pixelRatio: number; backgroundColor: string },
  ) => Promise<string>;
};

let imageExporterPromise: Promise<ImageExporter> | null = null;

export function loadImageExporter(): Promise<ImageExporter> {
  if (!imageExporterPromise) {
    imageExporterPromise = import("html-to-image").then(({ toJpeg, toPng }) => ({ toJpeg, toPng }));
  }
  return imageExporterPromise;
}

export const MAX_EXPORT_PIXEL_RATIO = 2;
export const MAX_EXPORT_PIXELS = 12_000_000;

export function exportPixelRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return MAX_EXPORT_PIXEL_RATIO;
  }
  return Math.min(MAX_EXPORT_PIXEL_RATIO, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(",");
  const mime = meta.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
  const bin = atob(payload || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function buildExcelBlob(rows: ResultRow[], options: ExcelExportOptions): Promise<Blob> {
  const { strToU8, zipSync } = await import("fflate");
  const styleMap = new Map<string, number>();
  for (const row of rows) {
    if (!row.personName) continue;
    const key = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    if (!styleMap.has(key)) styleMap.set(key, 6 + styleMap.size);
  }

  const personStyleEntries = Array.from(styleMap.keys());
  const personFonts = personStyleEntries.map((key) => {
    const [, fg] = key.split("|");
    return `<font><b/><sz val="11"/><color rgb="FF${fg.slice(1)}"/><name val="Arial"/><family val="2"/></font>`;
  }).join("");
  const personFills = personStyleEntries.map((key) => {
    const [bg] = key.split("|");
    return `<fill><patternFill patternType="solid"><fgColor rgb="FF${bg.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`;
  }).join("");
  const personXfs = personStyleEntries.map((_, index) => (
    `<xf numFmtId="0" fontId="${6 + index}" fillId="${5 + index}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>`
  )).join("");

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${6 + personStyleEntries.length}">
    <font><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="16"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF475569"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FF94A3B8"/><name val="Arial"/><family val="2"/></font>
    ${personFonts}
  </fonts>
  <fills count="${5 + personStyleEntries.length}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    ${personFills}
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${6 + personStyleEntries.length}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    ${personXfs}
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const inlineStringCell = (reference: string, value: string, styleId = 0) => (
    `<c r="${reference}"${styleId ? ` s="${styleId}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  );
  const rowsXml = rows.map((row, index) => {
    const styleKey = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    const personStyle = row.personName ? styleMap.get(styleKey) ?? 5 : 5;
    const rowNumber = index + 5;
    return `<row r="${rowNumber}" ht="28" customHeight="1">${inlineStringCell(`A${rowNumber}`, row.formRoom, 4)}${inlineStringCell(`B${rowNumber}`, row.personName || "-", personStyle)}</row>`;
  }).join("");

  const lastRow = Math.max(4, rows.length + 4);
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:B${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="26" customHeight="1">${inlineStringCell("A1", options.title, 1)}</row>
    <row r="2">${inlineStringCell("A2", options.dateLabel, 2)}${inlineStringCell("B2", options.dateStr)}</row>
    <row r="3"/>
    <row r="4" ht="24" customHeight="1">${inlineStringCell("A4", options.roomHeader, 3)}${inlineStringCell("B4", options.nameHeader, 3)}</row>
    ${rowsXml}
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Gubei Prefect Toolkit</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Rota</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${xmlEscape(options.title)}</dc:title>
  <dc:creator>Gubei Prefect Toolkit</dc:creator>
</cp:coreProperties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16384" windowHeight="8192"/></bookViews>
  <sheets><sheet name="Rota" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="0"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(stylesXml),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml),
  };
  const archive = zipSync(files, { level: 6 });
  return new Blob([archive], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function buildBoardExportKey(
  lang: Lang,
  title: string,
  dateStr: string,
  rows: ResultRow[],
): string {
  return JSON.stringify([
    lang,
    title,
    dateStr,
    rows.map((row) => [
      row.room.id,
      row.room.form ?? "",
      row.room.building,
      row.room.number,
      row.room.floor,
      row.room.enabled,
      row.formRoom,
      row.personName,
      row.departmentName ?? "",
      row.style.bg,
      row.style.fg,
      row.style.border ?? "",
    ]),
  ]);
}
