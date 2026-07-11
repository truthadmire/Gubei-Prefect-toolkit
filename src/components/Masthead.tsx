import { useEffect, useState } from "react";
import type { AppCopy, Lang } from "../i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function formatShanghaiDate(timestamp: number): string {
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function millisecondsUntilShanghaiMidnight(timestamp: number): number {
  const shiftedTimestamp = timestamp + SHANGHAI_OFFSET_MS;
  const elapsed = ((shiftedTimestamp % DAY_MS) + DAY_MS) % DAY_MS;
  return DAY_MS - elapsed + 50;
}

function useShanghaiDate(): string {
  const [currentDate, setCurrentDate] = useState("");

  useEffect(() => {
    let timeoutId: number | undefined;
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      const now = Date.now();
      setCurrentDate(formatShanghaiDate(now));
      timeoutId = window.setTimeout(refresh, millisecondsUntilShanghaiMidnight(now));
    };
    refresh();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, []);

  return currentDate;
}

type MastheadProps = {
  copy: AppCopy;
  lang: Lang;
  onLanguageChange: (lang: Lang) => void;
};

export default function Masthead({ copy, lang, onLanguageChange }: MastheadProps) {
  const currentDate = useShanghaiDate();

  return (
    <header className="masthead">
      <div className="masthead__identity">
        <div className="masthead__brand">SUIS Gubei</div>
        <h1>Prefect Rota</h1>
        <p>{copy.setupSubtitle}</p>
      </div>
      <div className="masthead__tools">
        <div className="masthead__date">
          <span>{copy.today}</span>
          <time dateTime={currentDate || undefined}>{currentDate || "—"}</time>
        </div>
        <label className="language-control" htmlFor="language-select">
          <span>{copy.languageLabel}</span>
          <select
            id="language-select"
            value={lang}
            onChange={(event) => onLanguageChange(event.target.value as Lang)}
          >
            <option value="zh">{copy.languageZh}</option>
            <option value="en">{copy.languageEn}</option>
          </select>
        </label>
      </div>
    </header>
  );
}
