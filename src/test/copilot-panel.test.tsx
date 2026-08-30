import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copilotMocks = vi.hoisted(() => ({
  askCopilot: vi.fn(async () => ({ answer: "How can I help?", trace: [] as any[] })),
  createCopilotConversation: vi.fn(async () => ({ id: "conv-1", title: "chat", updatedAt: "" })),
  loadCopilotConversations: vi.fn(async () => [] as any[]),
  loadCopilotMessages: vi.fn(async () => [] as any[]),
  saveCopilotMessage: vi.fn(async () => undefined),
  saveCopilotFeedback: vi.fn(async () => undefined),
}));

vi.mock("@/features/copilot/copilot-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/copilot/copilot-core")>();
  return { ...actual, ...copilotMocks };
});

type EvidenceInput = {
  attachment?: { kind: string; excerpt?: string | null; path?: string | null };
  screenContext?: unknown;
};

const feedbackMocks = vi.hoisted(() => ({
  addEvidenceToOpenReport: vi.fn(
    async (_input: { attachment?: unknown; screenContext?: unknown }) => true,
  ),
}));

vi.mock("@/features/copilot/feedback-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/copilot/feedback-core")>();
  return { ...actual, ...feedbackMocks };
});

const captureMocks = vi.hoisted(() => ({
  captureAndUploadTicketScreenshot: vi.fn(async () => "user-1/shot.jpg"),
  attachScreenshotToLatestDraft: vi.fn(async () => true),
  readLogFile: vi.fn(async () => "line one\nline two"),
}));

vi.mock("@/features/copilot/screenshot-capture", () => ({
  ...captureMocks,
  SCREENSHOT_IGNORE_ATTR: "data-ticket-screenshot-ignore",
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { id: "user-1", default_warehouse_id: "wh-1" },
  }),
}));

import { CopilotPanel } from "@/features/copilot/copilot-panel";
import { requestCopilotReport } from "@/features/copilot/copilot-core";
import { makeReportContext } from "@/features/copilot/report-context";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollTo = vi.fn();

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/putaway-tasks"]}>
      <CopilotPanel variant="dock" />
    </MemoryRouter>,
  );
}

async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: /ask copilot/i }));
  return screen.findByRole("dialog");
}

type AskArgs = { question: string; pathname: string };

/** The panel calls askCopilot on the operator's behalf; read its arguments. */
function lastAsk(): AskArgs | undefined {
  const calls = copilotMocks.askCopilot.mock.calls as unknown as AskArgs[][];
  return calls.at(-1)?.[0];
}

function lastQuestion() {
  return lastAsk()?.question;
}

beforeEach(() => {
  vi.clearAllMocks();
  copilotMocks.askCopilot.mockResolvedValue({ answer: "How can I help?", trace: [] });
  copilotMocks.loadCopilotConversations.mockResolvedValue([]);
  feedbackMocks.addEvidenceToOpenReport.mockResolvedValue(true);
  captureMocks.captureAndUploadTicketScreenshot.mockResolvedValue("user-1/shot.jpg");
});

/** Everything the panel has tried to file with the open report. */
function evidenceCalls(): EvidenceInput[] {
  return feedbackMocks.addEvidenceToOpenReport.mock.calls.map((call) => call[0] as EvidenceInput);
}

describe("CopilotPanel support entry points", () => {
  it("offers a way to report a problem and to send feedback", async () => {
    renderPanel();
    await openPanel();

    expect(await screen.findByRole("button", { name: /report a problem/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send feedback/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /my reports/i })).toBeInTheDocument();
  });

  it("says nothing is filed until the operator confirms", async () => {
    renderPanel();
    await openPanel();

    expect(await screen.findByText(/nothing is filed until you confirm/i)).toBeInTheDocument();
  });

  it("opens a problem report on the operator's behalf", async () => {
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(lastQuestion()).toMatch(/not working right/i);
    expect(lastAsk()?.pathname).toBe("/putaway-tasks");
  });

  it("opens a feedback thread with different wording", async () => {
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /send feedback/i }));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(lastQuestion()).toMatch(/leave feedback/i);
  });

  it("lists the operator's own reports on request", async () => {
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /my reports/i }));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(lastQuestion()).toMatch(/reports i have filed/i);
  });

  it("opens itself when another screen hands it a crash to report", async () => {
    // This is the path behind the error boundary's "Report this" button.
    renderPanel();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => {
      requestCopilotReport({
        message: 'Something went wrong on /putaway-tasks. The app showed: "Location is full". I want to report it.',
        route: "/putaway-tasks",
      });
    });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(lastQuestion()).toContain("Location is full");
  });

  it("keeps working when the conversation cannot be persisted", async () => {
    // Preview and demo environments have no copilot tables; the report flow
    // still has to run rather than dying on the first save.
    copilotMocks.createCopilotConversation.mockRejectedValue(new Error("no table"));
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(await screen.findByText(/how can i help\?/i)).toBeInTheDocument();
  });

  it("shows the copilot's failure in the thread instead of throwing it away", async () => {
    copilotMocks.askCopilot.mockRejectedValue(new Error("The copilot is rate limited right now."));
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    expect(await screen.findByText(/rate limited right now/i)).toBeInTheDocument();
  });

  it("calls report activity report steps, not record lookups", async () => {
    copilotMocks.askCopilot.mockResolvedValue({
      answer: "Filed as WW-2608-0001.",
      trace: [
        { tool: "start_problem_report", input: {}, outcome: "ok", rows: 1 },
        { tool: "submit_problem_report", input: {}, outcome: "ok", rows: 1 },
      ],
    });
    renderPanel();
    await openPanel();

    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    expect(await screen.findByText(/2 report steps/i)).toBeInTheDocument();
    expect(screen.queryByText(/record lookups/i)).not.toBeInTheDocument();
  });

  it("still calls ordinary tool use record lookups", async () => {
    copilotMocks.askCopilot.mockResolvedValue({
      answer: "3 pallets.",
      trace: [{ tool: "search_inventory", input: {}, outcome: "ok", rows: 3 }],
    });
    renderPanel();
    const dialog = await openPanel();

    fireEvent.click(await screen.findByText(/what is open for me right now\?/i));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(await within(dialog).findByText(/1 record lookup/i)).toBeInTheDocument();
  });
});

describe("CopilotPanel composer", () => {
  it("offers explicit dictation without sending the message", async () => {
    renderPanel();
    await openPanel();
    expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask anything about this warehouse/i)).toHaveValue("");
  });

  it("sends on Enter once and leaves Shift+Enter as an editable newline", async () => {
    renderPanel();
    await openPanel();
    const composer = screen.getByPlaceholderText(/ask anything about this warehouse/i);

    fireEvent.change(composer, { target: { value: "Where is PAL-001?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.keyDown(composer, { key: "Enter" });

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalledTimes(1));
    expect((composer as HTMLTextAreaElement).value).toBe("");

    fireEvent.change(composer, { target: { value: "First line" } });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    fireEvent.change(composer, { target: { value: "First line\nSecond line" } });
    expect((composer as HTMLTextAreaElement).value).toBe("First line\nSecond line");
    expect(copilotMocks.askCopilot).toHaveBeenCalledTimes(1);
  });

  it("shows server-grounded source facts and stores one current response vote", async () => {
    copilotMocks.askCopilot.mockResolvedValue({
      answer: "PAL-001 is in A-01.",
      trace: [{ tool: "search_inventory", input: { query: "PAL-001" }, outcome: "ok", rows: 1 }],
    });
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByText(/what is open for me right now/i));

    expect(await screen.findByText(/sources: inventory records/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    await waitFor(() => expect(copilotMocks.saveCopilotFeedback).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Helpful" }));
    expect(copilotMocks.saveCopilotFeedback).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotPanel report evidence", () => {
  it("offers a screenshot or a log excerpt once a report is open", async () => {
    renderPanel();
    await openPanel();

    expect(screen.queryByRole("button", { name: /^screenshot$/i })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    expect(await screen.findByRole("button", { name: /^screenshot$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log excerpt/i })).toBeInTheDocument();
  });

  it("keeps the attach controls out of an ordinary question", async () => {
    renderPanel();
    const dialog = await openPanel();

    fireEvent.click(await screen.findByText(/what is open for me right now\?/i));

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    expect(within(dialog).queryByRole("button", { name: /^screenshot$/i })).not.toBeInTheDocument();
  });

  it("files a pasted log excerpt with the report", async () => {
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    fireEvent.click(await screen.findByRole("button", { name: /log excerpt/i }));
    fireEvent.change(screen.getByLabelText("Log excerpt"), {
      target: { value: "TypeError: cannot read pallet_count of undefined" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^attach$/i }));

    await waitFor(() =>
      expect(
        evidenceCalls().some((call) => call.attachment?.kind === "log"),
      ).toBe(true),
    );
    const logged = evidenceCalls().find((call) => call.attachment?.kind === "log");
    expect(logged?.attachment?.excerpt).toContain("cannot read pallet_count");
    expect(await screen.findByText(/attached/i)).toBeInTheDocument();
  });

  it("captures and files a screenshot on request", async () => {
    renderPanel();
    await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: /report a problem/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^screenshot$/i }));

    await waitFor(() => expect(captureMocks.captureAndUploadTicketScreenshot).toHaveBeenCalled());
    await waitFor(() =>
      expect(evidenceCalls().some((call) => call.attachment?.path === "user-1/shot.jpg")).toBe(true),
    );
  });

  it("carries what was on screen when the life buoy was pressed", async () => {
    renderPanel();

    act(() => {
      requestCopilotReport({
        message: 'I have a problem with the "New Shipment" screen. Here is what happened: ',
        route: "/receiving",
        context: makeReportContext({
          screen: "New Shipment",
          route: "/receiving",
          details: [
            { label: "SKU line 1", value: "FLOUR · Flour — total received 100, 25 per pallet, 4 pallets" },
            { label: "Container", value: "MSKU1234565" },
          ],
        }),
      });
    });

    await waitFor(() => expect(copilotMocks.askCopilot).toHaveBeenCalled());
    const selection = (lastAsk() as unknown as { selection?: Record<string, unknown> })?.selection;
    expect(selection?.screen_name).toBe("New Shipment");
    expect(selection?.on_screen).toMatchObject({ Container: "MSKU1234565" });

    await waitFor(() =>
      expect(evidenceCalls().some((call) => call.screenContext !== undefined)).toBe(true),
    );
  });
});
