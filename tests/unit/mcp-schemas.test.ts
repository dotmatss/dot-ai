import { describe, expect, it } from "vitest";

import { createMcpServerSchema, setMcpGrantsSchema, updateMcpServerSchema } from "@/features/mcp/schemas";

const valid = {
  name: "Orders MCP",
  endpointUrl: "https://mcp.example.com/mcp",
  authKind: "none" as const,
};

function reason(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string {
  return result.error?.issues.map((issue) => issue.message).join(" | ") ?? "";
}

describe("connecting a server", () => {
  it("accepts a minimal https endpoint with no credential", () => {
    expect(createMcpServerSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a plain http endpoint", () => {
    const result = createMcpServerSchema.safeParse({ ...valid, endpointUrl: "http://mcp.example.com/mcp" });
    expect(result.success).toBe(false);
    expect(reason(result)).toMatch(/https/i);
  });

  it("refuses a loopback, private or link-local endpoint", () => {
    for (const endpointUrl of [
      "https://localhost/mcp",
      "https://127.0.0.1/mcp",
      "https://10.0.0.1/mcp",
      "https://192.168.1.10/mcp",
      "https://169.254.169.254/",
      "https://[::1]/mcp",
    ]) {
      expect(createMcpServerSchema.safeParse({ ...valid, endpointUrl }).success, endpointUrl).toBe(false);
    }
  });

  it("refuses an endpoint with embedded credentials or an unusual port", () => {
    expect(createMcpServerSchema.safeParse({ ...valid, endpointUrl: "https://u:p@mcp.example.com/mcp" }).success).toBe(false);
    expect(createMcpServerSchema.safeParse({ ...valid, endpointUrl: "https://mcp.example.com:6379/mcp" }).success).toBe(false);
  });

  it("refuses a non-http scheme outright", () => {
    for (const endpointUrl of ["file:///etc/passwd", "stdio://local", "ws://mcp.example.com", "javascript:alert(1)"]) {
      expect(createMcpServerSchema.safeParse({ ...valid, endpointUrl }).success, endpointUrl).toBe(false);
    }
  });

  it("requires a credential when the auth kind is header", () => {
    const result = createMcpServerSchema.safeParse({ ...valid, authKind: "header" });
    expect(result.success).toBe(false);
    expect(reason(result)).toMatch(/needs a value/i);
  });

  it("refuses a credential when the auth kind is none", () => {
    // Storing a secret nothing will ever send is a secret kept for no reason.
    const result = createMcpServerSchema.safeParse({ ...valid, authKind: "none", credential: "token" });
    expect(result.success).toBe(false);
  });

  it("accepts a header credential with an explicit header name", () => {
    const result = createMcpServerSchema.safeParse({
      ...valid,
      authKind: "header",
      credential: "token",
      credentialHeader: "X-Api-Key",
    });
    expect(result.success).toBe(true);
  });

  it("refuses a header name that could inject another header", () => {
    // A CR or LF in a header name is a short path to a forged request.
    for (const credentialHeader of ["X-Api-Key\r\nX-Admin: true", "X Api Key", "X:Api", "", "Bad\nHeader"]) {
      const result = createMcpServerSchema.safeParse({ ...valid, authKind: "header", credential: "t", credentialHeader });
      expect(result.success, JSON.stringify(credentialHeader)).toBe(false);
    }
  });

  it("bounds the name and the credential", () => {
    expect(createMcpServerSchema.safeParse({ ...valid, name: "x" }).success).toBe(false);
    expect(createMcpServerSchema.safeParse({ ...valid, name: "x".repeat(61) }).success).toBe(false);
    expect(
      createMcpServerSchema.safeParse({ ...valid, authKind: "header", credential: "x".repeat(4_097) }).success,
    ).toBe(false);
  });

  it("does not accept a transport, so stdio cannot be requested", () => {
    const result = createMcpServerSchema.parse({ ...valid, transport: "stdio" } as never);
    expect(Object.keys(result)).not.toContain("transport");
  });

  it("does not accept a status, a slug or a workspace id from the caller", () => {
    const result = createMcpServerSchema.parse({
      ...valid,
      status: "active",
      slug: "chosen-by-caller",
      workspaceId: "11111111-1111-1111-1111-111111111111",
    } as never);
    expect(Object.keys(result).sort()).toEqual(["authKind", "endpointUrl", "name"]);
  });
});

describe("updating a server", () => {
  it("accepts an empty patch", () => {
    expect(updateMcpServerSchema.safeParse({}).success).toBe(true);
  });

  it("refuses a blank credential, so a blank field cannot erase a working one", () => {
    expect(updateMcpServerSchema.safeParse({ credential: "" }).success).toBe(false);
  });

  it("applies the same endpoint policy as creation", () => {
    expect(updateMcpServerSchema.safeParse({ endpointUrl: "http://mcp.example.com/mcp" }).success).toBe(false);
    expect(updateMcpServerSchema.safeParse({ endpointUrl: "https://mcp.example.com/mcp" }).success).toBe(true);
  });
});

describe("setting grants", () => {
  it("accepts a complete decision, including an empty one", () => {
    expect(setMcpGrantsSchema.safeParse({ grants: [] }).success).toBe(true);
    expect(
      setMcpGrantsSchema.safeParse({ grants: [{ toolName: "search", riskClass: "read", requiresApproval: false }] }).success,
    ).toBe(true);
  });

  it("refuses an unknown risk class", () => {
    expect(
      setMcpGrantsSchema.safeParse({ grants: [{ toolName: "search", riskClass: "harmless", requiresApproval: false }] }).success,
    ).toBe(false);
  });

  it("refuses a tool name outside the specified character set", () => {
    for (const toolName of ["search contacts", "../../etc/passwd", "", "x".repeat(129)]) {
      expect(
        setMcpGrantsSchema.safeParse({ grants: [{ toolName, riskClass: "read", requiresApproval: false }] }).success,
        toolName,
      ).toBe(false);
    }
  });

  it("never accepts an approved hash from the caller", () => {
    // The pin has to be the hash the server actually reports, read on our side.
    // Accepting one here would let a caller approve a definition of their own
    // invention.
    const parsed = setMcpGrantsSchema.parse({
      grants: [{ toolName: "search", riskClass: "read", requiresApproval: false, approvedHash: "deadbeef" }],
    } as never);
    expect(Object.keys(parsed.grants[0]!)).not.toContain("approvedHash");
  });

  it("bounds how many grants one request can carry", () => {
    const grants = Array.from({ length: 201 }, (_, index) => ({
      toolName: `tool_${index}`,
      riskClass: "read" as const,
      requiresApproval: false,
    }));
    expect(setMcpGrantsSchema.safeParse({ grants }).success).toBe(false);
  });
});
