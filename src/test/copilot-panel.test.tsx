import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const copilotMocks = vi.hoisted(() => ({
  askCopilot: vi.fn(async () => ({ answer: "How can I help?", trace: [] as any[] })),
  createCopilotConversation: vi.fn(async () => ({ id: "conv-1", title: "chat", updatedAt: "" })),
  loadCopilotConversations: vi.fn(async () => [] as any[]),
  loadCopilotMessages: vi.fn(async () => [] as any[]),
  saveCopilotMessage: vi.fn(async () => undefined),
}));

vi.mock("@/features/copilot/copilot-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/copilot/copilot-core")>();
  return { ...actual, ...copilotMocks };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user-1" },
    profile: { id: "user-1", default_warehouse_id: "wh-1" },
  }),
}));

import { CopilotPanel } from "@/features/copilot/copilot-panel";
import { requestCopilotReport } from "@/features/copilot/copilot-core";

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
});

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
