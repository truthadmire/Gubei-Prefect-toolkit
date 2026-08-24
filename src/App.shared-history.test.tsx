import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GENERATION_HISTORY_KEY } from "./lib/history";
import type { GenerationHistoryItem } from "./types";

const fetchSharedHistoryPageMock = vi.hoisted(() => vi.fn());
const syncQueuedSharedHistoryMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("./lib/shared-history-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/shared-history-client")>();
  return {
    ...actual,
    SHARED_HISTORY_ENABLED: true,
    fetchSharedHistoryPage: fetchSharedHistoryPageMock,
    syncQueuedSharedHistory: syncQueuedSharedHistoryMock,
  };
});

const roster = {
  people: [
    { name: "Alice Chen", dept: "Academia" },
    { name: "Bob Zhang", dept: "Charity" },
  ],
  rooms: [
    { id: "N201", form: "9A" },
    { id: "N202", form: "9B" },
    { id: "N203", form: "9C" },
  ],
};

const sharedRecord: GenerationHistoryItem = {
  id: "40fdf22f-b96c-46a7-b575-dbd1e06d23f2",
  savedAt: "2026-08-23T01:00:00.000Z",
  updatedAt: "2026-08-23T01:00:00.000Z",
  title: "Database rota",
  date: "2026-08-23",
  code: "ROTAv2.database.code",
  assignments: [
    { person: "Alice Chen", rooms: ["N201"] },
    { person: "Bob Zhang", rooms: ["N202", "N203"] },
  ],
  rosterRevision: "a".repeat(64),
  source: "shared",
  syncStatus: "shared",
};

function rosterResponse(): Response {
  return new Response(JSON.stringify(roster), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function renderReady() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rosterResponse()));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText("Announcement title");
  return user;
}

describe("App automatic shared history", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("lang", "en");
    fetchSharedHistoryPageMock.mockReset();
    syncQueuedSharedHistoryMock.mockReset();
    syncQueuedSharedHistoryMock.mockResolvedValue([]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches shared history automatically and applies a selected record directly", async () => {
    fetchSharedHistoryPageMock.mockResolvedValue({ items: [sharedRecord], nextCursor: null });
    const user = await renderReady();

    await waitFor(() => expect(fetchSharedHistoryPageMock).toHaveBeenCalledWith(null));
    expect(await screen.findByRole("option", { name: /Database rota.*Shared publicly/ })).toBeVisible();
    expect(screen.getByText(/newest shared record is applied automatically/i)).toBeVisible();
    expect(screen.queryByLabelText("Previous rota code")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load" }));

    expect(screen.getByLabelText("Announcement title")).toHaveValue("Database rota");
    expect(screen.getByLabelText("Announcement date")).toHaveValue("2026-08-23");
    expect(screen.getByRole("status")).toHaveTextContent("History applied to the next rota");
  });

  it("prompts on a failed fetch but still generates and queues the rota offline", async () => {
    fetchSharedHistoryPageMock.mockRejectedValue(new Error("database unavailable"));
    const user = await renderReady();

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry.closest(".history-offline")).toHaveTextContent("Offline mode is active");
    expect(fetchSharedHistoryPageMock).toHaveBeenCalledWith(null);

    await user.type(screen.getByLabelText("Announcement title"), "Offline rota");
    fireEvent.change(screen.getByLabelText("Announcement date"), { target: { value: "2026-08-24" } });
    await user.click(screen.getByRole("button", { name: "Generate rota" }));

    expect(await screen.findByRole("region", { name: "Offline rota" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy rota code" })).not.toBeInTheDocument();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(GENERATION_HISTORY_KEY) || "[]");
      expect(stored).toEqual([
        expect.objectContaining({ title: "Offline rota", syncStatus: "queued", source: "device" }),
      ]);
    });
  });
});
