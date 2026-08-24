import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { GENERATION_HISTORY_KEY } from "./lib/history";

const toJpegMock = vi.hoisted(() => (
  vi.fn<(node: HTMLElement) => Promise<string>>().mockResolvedValue("data:image/jpeg;base64,AAEC")
));
const toPngMock = vi.hoisted(() => (
  vi.fn<(node: HTMLElement) => Promise<string>>().mockResolvedValue("data:image/png;base64,AAEC")
));

vi.mock("html-to-image", () => ({
  toJpeg: toJpegMock,
  toPng: toPngMock,
}));

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

function rosterResponse(value: unknown = roster): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function renderReady(value: unknown = roster) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rosterResponse(value)));
  const user = userEvent.setup();
  render(<App />);
  await screen.findByLabelText("Announcement title");
  return user;
}

async function completeBrief(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Announcement title"), "Morning briefing");
  fireEvent.change(screen.getByLabelText("Announcement date"), { target: { value: "2026-07-11" } });
}

async function generateResult({ disableBobDouble = false } = {}) {
  const user = await renderReady();
  await completeBrief(user);
  if (disableBobDouble) {
    await user.click(screen.getByRole("checkbox", { name: "Bob Zhang Double-duty" }));
  }
  await user.click(screen.getByRole("button", { name: "Generate rota" }));
  await screen.findByRole("region", { name: "Morning briefing" });
  return user;
}

describe("App editorial setup workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("lang", "en");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    toJpegMock.mockReset();
    toJpegMock.mockResolvedValue("data:image/jpeg;base64,AAEC");
    toPngMock.mockReset();
    toPngMock.mockResolvedValue("data:image/png;base64,AAEC");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    const mutableNavigator = navigator as unknown as Record<string, unknown>;
    delete mutableNavigator.canShare;
    delete mutableNavigator.share;
    delete mutableNavigator.clipboard;
    const mutableUrl = URL as unknown as Record<string, unknown>;
    delete mutableUrl.createObjectURL;
    delete mutableUrl.revokeObjectURL;
  });

  it("opens directly to the labeled Rota Generator workspace", async () => {
    await renderReady();

    expect(screen.getByRole("heading", { level: 1, name: "Rota Generator" })).toBeVisible();
    expect(screen.queryByText("Editorial campus duty desk")).not.toBeInTheDocument();
    expect(screen.getByText("Announcement title")).toBeVisible();
    expect(screen.getByLabelText("Announcement title")).toBeVisible();
    expect(screen.getByText("Announcement date")).toBeVisible();
    expect(screen.getByLabelText("Announcement date")).toBeVisible();
    expect(screen.queryByLabelText("Previous rota code")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /get started/i })).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the setup workflow in a logical DOM order", async () => {
    await renderReady();

    const orderedSteps = [
      screen.getByRole("heading", { name: "Announcement brief" }),
      screen.getByRole("heading", { name: "Prefects" }),
      screen.getByRole("heading", { name: "Forms" }),
      screen.getByRole("heading", { name: "Live summary" }),
      screen.getByRole("button", { name: "Generate rota" }),
      screen.getByRole("heading", { name: "Previous work" }),
    ];

    for (let index = 0; index < orderedSteps.length - 1; index += 1) {
      expect(
        orderedSteps[index].compareDocumentPosition(orderedSteps[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("loads database-ready history directly, searches it, and clears only this device", async () => {
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(GENERATION_HISTORY_KEY, JSON.stringify([{
      id: "40fdf22f-b96c-46a7-b575-dbd1e06d23f2",
      savedAt,
      updatedAt: savedAt,
      title: "Assembly duty",
      date: savedAt.slice(0, 10),
      code: "ROTAv2.saved.code",
      assignments: [{ person: "Alice Chen", rooms: ["N201"] }],
      editToken: "a".repeat(43),
      source: "device",
      syncStatus: "queued",
    }]));
    const user = await renderReady();

    expect(screen.getByRole("option", { name: /Assembly duty.*Waiting to share/ })).toBeVisible();
    expect(screen.getByText("Waiting to share")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Load" }));
    expect(screen.getByLabelText("Announcement title")).toHaveValue("Assembly duty");
    expect(screen.getByLabelText("Announcement date")).toHaveValue(savedAt.slice(0, 10));
    expect(screen.getByRole("status")).toHaveTextContent("History applied to the next rota");
    expect(screen.queryByLabelText("Previous rota code")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Search history"), "no match");
    expect(screen.getByText("No matching history")).toBeVisible();
    await user.clear(screen.getByLabelText("Search history"));
    await user.click(screen.getByRole("button", { name: "Clear this device" }));

    expect(window.localStorage.getItem(GENERATION_HISTORY_KEY)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Local history cleared");
  });

  it("downloads the generated workbook with the .xlsx extension", async () => {
    const downloadedNames: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:rota-workbook"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureDownload(this: HTMLAnchorElement) {
      downloadedNames.push(this.download);
    });
    const user = await generateResult();

    await user.click(screen.getByRole("button", { name: "Download Excel" }));

    await waitFor(() => expect(downloadedNames).toHaveLength(1));
    expect(downloadedNames[0]).toMatch(/\.xlsx$/);
  });

  it("disables generation and shows double-duty counts when staffing is impossible", async () => {
    const user = await renderReady();
    await completeBrief(user);

    await user.click(screen.getByRole("checkbox", { name: "Alice Chen Double-duty" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob Zhang Double-duty" }));

    expect(screen.getByText(/Required double-duty\s*1/i)).toBeVisible();
    expect(screen.getByText(/Available double-duty\s*0/i)).toBeVisible();
    expect(screen.getByText(/Current selection is not feasible/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate rota" })).toBeDisabled();
  });

  it("lists excluded people and forms before generating", async () => {
    const user = await renderReady();
    await completeBrief(user);

    await user.click(screen.getByRole("checkbox", { name: "Bob Zhang Selected" }));
    await user.click(screen.getByRole("button", { name: "9C" }));
    await user.click(screen.getByRole("button", { name: "Generate rota" }));

    const dialog = screen.getByRole("dialog", { name: "Review exclusions" });
    expect(within(dialog).getByText("Bob Zhang")).toBeVisible();
    expect(within(dialog).getByText("9C")).toBeVisible();
  });

  it("manages dialog focus for Go Back and Escape", async () => {
    const user = await renderReady();
    await completeBrief(user);
    await user.click(screen.getByRole("checkbox", { name: "Bob Zhang Selected" }));
    await user.click(screen.getByRole("button", { name: "9C" }));

    const generate = screen.getByRole("button", { name: "Generate rota" });
    await user.click(generate);
    const firstDialog = screen.getByRole("dialog", { name: "Review exclusions" });
    expect(firstDialog).toHaveAttribute("aria-modal", "true");
    const goBack = within(firstDialog).getByRole("button", { name: "Go Back" });
    expect(goBack).toHaveFocus();

    await user.click(goBack);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generate).toHaveFocus();

    await user.click(generate);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Go Back" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(generate).toHaveFocus();
  });

  it("cycles Tab focus within the open exclusions dialog", async () => {
    const user = await renderReady();
    await completeBrief(user);
    await user.click(screen.getByRole("checkbox", { name: "Bob Zhang Selected" }));
    await user.click(screen.getByRole("button", { name: "9C" }));

    const generate = screen.getByRole("button", { name: "Generate rota" });
    await user.click(generate);
    const dialog = screen.getByRole("dialog", { name: "Review exclusions" });
    const goBack = within(dialog).getByRole("button", { name: "Go Back" });
    const continueAnyway = within(dialog).getByRole("button", { name: "Continue Anyway" });
    expect(goBack).toHaveFocus();

    await user.tab({ shift: true });
    expect(continueAnyway).toHaveFocus();
    expect(generate).not.toHaveFocus();

    await user.tab();
    expect(goBack).toHaveFocus();
    expect(generate).not.toHaveFocus();
  });

  it.each([
    ["fetch response", () => Promise.resolve(new Response("Not found", { status: 404 }))],
    ["JSON parsing", () => Promise.resolve(new Response("not json", { status: 200 }))],
    ["roster validation", () => Promise.resolve(rosterResponse({ people: roster.people, rooms: [{ id: "bad", form: "9A" }] }))],
  ])("recovers from %s failure without a browser alert", async (_label, fetchResult) => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(fetchResult));
    render(<App />);

    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveTextContent("名单加载失败");
    expect(recovery).toHaveTextContent("Roster unavailable");
    expect(within(recovery).getByRole("button", { name: /Retry roster/i })).toBeVisible();
    expect(screen.queryByText("Loading roster...")).not.toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("retries roster loading from the recovery sheet", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(rosterResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    const recovery = await screen.findByRole("alert");
    await user.click(within(recovery).getByRole("button", { name: /Retry roster/i }));

    expect(await screen.findByLabelText("Announcement title")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a delayed roster failure in English on the bilingual recovery sheet", async () => {
    let resolveRoster!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveRoster = resolve;
    })));
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    render(<App />);

    await act(async () => {
      resolveRoster(new Response("Not found", { status: 404 }));
    });

    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveTextContent("Could not load roster.json");
    expect(recovery).toHaveTextContent("无法加载 roster.json");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("updates one stable local history session after a result swap", async () => {
    const user = await generateResult();
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(GENERATION_HISTORY_KEY) || "[]");
      expect(stored).toHaveLength(1);
    });
    const before = JSON.parse(window.localStorage.getItem(GENERATION_HISTORY_KEY) || "[]") as Array<{ id: string; code: string }>;
    const alice = screen.getAllByRole("button", { name: /Alice Chen.*Academia/i })[0];
    const bob = screen.getAllByRole("button", { name: /Bob Zhang.*Charity/i })[0];

    await user.click(alice);
    await user.click(bob);

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(GENERATION_HISTORY_KEY) || "[]") as Array<{ id: string; code: string }>;
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(before[0].id);
      expect(stored[0].code).not.toBe(before[0].code);
    });
  });

  it("announces a blocked paired-slot swap and leaves every room and person label unchanged", async () => {
    const user = await generateResult({ disableBobDouble: true });
    const aliceSlots = screen.getAllByRole("button", { name: /Alice Chen.*Academia/i });
    const bobSlot = screen.getByRole("button", { name: /Bob Zhang.*Charity/i });
    const accessibleNamesBefore = [
      ...aliceSlots.map((slot) => slot.getAttribute("aria-label")),
      bobSlot.getAttribute("aria-label"),
    ].sort();

    expect(aliceSlots).toHaveLength(2);
    await user.click(bobSlot);
    await user.click(aliceSlots[0]);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "This swap would move someone without double-duty permission into a paired slot.",
      );
    });
    const accessibleNamesAfter = screen
      .getAllByRole("button", { name: /Alice Chen.*Academia|Bob Zhang.*Charity/i })
      .map((slot) => slot.getAttribute("aria-label"))
      .sort();
    expect(accessibleNamesAfter).toEqual(accessibleNamesBefore);
  });

  it("moves people as whole assignment slots while preserving every room label", async () => {
    const user = await generateResult();
    const aliceSlots = screen.getAllByRole("button", { name: /Alice Chen.*Academia/i });
    const bobSlots = screen.getAllByRole("button", { name: /Bob Zhang.*Charity/i });
    const paired = aliceSlots.length === 2
      ? { person: "Alice Chen", department: "Academia", slots: aliceSlots }
      : { person: "Bob Zhang", department: "Charity", slots: bobSlots };
    const single = aliceSlots.length === 1
      ? { person: "Alice Chen", department: "Academia", slot: aliceSlots[0] }
      : { person: "Bob Zhang", department: "Charity", slot: bobSlots[0] };
    const pairedRoomIds = paired.slots.map((slot) => slot.closest<HTMLElement>("[data-room-id]")?.dataset.roomId || "");
    const singleRoomId = single.slot.closest<HTMLElement>("[data-room-id]")?.dataset.roomId || "";

    await user.click(single.slot);
    await user.click(paired.slots[0]);

    for (const roomId of pairedRoomIds) {
      expect(screen.getByRole("button", { name: new RegExp(`${roomId}.*${single.person}.*${single.department}`, "i") })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: new RegExp(`${singleRoomId}.*${paired.person}.*${paired.department}`, "i") })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Rota updated");
  });

  it("returns to setup without losing the brief or roster selections", async () => {
    const user = await generateResult({ disableBobDouble: true });

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByLabelText("Announcement title")).toHaveValue("Morning briefing");
    expect(screen.getByLabelText("Announcement date")).toHaveValue("2026-07-11");
    expect(screen.getByRole("checkbox", { name: "Alice Chen Selected" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob Zhang Selected" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bob Zhang Double-duty" })).not.toBeChecked();
  });

  it("clears transient swap selection when returning to setup and generating again", async () => {
    const user = await generateResult();
    const firstSlot = screen.getAllByRole("button", { name: /Alice Chen.*Academia|Bob Zhang.*Charity/i })[0];
    await user.click(firstSlot);
    expect(firstSlot).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Generate rota" }));
    await screen.findByRole("region", { name: "Morning briefing" });

    const regeneratedSlots = screen.getAllByRole("button", { name: /Alice Chen.*Academia|Bob Zhang.*Charity/i });
    for (const slot of regeneratedSlots) expect(slot).toHaveAttribute("aria-pressed", "false");
    await user.click(regeneratedSlots[0]);
    expect(regeneratedSlots[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).not.toHaveTextContent("Choose a different row to swap.");
  });

  it("announces unavailable sharing when neither native share nor image copy is supported", async () => {
    const user = await generateResult();
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });

    await user.click(screen.getByRole("button", { name: /^Share/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sharing is unavailable on this device."));
  });

  it("falls back to clipboard image copy when native sharing rejects", async () => {
    const user = await generateResult();
    const share = vi.fn().mockRejectedValue(new Error("native share failed"));
    const write = vi.fn().mockResolvedValue(undefined);
    class FakeClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    await user.click(screen.getByRole("button", { name: /^Share/i }));

    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0][0]).toBeInstanceOf(FakeClipboardItem);
    expect(Object.keys(write.mock.calls[0][0][0].data)).toEqual(["image/png"]);
    expect(write.mock.calls[0][0][0].data["image/png"].type).toBe("image/png");
    expect(screen.getByRole("status")).toHaveTextContent("image copied instead");
    expect(screen.getByRole("status")).not.toHaveTextContent("Sharing is unavailable");
  });

  it("does not attempt a clipboard image type the browser reports as unsupported", async () => {
    const user = await generateResult();
    const write = vi.fn().mockResolvedValue(undefined);
    class FakeClipboardItem {
      static supports = vi.fn(() => false);
      constructor(readonly data: Record<string, Blob>) {}
    }
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);

    await user.click(screen.getByRole("button", { name: /^Share/i }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sharing is unavailable"));
    expect(FakeClipboardItem.supports).toHaveBeenCalledWith("image/png");
    expect(toPngMock).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("treats native share cancellation as a quiet return", async () => {
    const user = await generateResult();
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    vi.stubGlobal("ClipboardItem", class FakeClipboardItem {});

    await user.click(screen.getByRole("button", { name: /^Share/i }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent("Sharing is unavailable");
  });

  it("marks only the live board as exporting and always clears the marker after JPG failure", async () => {
    toJpegMock.mockImplementation(async (node: HTMLElement) => {
      expect(node).toHaveAttribute("data-exporting", "true");
      throw new Error("capture failed");
    });
    const user = await generateResult();
    const board = screen.getByRole("region", { name: "Morning briefing" });

    await user.click(screen.getByRole("button", { name: "Download JPG" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not generate the image"));
    expect(board).not.toHaveAttribute("data-exporting");
  });

  it("uses fully localized result labels in Chinese mode", async () => {
    window.localStorage.setItem("lang", "zh");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rosterResponse()));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText("公告标题 / Announcement title");
    await user.type(screen.getByLabelText("公告标题 / Announcement title"), "晨间值勤");
    fireEvent.change(screen.getByLabelText("公告日期 / Announcement date"), { target: { value: "2026-07-11" } });

    await user.click(screen.getByRole("button", { name: "生成排布" }));
    const board = await screen.findByRole("region", { name: "晨间值勤" });

    expect(within(board).getByText("值勤排布单")).toBeVisible();
    expect(screen.getByRole("region", { name: "排布操作" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "排布码" })).not.toBeInTheDocument();
    expect(screen.queryByText("Prefect rota / Assignment sheet")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Rota actions" })).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
