import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

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

describe("App editorial setup workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("lang", "en");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens directly to the labeled Prefect Rota workspace", async () => {
    await renderReady();

    expect(screen.getByRole("heading", { level: 1, name: "Prefect Rota" })).toBeVisible();
    expect(screen.getByText("Announcement title")).toBeVisible();
    expect(screen.getByLabelText("Announcement title")).toBeVisible();
    expect(screen.getByText("Announcement date")).toBeVisible();
    expect(screen.getByLabelText("Announcement date")).toBeVisible();
    expect(screen.queryByRole("link", { name: /get started/i })).not.toBeInTheDocument();
  });

  it("keeps the setup workflow in a logical DOM order", async () => {
    await renderReady();

    const orderedSteps = [
      screen.getByRole("heading", { name: "Announcement brief" }),
      screen.getByRole("heading", { name: "Previous work" }),
      screen.getByRole("heading", { name: "Prefects" }),
      screen.getByRole("heading", { name: "Forms" }),
      screen.getByRole("heading", { name: "Live summary" }),
      screen.getByRole("button", { name: "Generate rota" }),
    ];

    for (let index = 0; index < orderedSteps.length - 1; index += 1) {
      expect(
        orderedSteps[index].compareDocumentPosition(orderedSteps[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
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

  it("keeps selections unchanged and announces an invalid imported code", async () => {
    const user = await renderReady();
    const bobSelected = screen.getByRole("checkbox", { name: "Bob Zhang Selected" });
    const form9C = screen.getByRole("button", { name: "9C" });
    await user.click(bobSelected);
    await user.click(form9C);

    fireEvent.change(screen.getByLabelText("Previous rota code"), { target: { value: "not-a-rota-code" } });

    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Invalid or incompatible rota code"));
    expect(bobSelected).not.toBeChecked();
    expect(form9C).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("checkbox", { name: "Alice Chen Selected" })).toBeChecked();
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });
});
