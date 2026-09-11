import { describe, expect, it } from "vitest";

import { checkOutboundUrl, hostMatchesAllowlist, isBlockedOutboundHost } from "@/features/workflows/domain/outbound";
import {
  collectTemplateVariables,
  createRunContext,
  evaluateCondition,
  MissingVariableError,
  renderTemplate,
  resolvePath,
} from "@/features/workflows/domain/variables";

const context = createRunContext({
  trigger: { message: "Hello", contact: { email: "ada@example.com" } },
  input: { company: "Acme", seats: 12 },
  vars: { category: "Qualified", empty: "" },
  nodes: { classify: { category: "qualified", tags: ["a", "b"] } },
});

describe("resolvePath", () => {
  it("walks objects, arrays and bracket indexes", () => {
    expect(resolvePath(context, "trigger.contact.email")).toBe("ada@example.com");
    expect(resolvePath(context, "nodes.classify.tags[1]")).toBe("b");
    expect(resolvePath(context, "nodes.classify.tags.0")).toBe("a");
  });

  it("returns undefined instead of throwing on missing paths", () => {
    expect(resolvePath(context, "trigger.missing.deep")).toBeUndefined();
    expect(resolvePath(context, "nodes.classify.tags[9]")).toBeUndefined();
    expect(resolvePath(context, "input.seats.nope")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("interpolates values and stringifies non-strings", () => {
    const result = renderTemplate("{{input.company}} wants {{input.seats}} seats", context);
    expect(result.text).toBe("Acme wants 12 seats");
    expect(result.missing).toEqual([]);
  });

  it("replaces missing values with nothing and reports them once", () => {
    const result = renderTemplate("Hi {{input.name}} {{input.name}}, {{vars.empty}}!", context);
    expect(result.text).toBe("Hi  , !");
    expect(result.missing).toEqual(["input.name", "vars.empty"]);
  });

  it("supports keeping the placeholder or failing loudly", () => {
    expect(renderTemplate("{{input.name}}", context, { policy: "keep" }).text).toBe("{{input.name}}");
    expect(() => renderTemplate("{{input.name}}", context, { policy: "error" })).toThrow(MissingVariableError);
  });

  it("leaves text without placeholders untouched", () => {
    expect(renderTemplate("plain text", context).text).toBe("plain text");
    expect(collectTemplateVariables("{{a.b}} and {{ c }} and {{a.b}}")).toEqual(["a.b", "c"]);
  });
});

describe("evaluateCondition", () => {
  it("compares equality case-insensitively by default", () => {
    expect(evaluateCondition({ left: "{{vars.category}}", operator: "equals", right: "qualified" }, context).result).toBe(true);
    expect(
      evaluateCondition({ left: "{{vars.category}}", operator: "equals", right: "qualified", caseSensitive: true }, context).result,
    ).toBe(false);
  });

  it("handles contains, gt, lt and exists", () => {
    expect(evaluateCondition({ left: "{{trigger.message}}", operator: "contains", right: "ell" }, context).result).toBe(true);
    expect(evaluateCondition({ left: "{{trigger.message}}", operator: "contains", right: "" }, context).result).toBe(false);
    expect(evaluateCondition({ left: "{{input.seats}}", operator: "gt", right: "10" }, context).result).toBe(true);
    expect(evaluateCondition({ left: "{{input.seats}}", operator: "lt", right: "10" }, context).result).toBe(false);
    expect(evaluateCondition({ left: "{{input.company}}", operator: "exists", right: "" }, context).result).toBe(true);
    expect(evaluateCondition({ left: "{{input.missing}}", operator: "exists", right: "" }, context).result).toBe(false);
  });

  it("is false when a numeric comparison is not numeric", () => {
    expect(evaluateCondition({ left: "{{input.company}}", operator: "gt", right: "3" }, context).result).toBe(false);
  });

  it("reports the rendered operands and missing paths", () => {
    const result = evaluateCondition({ left: "{{vars.gone}}", operator: "equals", right: "x" }, context);
    expect(result).toMatchObject({ result: false, left: "", right: "x", missing: ["vars.gone"] });
  });
});

describe("outbound egress guard", () => {
  it("blocks loopback, link-local and private addresses", () => {
    for (const host of [
      "localhost",
      "api.localhost",
      "service.internal",
      "127.0.0.1",
      "127.13.9.4",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "::1",
      "[::1]",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isBlockedOutboundHost(host), host).toBe(true);
    }
  });

  it("allows ordinary public hosts", () => {
    for (const host of ["api.example.com", "172.32.0.1", "8.8.8.8", "example.co.uk"]) {
      expect(isBlockedOutboundHost(host), host).toBe(false);
    }
  });

  it("matches allowlist entries exactly or by wildcard sub-domain", () => {
    expect(hostMatchesAllowlist("api.example.com", ["api.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("API.Example.com", ["api.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("a.example.com", ["*.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("example.com", ["*.example.com"])).toBe(false);
    expect(hostMatchesAllowlist("evil-example.com", ["*.example.com"])).toBe(false);
    expect(hostMatchesAllowlist("api.example.com", [])).toBe(false);
  });

  it("requires https/http, an allowlist entry and a public host", () => {
    expect(checkOutboundUrl("https://api.example.com/hook", ["api.example.com"]).ok).toBe(true);
    expect(checkOutboundUrl("not a url", ["api.example.com"]).ok).toBe(false);
    expect(checkOutboundUrl("file:///etc/passwd", ["api.example.com"]).ok).toBe(false);
    expect(checkOutboundUrl("https://user:pass@api.example.com", ["api.example.com"]).ok).toBe(false);
    expect(checkOutboundUrl("https://api.example.com", []).ok).toBe(false);
    expect(checkOutboundUrl("https://other.example.org", ["api.example.com"]).ok).toBe(false);

    const loopback = checkOutboundUrl("http://127.0.0.1:8080/admin", ["127.0.0.1"]);
    expect(loopback.ok).toBe(false);
    if (!loopback.ok) expect(loopback.reason).toContain("private");
  });
});
