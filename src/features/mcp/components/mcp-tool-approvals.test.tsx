import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { McpToolApprovals } from "@/features/mcp/components/mcp-tool-approvals";
import { mcpKeys } from "@/features/mcp/queries";
import type { McpToolView } from "@/features/mcp/types";
import type { MemberRole } from "@/features/workspaces/roles";

const setGrants = vi.hoisted(() => vi.fn());
const discover = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());

vi.mock("@/features/mcp/api", () => ({
  mcpApi: { setGrants, discover, listTools },
}));

let role: MemberRole = "admin";
vi.mock("@/features/workspaces/components/workspace-provider", () => ({
  useWorkspace: () => ({
    membership: { workspace: { id: "ws-1", slug: "acme", name: "Acme" }, organization: { id: "o", name: "O", slug: "o" }, role },
  }),
}));

const SERVER_ID = "srv-1";

function view(name: string, overrides: Partial<McpToolView> = {}): McpToolView {
  return {
    tool: {
      name,
      title: null,
      description: `Does ${name}.`,
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: {},
      contentHash: `hash-${name}`,
    },
    grant: null,
    stale: false,
    suggestedRiskClass: "write",
    ...overrides,
  };
}

function renderWith(views: McpToolView[]) {
  // `staleTime: Infinity` and a matching queryFn, because seeding the cache
  // alone is not enough: the query still refetches, and a mock returning
  // undefined would overwrite the seeded data mid-assertion.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  listTools.mockResolvedValue(views);
  client.setQueryData(mcpKeys.tools("acme", SERVER_ID), views);
  return render(
    <QueryClientProvider client={client}>
      <McpToolApprovals serverId={SERVER_ID} />
    </QueryClientProvider>,
  );
}

/** The card for one tool, found by its name. */
function card(name: string): HTMLElement {
  const element = screen.getByText(name).closest("li");
  if (!element) throw new Error(`No card for ${name}`);
  return element as HTMLElement;
}

beforeEach(() => {
  role = "admin";
  setGrants.mockReset();
  discover.mockReset();
  listTools.mockReset();
  setGrants.mockResolvedValue([]);
  discover.mockResolvedValue({ ok: true, message: "1 tool available", tools: [], rejected: [], truncated: false });
});

describe("nothing is approved by default", () => {
  it("renders a discovered tool as not approved", () => {
    renderWith([view("search_contacts")]);
    expect(within(card("search_contacts")).getByRole("checkbox", { name: "Approved" })).not.toBeChecked();
  });

  it("submits no grants when nothing is ticked", async () => {
    const user = userEvent.setup();
    renderWith([view("search_contacts")]);

    // Tick then untick, so the form is dirty and Save is enabled.
    const approved = within(card("search_contacts")).getByRole("checkbox", { name: "Approved" });
    await user.click(approved);
    await user.click(approved);
    await user.click(screen.getByRole("button", { name: "Save approvals" }));

    await waitFor(() => expect(setGrants).toHaveBeenCalledWith("acme", SERVER_ID, { grants: [] }));
  });

  it("keeps Save disabled until something changes", async () => {
    const user = userEvent.setup();
    renderWith([view("search_contacts")]);

    expect(screen.getByRole("button", { name: "Save approvals" })).toBeDisabled();
    await user.click(within(card("search_contacts")).getByRole("checkbox", { name: "Approved" }));
    expect(screen.getByRole("button", { name: "Save approvals" })).toBeEnabled();
  });
});

describe("the server's annotations are shown as claims", () => {
  it("attributes them to the server and marks them unverified", () => {
    renderWith([view("read_thing", { tool: { ...view("read_thing").tool, annotations: { readOnlyHint: true } } })]);
    const text = card("read_thing").textContent ?? "";
    expect(text).toMatch(/The server claims: read-only/);
    expect(text).toMatch(/Unverified/);
  });

  it("says so plainly when the server claims nothing", () => {
    renderWith([view("silent")]);
    expect(card("silent").textContent).toMatch(/The server claims nothing/);
  });

  it("pre-selects the suggested class without approving anything", () => {
    renderWith([view("readonly", { suggestedRiskClass: "read" })]);
    const row = card("readonly");
    expect(within(row).getByRole("combobox", { name: /Risk class for readonly/i })).toHaveValue("read");
    expect(within(row).getByRole("checkbox", { name: "Approved" })).not.toBeChecked();
  });

  it("defaults an unannotated tool to write, not read", () => {
    // Silence is not evidence of harmlessness.
    renderWith([view("mystery")]);
    expect(within(card("mystery")).getByRole("combobox", { name: /Risk class for mystery/i })).toHaveValue("write");
  });
});

describe("destructive tools", () => {
  it("forces approval on and does not let it be switched off", async () => {
    const user = userEvent.setup();
    renderWith([view("delete_contact", { suggestedRiskClass: "destructive" })]);
    const row = card("delete_contact");

    const toggle = within(row).getByRole("switch", { name: /Ask a person first/i });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();

    await user.click(within(row).getByRole("checkbox", { name: "Approved" }));
    await user.click(screen.getByRole("button", { name: "Save approvals" }));

    await waitFor(() =>
      expect(setGrants).toHaveBeenCalledWith("acme", SERVER_ID, {
        grants: [{ toolName: "delete_contact", riskClass: "destructive", requiresApproval: true }],
      }),
    );
  });

  it("pins approval on as soon as the class is changed to destructive", () => {
    renderWith([view("thing", { suggestedRiskClass: "read" })]);
    const row = card("thing");

    // A read tool starts without an approval requirement.
    expect(within(row).getByRole("switch", { name: /Ask a person first/i })).not.toBeChecked();

    // fireEvent rather than userEvent.selectOptions: the latter trips over
    // jsdom's document resolution for a select nested in this layout.
    fireEvent.change(within(row).getByRole("combobox", { name: /Risk class for thing/i }), {
      target: { value: "destructive" },
    });

    const toggle = within(row).getByRole("switch", { name: /Ask a person first/i });
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
  });
});

describe("a tool that changed after approval", () => {
  const stale = view("search_contacts", {
    stale: true,
    grant: {
      serverId: SERVER_ID,
      toolName: "search_contacts",
      approvedHash: "hash-old",
      riskClass: "read",
      requiresApproval: false,
      state: "stale",
      grantedAt: "2026-09-01T00:00:00.000Z",
    },
  });

  it("says so at the top of the page and on the row", () => {
    renderWith([stale]);
    expect(screen.getByText(/1 approved tool changed/i)).toBeInTheDocument();
    expect(within(card("search_contacts")).getByText(/Changed since approval/i)).toBeInTheDocument();
  });

  it("shows what the tool says now, so re-approving is an informed act", () => {
    renderWith([stale]);
    expect(within(card("search_contacts")).getByText("Does search_contacts.")).toBeInTheDocument();
  });
});

describe("authorization in the UI", () => {
  it("lets a viewer read the approvals but change nothing", () => {
    role = "viewer";
    renderWith([view("search_contacts")]);

    expect(within(card("search_contacts")).getByRole("checkbox", { name: "Approved" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save approvals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh tool list" })).not.toBeInTheDocument();
  });

  it("lets a member read but not change, because approving is an admin action", () => {
    role = "member";
    renderWith([view("search_contacts")]);
    expect(within(card("search_contacts")).getByRole("checkbox", { name: "Approved" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save approvals" })).not.toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("explains why the list might be empty", () => {
    renderWith([]);
    expect(screen.getByText(/No tools discovered/i)).toBeInTheDocument();
    expect(screen.getByText(/rejecting our credential/i)).toBeInTheDocument();
  });
});
