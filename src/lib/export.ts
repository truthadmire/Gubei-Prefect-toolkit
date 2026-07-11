import type { Lang, ResultRow } from "../types";

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
};

let imageExporterPromise: Promise<ImageExporter> | null = null;

export function loadImageExporter(): Promise<ImageExporter> {
  if (!imageExporterPromise) {
    imageExporterPromise = import("html-to-image").then(({ toJpeg }) => ({ toJpeg }));
  }
  return imageExporterPromise;
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

export function buildExcelBlob(rows: ResultRow[], options: ExcelExportOptions): Blob {
  const styleMap = new Map<string, string>();
  for (const row of rows) {
    if (!row.personName) continue;
    const key = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    if (!styleMap.has(key)) styleMap.set(key, `person${styleMap.size}`);
  }

  const borderXml = `
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/>
      </Borders>`;
  const personStyles = Array.from(styleMap.entries()).map(([key, id]) => {
    const [bg, fg] = key.split("|");
    return `
        <Style ss:ID="${id}">
          <Font ss:Bold="1" ss:Color="${fg}"/>
          <Interior ss:Color="${bg}" ss:Pattern="Solid"/>
          <Alignment ss:Vertical="Center"/>
          ${borderXml}
        </Style>`;
  }).join("");

  const rowsXml = rows.map((row) => {
    const styleKey = `${excelColor(row.style.bg)}|${excelColor(row.style.fg)}`;
    const personStyle = row.personName ? styleMap.get(styleKey) || "empty" : "empty";
    return `
        <Row ss:Height="28">
          <Cell ss:StyleID="room"><Data ss:Type="String">${xmlEscape(row.formRoom)}</Data></Cell>
          <Cell ss:StyleID="${personStyle}"><Data ss:Type="String">${xmlEscape(row.personName || "-")}</Data></Cell>
        </Row>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="title"><Font ss:Bold="1" ss:Size="16"/><Alignment ss:Vertical="Center"/></Style>
    <Style ss:ID="meta"><Font ss:Bold="1" ss:Color="#475569"/></Style>
    <Style ss:ID="header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F172A" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    <Style ss:ID="room"><Font ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    <Style ss:ID="empty"><Font ss:Bold="1" ss:Color="#94A3B8"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/>${borderXml}</Style>
    ${personStyles}
  </Styles>
  <Worksheet ss:Name="Rota">
    <Table>
      <Column ss:Width="140"/>
      <Column ss:Width="220"/>
      <Row ss:Height="26"><Cell ss:StyleID="title" ss:MergeAcross="1"><Data ss:Type="String">${xmlEscape(options.title)}</Data></Cell></Row>
      <Row><Cell ss:StyleID="meta"><Data ss:Type="String">${xmlEscape(options.dateLabel)}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(options.dateStr)}</Data></Cell></Row>
      <Row/>
      <Row ss:Height="24">
        <Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(options.roomHeader)}</Data></Cell>
        <Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(options.nameHeader)}</Data></Cell>
      </Row>
      ${rowsXml}
    </Table>
  </Worksheet>
</Workbook>`;

  return new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" });
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
      row.style.bg,
      row.style.fg,
      row.style.border ?? "",
    ]),
  ]);
}
