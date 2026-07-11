import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

describe("App local preference hydration", () => {
  let resolveRoster: (response: Response) => void;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("lang", "en");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveRoster = resolve;
    })));
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports a delayed roster failure in the hydrated language", async () => {
    render(<App />);

    await act(async () => {
      resolveRoster(new Response("Not found", { status: 404 }));
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        "Could not load roster.json. Confirm it is in the public/ folder.",
      );
    });
  });
});
