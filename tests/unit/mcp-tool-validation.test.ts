// @vitest-environment node
/**
 * A connected MCP server is untrusted input. A customer typed its URL, and
 * everything it returns is attacker-controlled from our point of view.
 *
 * Two properties are asserted here. A malformed tool is EXCLUDED rather than
 * fatal, so one bad definition cannot stop the other nineteen from working.
 * And nothing a server sends can make us store something unbounded.
 */
import { describe, expect, it } from "vitest";

import { MCP_LIMITS } from "@/features/mcp/constants";
import { validateTool, validateTools } from "@/features/mcp/server/tool-validation";

const good = {
  name: "search_contacts",
  title: "Contact Search",
  description: "Search the CRM.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  annotations: { readOnlyHint: true },
};

function expectRejected(raw: unknown, pattern: RegExp) {
  const result = validateTool(raw);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a rejection");
  expect(result.rejected.reason).toMatch(pattern);
}

describe("accepting a well-formed tool", () => {
  it("keeps the fields we need and computes a hash", () => {
    const result = validateTool(good);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");

    expect(result.tool.name).toBe("search_contacts");
    expect(result.tool.title).toBe("Contact Search");
    expect(result.tool.annotations).toEqual({ readOnlyHint: true });
    expect(result.tool.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts a tool with no parameters", () => {
    expect(validateTool({ name: "get_time", inputSchema: { type: "object", additionalProperties: false } }).ok).toBe(true);
  });

  it("keeps only the four specified annotation hints, and only booleans", () => {
    const result = validateTool({
      ...good,
      annotations: { readOnlyHint: true, destructiveHint: "yes", vendorHint: true, openWorldHint: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
  });
});

describe("rejecting malformed tool metadata", () => {
  it("rejects a non-object", () => {
    expectRejected("search_contacts", /not an object/i);
    expectRejected(null, /not an object/i);
  });

  it("rejects a name outside the specified character set", () => {
    expectRejected({ ...good, name: "search contacts" }, /tool name must be/i);
    expectRejected({ ...good, name: "search/../contacts" }, /tool name must be/i);
    expectRejected({ ...good, name: "" }, /tool name must be/i);
    expectRejected({ ...good, name: 42 }, /tool name must be/i);
  });

  it("rejects a name longer than the specified limit", () => {
    expectRejected({ ...good, name: "a".repeat(129) }, /tool name must be/i);
  });

  it("rejects a missing or null input schema, which the spec forbids", () => {
    expectRejected({ ...good, inputSchema: undefined }, /no input schema/i);
    expectRejected({ ...good, inputSchema: null }, /no input schema/i);
    expectRejected({ ...good, inputSchema: "object" }, /no input schema/i);
  });

  it("rejects an output schema that is present but not an object", () => {
    expectRejected({ ...good, outputSchema: "array" }, /not an object/i);
  });

  it("rejects a schema larger than we will store", () => {
    const huge = { type: "object", properties: { blob: { description: "x".repeat(MCP_LIMITS.maxSchemaBytes + 1_000) } } };
    expectRejected({ ...good, inputSchema: huge }, /larger than we will store/i);
  });

  it("rejects a schema nested deeper than we will process", () => {
    let deep: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < MCP_LIMITS.maxSchemaDepth + 4; i++) deep = { type: "object", properties: { nested: deep } };
    expectRejected({ ...good, inputSchema: deep }, /nested more deeply/i);
  });

  it("truncates an over-long description rather than rejecting the tool", () => {
    const result = validateTool({ ...good, description: "x".repeat(MCP_LIMITS.maxDescriptionLength + 500) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected acceptance");
    expect(result.tool.description).toHaveLength(MCP_LIMITS.maxDescriptionLength);
  });

  it("rejects a tool that asks for a parameter to be mirrored into an HTTP header", () => {
    // We do not implement `x-mcp-header` mirroring yet. Silently dropping a
    // header the server expects would produce a HeaderMismatch on every call,
    // so the tool is excluded with a reason instead.
    expectRejected(
      {
        ...good,
        inputSchema: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } },
      },
      /HTTP header/i,
    );
  });

  it("finds an x-mcp-header annotation nested inside the schema", () => {
    expectRejected(
      {
        ...good,
        inputSchema: {
          type: "object",
          properties: { outer: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } } },
        },
      },
      /HTTP header/i,
    );
  });
});

describe("validating a whole list", () => {
  it("keeps the good tools and reports the bad ones", () => {
    const result = validateTools([good, { name: "bad name" }, { ...good, name: "other_tool" }, 7]);

    expect(result.tools.map((tool) => tool.name)).toEqual(["search_contacts", "other_tool"]);
    expect(result.rejected).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("drops a duplicate name after the first", () => {
    // The spec says names SHOULD be unique per server, so a duplicate is
    // possible. Keeping the last one would mean the tool a customer approved
    // is not the tool that gets called.
    const result = validateTools([good, { ...good, description: "Something else entirely." }]);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.description).toBe("Search the CRM.");
    expect(result.rejected[0]?.reason).toMatch(/more than once/i);
  });

  it("truncates a list longer than the cap and says so", () => {
    const many = Array.from({ length: MCP_LIMITS.maxToolsPerServer + 5 }, (_, index) => ({ ...good, name: `tool_${index}` }));
    const result = validateTools(many);
    expect(result.tools).toHaveLength(MCP_LIMITS.maxToolsPerServer);
    expect(result.truncated).toBe(true);
  });

  it("survives a server that does not return an array at all", () => {
    expect(validateTools(null)).toEqual({ tools: [], rejected: [], truncated: false });
    expect(validateTools({ tools: [] })).toEqual({ tools: [], rejected: [], truncated: false });
  });

  it("never lets a rejection reason echo an unbounded name back", () => {
    const result = validateTools([{ name: "x".repeat(5_000), inputSchema: { type: "object" } }]);
    expect(result.rejected[0]?.name.length).toBeLessThanOrEqual(70);
  });
});
