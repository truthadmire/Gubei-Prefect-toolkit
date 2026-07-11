import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18N } from "../i18n";
import Masthead from "./Masthead";

describe("Masthead Shanghai date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a hydration-safe placeholder and refreshes after Shanghai midnight", () => {
    const serverHtml = renderToString(
      <Masthead copy={I18N.en} lang="en" onLanguageChange={() => undefined} />,
    );
    expect(serverHtml).toContain("<time>—</time>");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T15:59:59.900Z"));
    const { unmount } = render(
      <Masthead copy={I18N.en} lang="en" onLanguageChange={() => undefined} />,
    );
    expect(screen.getByText("2026-07-10", { selector: "time" })).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("2026-07-11", { selector: "time" })).toBeVisible();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the requested product title without the legacy subtitle", () => {
    render(<Masthead copy={I18N.zh} lang="zh" onLanguageChange={() => undefined} />);

    expect(screen.getByRole("heading", { level: 1, name: "Rota Generator" })).toBeVisible();
    expect(screen.queryByText("校园值勤排布台")).not.toBeInTheDocument();
  });
});
