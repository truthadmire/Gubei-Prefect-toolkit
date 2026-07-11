import type { AppCopy } from "../i18n";
import { formatHistoryLabel } from "../lib/history";
import { deptStyleOf } from "../lib/departments";
import type {
  FormGroup,
  GenerationHistoryItem,
  PersonGroup,
} from "../types";
import type { GenerationSummary } from "../lib/rota";

type SetupWorkspaceProps = {
  copy: AppCopy;
  title: string;
  date: string;
  rotaCode: string;
  history: GenerationHistoryItem[];
  selectedHistoryId: string;
  personGroups: PersonGroup[];
  formGroups: FormGroup[];
  allowedForms: Set<string>;
  summary: GenerationSummary;
  canGenerate: boolean;
  generateButtonRef: React.RefObject<HTMLButtonElement | null>;
  onTitleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onRotaCodeChange: (value: string) => void;
  onHistorySelectionChange: (id: string) => void;
  onHistoryLoad: () => void;
  onHistoryClear: () => void;
  onPersonToggle: (id: string) => void;
  onDoubleToggle: (id: string) => void;
  onFormToggle: (form: string) => void;
  onGradeToggle: (forms: string[]) => void;
  onGenerate: () => void;
};

export default function SetupWorkspace({
  copy,
  title,
  date,
  rotaCode,
  history,
  selectedHistoryId,
  personGroups,
  formGroups,
  allowedForms,
  summary,
  canGenerate,
  generateButtonRef,
  onTitleChange,
  onDateChange,
  onRotaCodeChange,
  onHistorySelectionChange,
  onHistoryLoad,
  onHistoryClear,
  onPersonToggle,
  onDoubleToggle,
  onFormToggle,
  onGradeToggle,
  onGenerate,
}: SetupWorkspaceProps) {
  return (
    <main className="setup-workspace">
      <div className="setup-layout">
        <div className="setup-main">
          <section className="sheet brief-sheet" aria-labelledby="brief-heading">
            <p className="sheet-kicker">01 / Brief</p>
            <h2 id="brief-heading">{copy.announcementBrief}</h2>
            <div className="brief-fields">
              <label className="field" htmlFor="announcement-title">
                <span>{copy.announcementTitle}</span>
                <input
                  id="announcement-title"
                  value={title}
                  placeholder={copy.titlePh}
                  onChange={(event) => onTitleChange(event.target.value)}
                />
              </label>
              <label className="field" htmlFor="announcement-date">
                <span>{copy.announcementDate}</span>
                <input
                  id="announcement-date"
                  type="date"
                  value={date}
                  onChange={(event) => onDateChange(event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="sheet restore-sheet" aria-labelledby="restore-heading">
            <p className="sheet-kicker">02 / Restore</p>
            <h2 id="restore-heading">{copy.restoreTitle}</h2>
            <label className="field" htmlFor="previous-rota-code">
              <span>{copy.previousCodeLabel}</span>
              <input
                id="previous-rota-code"
                className="mono-input"
                aria-label={copy.previousCodeLabel}
                value={rotaCode}
                placeholder={copy.lastCodePh}
                onChange={(event) => onRotaCodeChange(event.target.value)}
              />
              <small>{copy.previousCodeHint}</small>
            </label>
            {history.length > 0 && (
              <div className="history-controls">
                <label className="field" htmlFor="history-select">
                  <span>{copy.historyTitle}</span>
                  <select
                    id="history-select"
                    aria-label={copy.historySelect}
                    value={selectedHistoryId}
                    onChange={(event) => onHistorySelectionChange(event.target.value)}
                  >
                    {history.map((item) => (
                      <option key={item.id} value={item.id}>{formatHistoryLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <div className="history-actions">
                  <button type="button" className="button button--secondary" disabled={!selectedHistoryId} onClick={onHistoryLoad}>
                    {copy.historyUse}
                  </button>
                  <button type="button" className="button button--quiet" onClick={onHistoryClear}>
                    {copy.historyClear}
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="selection-grid">
            <section className="sheet selection-sheet" aria-labelledby="prefects-heading">
              <p className="sheet-kicker">03 / People</p>
              <h2 id="prefects-heading">{copy.peopleSel}</h2>
              <p className="section-hint">{copy.peopleHint}</p>
              <div className="prefect-groups">
                {personGroups.map((group, groupIndex) => (
                  <section key={group.dept} className="prefect-group" aria-labelledby={`department-${groupIndex}`}>
                    <h3 id={`department-${groupIndex}`}>
                      <span
                        className="department-swatch"
                        aria-hidden="true"
                        style={{ background: group.style.bg, borderColor: group.style.border || "rgba(37,39,35,.45)" }}
                      />
                      {group.dept}
                    </h3>
                    <div className="prefect-list">
                      {group.people.map((person) => {
                        const style = deptStyleOf(person.dept);
                        return (
                          <div className="prefect-row" key={person.id}>
                            <label className="prefect-choice">
                              <input
                                type="checkbox"
                                checked={person.active}
                                aria-label={copy.personSelectedA11y(person.name)}
                                onChange={() => onPersonToggle(person.id)}
                              />
                              <span
                                className="department-swatch"
                                aria-hidden="true"
                                style={{ background: style.bg, borderColor: style.border || "rgba(37,39,35,.45)" }}
                              />
                              <span>{person.name}</span>
                            </label>
                            <label className="double-choice">
                              <span>{copy.ddLabel}</span>
                              <input
                                type="checkbox"
                                checked={person.canDouble}
                                aria-label={copy.personDoubleA11y(person.name)}
                                onChange={() => onDoubleToggle(person.id)}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <section className="sheet selection-sheet" aria-labelledby="forms-heading">
              <p className="sheet-kicker">04 / Rooms</p>
              <h2 id="forms-heading">{copy.formSel}</h2>
              <p className="section-hint">{copy.formsHint}</p>
              <div className="grade-groups">
                {formGroups.map((group) => {
                  const gradeTitle = copy.gradeTitle(group.grade);
                  const selectedCount = group.forms.filter((form) => allowedForms.has(form)).length;
                  const allSelected = selectedCount === group.forms.length;
                  const partiallySelected = selectedCount > 0 && !allSelected;
                  return (
                    <section className="grade-group" key={group.grade} aria-labelledby={`grade-${group.grade}`}>
                      <div className="grade-group__heading">
                        <h3 id={`grade-${group.grade}`}>{gradeTitle}</h3>
                        <label>
                          <span>{copy.gradeToggle}</span>
                          <input
                            type="checkbox"
                            aria-label={copy.gradeAllA11y(gradeTitle)}
                            checked={allSelected}
                            ref={(element) => {
                              if (element) element.indeterminate = partiallySelected;
                            }}
                            onChange={() => onGradeToggle(group.forms)}
                          />
                        </label>
                      </div>
                      <div className="form-buttons">
                        {group.forms.map((form) => {
                          const selected = allowedForms.has(form);
                          return (
                            <button
                              key={form}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => onFormToggle(form)}
                            >
                              {form}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          </div>
        </div>

        <aside className="setup-rail" aria-labelledby="summary-heading">
          <section className="sheet summary-sheet">
            <p className="sheet-kicker">05 / Check</p>
            <h2 id="summary-heading">{copy.summaryTitle}</h2>
            <div className="summary-counts" aria-live="polite">
              <p>{copy.activePeopleLabel} {summary.activePeople}</p>
              <p>{copy.enabledRoomsLabel} {summary.enabledRooms}</p>
              <p>{copy.requiredDoubleLabel} {summary.requiredDouble}</p>
              <p>{copy.availableDoubleLabel} {summary.availableDouble}</p>
            </div>
            <p className={`feasibility ${summary.feasible ? "feasibility--ok" : "feasibility--blocked"}`}>
              {summary.feasible ? copy.feasible : copy.infeasible}
            </p>
          </section>
          <button
            ref={generateButtonRef}
            type="button"
            className="button button--primary generate-button"
            disabled={!canGenerate}
            onClick={onGenerate}
          >
            {copy.generate}
          </button>
        </aside>
      </div>
    </main>
  );
}
