"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResultRow } from "../types";

export type ResultWorkspaceProps = {
  title: string;
  date: string;
  dateLabel: string;
  dragHint: string;
  rowsByGrade: Array<{ grade: number; rows: ResultRow[] }>;
  selectedSwapRoomId: string | null;
  generatedCode: string;
  exportBusy: "jpg" | "share" | "excel" | null;
  boardRef: RefObject<HTMLDivElement | null>;
  labels: {
    back: string;
    downloadJpg: string;
    share: string;
    downloadExcel: string;
    copyCode: string;
    gradeTitle?: (grade: number) => string;
    codeTitle?: string;
    assignmentSheet?: string;
    actionsLabel?: string;
    unassigned?: string;
  };
  onActivateRoom: (roomId: string) => void;
  onBack: () => void;
  onDownloadJpg: () => void;
  onShare: () => void;
  onDownloadExcel: () => void;
  onCopyCode: () => void;
  onDragStart: (roomId: string) => void;
  onDrop: (roomId: string) => void;
  onDragEnd: () => void;
};

function gradeLabel(grade: number): string {
  return grade === 999 ? "Other forms" : `Grade ${grade}`;
}

export default function ResultWorkspace({
  title,
  date,
  dateLabel,
  dragHint,
  rowsByGrade,
  selectedSwapRoomId,
  generatedCode,
  exportBusy,
  boardRef,
  labels,
  onActivateRoom,
  onBack,
  onDownloadJpg,
  onShare,
  onDownloadExcel,
  onCopyCode,
  onDragStart,
  onDrop,
  onDragEnd,
}: ResultWorkspaceProps) {
  const previousPeople = useRef<Map<string, string> | null>(null);
  const clearAnimationTimer = useRef<number | null>(null);
  const [changedRoomIds, setChangedRoomIds] = useState<Set<string>>(new Set());
  const codeTitle = labels.codeTitle || "Rota code";
  const assignmentSheet = labels.assignmentSheet || "Prefect rota / Assignment sheet";
  const actionsLabel = labels.actionsLabel || "Rota actions";
  const unassigned = labels.unassigned || "Unassigned";

  useEffect(() => {
    const nextPeople = new Map<string, string>();
    for (const group of rowsByGrade) {
      for (const row of group.rows) nextPeople.set(row.room.id, row.personName);
    }

    const previous = previousPeople.current;
    previousPeople.current = nextPeople;
    if (!previous) return;

    const changed = new Set<string>();
    for (const [roomId, personName] of nextPeople) {
      if (previous.has(roomId) && previous.get(roomId) !== personName) changed.add(roomId);
    }
    if (changed.size === 0) return;

    setChangedRoomIds(changed);
    if (clearAnimationTimer.current !== null) window.clearTimeout(clearAnimationTimer.current);
    clearAnimationTimer.current = window.setTimeout(() => {
      setChangedRoomIds(new Set());
      clearAnimationTimer.current = null;
    }, 220);

    return () => {
      if (clearAnimationTimer.current !== null) {
        window.clearTimeout(clearAnimationTimer.current);
        clearAnimationTimer.current = null;
      }
    };
  }, [rowsByGrade]);

  return (
    <main className="result-workspace">
      <div
        ref={boardRef}
        className="result-board sheet"
        role="region"
        aria-label={title}
      >
        <header className="result-board__header">
          <div>
            <p className="sheet-kicker">{assignmentSheet}</p>
            <h1>{title}</h1>
          </div>
          <div className="result-board__date">
            <span>{dateLabel}</span>
            <time dateTime={date}>{date}</time>
          </div>
        </header>

        <p className="result-board__hint">{dragHint}</p>

        <div className="result-grade-list">
          {rowsByGrade.map((group) => (
            <section className="result-grade" key={group.grade} aria-labelledby={`result-grade-${group.grade}`}>
              <h2 id={`result-grade-${group.grade}`}>
                {labels.gradeTitle?.(group.grade) ?? gradeLabel(group.grade)}
              </h2>
              <div className="result-grade__rows">
                {group.rows.map((row) => {
                  const roomId = row.room.id;
                  const departmentName = row.departmentName?.trim() || "";
                  const slotStyle = row.personName
                    ? {
                        background: row.style.bg,
                        color: row.style.fg,
                        borderColor: row.style.border || row.style.fg,
                      }
                    : undefined;
                  const rowClassName = changedRoomIds.has(roomId)
                    ? "result-row result-row--changed"
                    : "result-row";

                  return (
                    <div className={rowClassName} key={roomId} data-room-id={roomId}>
                      <div className="result-row__room">
                        <strong>{row.formRoom}</strong>
                      </div>
                      {row.personName ? (
                        <button
                          type="button"
                          className="result-slot"
                          style={slotStyle}
                          aria-label={`${row.formRoom}, ${row.personName}, ${departmentName}`}
                          aria-pressed={selectedSwapRoomId === roomId}
                          draggable
                          onClick={() => onActivateRoom(roomId)}
                          onDragStart={(event) => {
                            event.dataTransfer?.setData("text/plain", roomId);
                            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                            onDragStart(roomId);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            onDrop(roomId);
                          }}
                          onDragEnd={onDragEnd}
                        >
                          <span className="result-slot__person">{row.personName}</span>
                          <span className="result-slot__department">{departmentName}</span>
                        </button>
                      ) : (
                        <span
                          className="result-slot result-slot--empty"
                          role="group"
                          aria-label={`${row.formRoom}, ${unassigned}`}
                        >
                          <span aria-hidden="true">—</span>
                          <span className="visually-hidden">{unassigned}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <section className="result-actions" aria-label={actionsLabel} aria-busy={exportBusy !== null}>
        <button type="button" className="button button--secondary" onClick={onBack}>{labels.back}</button>
        <button type="button" className="button button--primary" disabled={exportBusy !== null} aria-disabled={exportBusy !== null} onClick={onDownloadJpg}>{labels.downloadJpg}</button>
        <button type="button" className="button button--secondary" disabled={exportBusy !== null} aria-disabled={exportBusy !== null} onClick={onShare}>{labels.share}</button>
        <button type="button" className="button button--secondary" disabled={exportBusy !== null} aria-disabled={exportBusy !== null} onClick={onDownloadExcel}>{labels.downloadExcel}</button>
      </section>

      <section className="result-code sheet" aria-labelledby="result-code-title">
        <div className="result-code__heading">
          <h2 id="result-code-title">{codeTitle}</h2>
          <button type="button" className="button button--secondary" onClick={onCopyCode}>{labels.copyCode}</button>
        </div>
        <label className="field">
          <span>{codeTitle}</span>
          <textarea
            className="mono-input result-code__value"
            aria-label={codeTitle}
            readOnly
            value={generatedCode}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      </section>
    </main>
  );
}
