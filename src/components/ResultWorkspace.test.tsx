import { createRef } from "react";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ResultRow } from "../types";
import ResultWorkspace, { type ResultWorkspaceProps } from "./ResultWorkspace";

function resultRow(
  roomId: string,
  form: string,
  personName: string,
  departmentName: string,
): ResultRow {
  return {
    room: {
      id: roomId,
      form,
      building: roomId.slice(0, 1),
      number: Number(roomId.slice(1)),
      floor: Number(roomId.slice(1, 2)),
      enabled: true,
    },
    formRoom: `${roomId} (${form})`,
    personName,
    departmentName,
    style: { bg: "#E8EAF6", fg: "#252723", border: "#2452D4" },
  };
}

const aliceN201 = resultRow("N201", "9A", "Alice Chen", "Academia");
const aliceN202 = resultRow("N202", "9B", "Alice Chen", "Academia");
const bobN203 = resultRow("N203", "9C", "Bob Zhang", "Charity");

function renderWorkspace(overrides: Partial<ResultWorkspaceProps> = {}) {
  const callbacks = {
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
  const props: ResultWorkspaceProps = {
    title: "Morning briefing",
    date: "2026-07-11",
    dateLabel: "Date",
    dragHint: "Drag or choose two rows to swap.",
    rowsByGrade: [{ grade: 9, rows: [aliceN201, aliceN202, bobN203] }],
    selectedSwapRoomId: null,
    generatedCode: "rota-code-123",
    exportBusy: null,
    boardRef: createRef<HTMLDivElement>(),
    labels: {
      back: "Back",
      downloadJpg: "Download JPG",
      share: "Share",
      downloadExcel: "Download Excel",
      copyCode: "Copy rota code",
    },
    ...callbacks,
    ...overrides,
  };
  const view = render(<ResultWorkspace {...props} />);
  return { ...view, callbacks, props };
}

describe("ResultWorkspace", () => {
  it("activates the same room through click, Enter, and Space exactly once each", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderWorkspace();
    const slot = screen.getByRole("button", { name: /N203 \(9C\).*Bob Zhang.*Charity/i });

    await user.click(slot);
    expect(callbacks.onActivateRoom).toHaveBeenLastCalledWith("N203");
    expect(callbacks.onActivateRoom).toHaveBeenCalledTimes(1);

    callbacks.onActivateRoom.mockClear();
    slot.focus();
    await user.keyboard("{Enter}");
    expect(callbacks.onActivateRoom).toHaveBeenCalledTimes(1);
    expect(callbacks.onActivateRoom).toHaveBeenLastCalledWith("N203");

    callbacks.onActivateRoom.mockClear();
    await user.keyboard(" ");
    expect(callbacks.onActivateRoom).toHaveBeenCalledTimes(1);
    expect(callbacks.onActivateRoom).toHaveBeenLastCalledWith("N203");
  });

  it("exposes selected room state with aria-pressed", () => {
    renderWorkspace({ selectedSwapRoomId: "N201" });

    expect(screen.getByRole("button", { name: /N201.*Alice Chen.*Academia/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /N203.*Bob Zhang.*Charity/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders all result actions and a readable labeled rota code", () => {
    renderWorkspace();

    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download JPG" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download Excel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy rota code" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Rota code" })).toHaveValue("rota-code-123");
    expect(screen.getByRole("button", { name: "Copy rota code" })).toHaveClass("button--secondary");
  });

  it("marks export actions busy and prevents duplicate export requests", () => {
    renderWorkspace({ exportBusy: "jpg" });

    const actions = screen.getByRole("region", { name: "Rota actions" });
    expect(actions).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Download JPG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download Excel" })).toBeDisabled();
  });

  it("uses supplied grade and code labels for a localized result", () => {
    const empty = resultRow("N204", "9D", "", "");
    renderWorkspace({
      rowsByGrade: [{ grade: 9, rows: [empty] }],
      labels: {
        back: "返回",
        downloadJpg: "下载图片",
        share: "分享",
        downloadExcel: "下载 Excel",
        copyCode: "复制排布码",
        gradeTitle: (grade: number) => `${grade} 年级`,
        codeTitle: "排布码",
        assignmentSheet: "值勤排布单",
        actionsLabel: "排布操作",
        unassigned: "未安排",
      } as ResultWorkspaceProps["labels"] & {
        gradeTitle: (grade: number) => string;
        codeTitle: string;
        assignmentSheet: string;
        actionsLabel: string;
        unassigned: string;
      },
    });

    expect(screen.getByRole("heading", { name: "9 年级" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "排布码" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "排布码" })).toHaveValue("rota-code-123");
    expect(screen.getByText("值勤排布单")).toBeVisible();
    expect(screen.getByRole("region", { name: "排布操作" })).toBeVisible();
    expect(screen.getByLabelText("N204 (9D), 未安排")).toBeVisible();
    expect(screen.queryByText("Prefect rota / Assignment sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Rota actions" })).not.toBeInTheDocument();
  });

  it("keeps both rooms in a paired assignment readable and keyed by stable room ids", async () => {
    const user = userEvent.setup();
    const { callbacks } = renderWorkspace();
    const aliceSlots = screen.getAllByRole("button", { name: /Alice Chen.*Academia/i });

    expect(aliceSlots).toHaveLength(2);
    expect(aliceSlots[0]).toHaveAccessibleName(/N201 \(9A\).*Alice Chen.*Academia/i);
    expect(aliceSlots[1]).toHaveAccessibleName(/N202 \(9B\).*Alice Chen.*Academia/i);

    await user.click(aliceSlots[0]);
    await user.click(aliceSlots[1]);
    expect(callbacks.onActivateRoom.mock.calls).toEqual([["N201"], ["N202"]]);
  });

  it("routes drag start, drop, and drag end with stable room ids", () => {
    const { callbacks } = renderWorkspace();
    const source = screen.getByRole("button", { name: /N201.*Alice Chen/i });
    const target = screen.getByRole("button", { name: /N203.*Bob Zhang/i });

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.dragEnd(source);

    expect(callbacks.onDragStart).toHaveBeenCalledWith("N201");
    expect(callbacks.onDrop).toHaveBeenCalledWith("N203");
    expect(callbacks.onDragEnd).toHaveBeenCalledTimes(1);
  });

  it("shows an accessible empty assignment without making it an interactive slot", () => {
    const empty = resultRow("N204", "9D", "", "");
    renderWorkspace({ rowsByGrade: [{ grade: 9, rows: [empty] }] });

    const board = screen.getByRole("region", { name: "Morning briefing" });
    expect(within(board).getByText("—")).toBeVisible();
    expect(within(board).getByLabelText("N204 (9D), Unassigned")).toBeVisible();
    expect(within(board).queryByRole("button", { name: /N204/i })).not.toBeInTheDocument();
  });

  it("suppresses hover filters while the board is being exported", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const exportingRule = css.match(/\[data-exporting="true"\],[\s\S]*?\{([\s\S]*?)\}/)?.[1] || "";

    expect(exportingRule).toContain("filter: none !important");
  });
});
