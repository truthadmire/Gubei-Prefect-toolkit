import { useEffect, useId, useRef } from "react";
import type { AppCopy } from "../i18n";
import type { Person } from "../types";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && !element.closest("[hidden], [aria-hidden='true']"));
}

type SelectionConfirmDialogProps = {
  copy: AppCopy;
  deselectedPeople: Person[];
  deselectedForms: string[];
  opener: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onContinue: () => void;
};

export default function SelectionConfirmDialog({
  copy,
  deselectedPeople,
  deselectedForms,
  opener,
  onCancel,
  onContinue,
}: SelectionConfirmDialogProps) {
  const headingId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const goBackRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  function closeAndRestoreFocus() {
    onCancelRef.current();
    opener.current?.focus();
  }

  useEffect(() => {
    goBackRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = getFocusableElements(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !(active instanceof Node) || !dialogRef.current.contains(active);
      if (event.shiftKey && (active === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [opener]);

  return (
    <div className="dialog-backdrop">
      <section
        ref={dialogRef}
        className="selection-dialog sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <p className="sheet-kicker">Selection check</p>
        <h2 id={headingId}>{copy.confirmTitle}</h2>
        <p>{copy.confirmBody}</p>
        <div className="selection-dialog__lists">
          {deselectedPeople.length > 0 && (
            <section aria-labelledby={`${headingId}-people`}>
              <h3 id={`${headingId}-people`}>{copy.confirmPeople}</h3>
              <ul>
                {deselectedPeople.map((person) => <li key={person.id}>{person.name}</li>)}
              </ul>
            </section>
          )}
          {deselectedForms.length > 0 && (
            <section aria-labelledby={`${headingId}-forms`}>
              <h3 id={`${headingId}-forms`}>{copy.confirmForms}</h3>
              <ul className="selection-dialog__form-list">
                {deselectedForms.map((form) => <li key={form}>{form}</li>)}
              </ul>
            </section>
          )}
        </div>
        <div className="dialog-actions">
          <button ref={goBackRef} type="button" className="button button--secondary" onClick={closeAndRestoreFocus}>
            {copy.confirmBack}
          </button>
          <button type="button" className="button button--primary" onClick={onContinue}>
            {copy.confirmContinue}
          </button>
        </div>
      </section>
    </div>
  );
}
