// @vitest-environment node
/**
 * Outbound credentials: validation, and the header each kind assembles.
 *
 * These are the two halves an operator can get wrong and the two halves a
 * mistake would be expensive in:
 *
 *   - the schema decides what may be stored. A header name is attacker-adjacent
 *     input (it is typed by a workspace member and later set on a request), so
 *     the reserved list and the token-character rule are asserted here rather
 *     than trusted.
 *   - `buildCredentialHeader` decides what is sent. It is a leaf module with no
 *     database precisely so this file can drive it directly.
 *
 * The blank-means-keep rule gets its own group: it is what lets the edit form
 * exist without any endpoint ever returning a stored value.
 */
import { describe, expect, it } from "vitest";

import { CREDENTIAL_TYPE_META, credentialHeaderName } from "@/features/integrations/constants";
import { buildCredentialHeader, CredentialUnavailableError } from "@/features/integrations/credential-headers";
import { parseCredentialFilters } from "@/features/integrations/filters";
import { credentialSchemaFor, createCredentialSchema, type CredentialFormValues } from "@/features/integrations/schemas";
import { CREDENTIAL_TYPES } from "@/features/integrations/types";

describe("credentialSchemaFor — required values", () => {
  it("demands every field the kind declares when creating", () => {
    for (const type of CREDENTIAL_TYPES) {
      const result = credentialSchemaFor(type, { secretsRequired: true }).safeParse({
        name: "Stripe",
        headerName: type === "header" ? "X-Api-Key" : "",
        secrets: {},
      });
      expect(result.success, `${type} accepted empty secrets`).toBe(false);
    }
  });

  it("accepts a complete credential of each kind", () => {
    const secrets: Record<string, Record<string, string>> = {
      bearer: { token: "sk_live_123" },
      header: { value: "abc123" },
      basic: { username: "alice", password: "hunter2" },
    };
    for (const type of CREDENTIAL_TYPES) {
      const result = credentialSchemaFor(type, { secretsRequired: true }).safeParse({
        name: "Production",
        headerName: type === "header" ? "X-Api-Key" : "",
        secrets: secrets[type],
      });
      expect(result.success, `${type} was rejected`).toBe(true);
    }
  });

  it("requires a header name for the custom-header kind only", () => {
    expect(
      credentialSchemaFor("header", { secretsRequired: true }).safeParse({
        name: "Acme",
        headerName: "",
        secrets: { value: "abc" },
      }).success,
    ).toBe(false);

    // Bearer and basic name their own header, so anything sent is ignored
    // rather than stored - there must be exactly one source of truth.
    const bearer = credentialSchemaFor("bearer", { secretsRequired: true }).safeParse({
      name: "Acme",
      headerName: "",
      secrets: { token: "abc" },
    });
    expect(bearer.success).toBe(true);
  });
});

describe("credentialSchemaFor — header names", () => {
  const parseHeader = (headerName: string) =>
    credentialSchemaFor("header", { secretsRequired: true }).safeParse({
      name: "Acme",
      headerName,
      secrets: { value: "abc" },
    });

  it("refuses headers the request itself owns", () => {
    for (const reserved of ["Host", "content-length", "Content-Type", "Transfer-Encoding", "Connection"]) {
      expect(parseHeader(reserved).success, `${reserved} was accepted`).toBe(false);
    }
  });

  it("refuses anything that is not an RFC 7230 token", () => {
    // A space or a colon would let one header become two.
    for (const invalid of ["X Api Key", "X-Api-Key:", "X-Api\nKey", "X-Api-Key\r\nEvil: 1", "auth=x", "héader"]) {
      expect(parseHeader(invalid).success, `${JSON.stringify(invalid)} was accepted`).toBe(false);
    }
  });

  it("accepts ordinary custom headers", () => {
    for (const valid of ["X-Api-Key", "x-api-key", "Api_Key", "X-Token.v2", "X-A~B"]) {
      expect(parseHeader(valid).success, `${valid} was rejected`).toBe(true);
    }
  });
});

describe("credentialSchemaFor — editing", () => {
  it("accepts blank fields, which mean “keep the stored value”", () => {
    const result = credentialSchemaFor("basic", { secretsRequired: false }).safeParse({
      name: "Acme",
      headerName: "",
      secrets: {},
    });
    expect(result.success).toBe(true);
    // Blank rather than absent: the service distinguishes "" (keep) from a
    // non-empty string (replace), so both branches need a string to look at.
    expect(result.success && result.data.secrets).toEqual({ username: "", password: "" });
  });

  it("still enforces the name and the header name while editing", () => {
    expect(
      credentialSchemaFor("bearer", { secretsRequired: false }).safeParse({ name: "a", headerName: "", secrets: {} })
        .success,
    ).toBe(false);
    expect(
      credentialSchemaFor("header", { secretsRequired: false }).safeParse({ name: "Acme", headerName: "Host", secrets: {} })
        .success,
    ).toBe(false);
  });
});

describe("createCredentialSchema", () => {
  it("rejects an unknown kind", () => {
    expect(createCredentialSchema.safeParse({ name: "Acme", type: "oauth", secrets: {} }).success).toBe(false);
  });

  it("defaults the optional parts so a minimal body parses", () => {
    const result = createCredentialSchema.safeParse({ name: "Acme", type: "bearer" });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toMatchObject({ headerName: "", secrets: {} });
  });
});

describe("buildCredentialHeader", () => {
  it("assembles each kind's header", () => {
    expect(buildCredentialHeader("bearer", null, { token: "sk_live_123" })).toEqual({
      name: "Authorization",
      value: "Bearer sk_live_123",
    });
    expect(buildCredentialHeader("header", "X-Api-Key", { value: "abc123" })).toEqual({
      name: "X-Api-Key",
      value: "abc123",
    });
    expect(buildCredentialHeader("basic", null, { username: "alice", password: "hunter2" })).toEqual({
      name: "Authorization",
      value: `Basic ${Buffer.from("alice:hunter2", "utf8").toString("base64")}`,
    });
  });

  it("encodes basic auth from UTF-8, so a non-ASCII password is not mangled", () => {
    const header = buildCredentialHeader("basic", null, { username: "josé", password: "pässwörd" });
    expect(Buffer.from(header.value.replace("Basic ", ""), "base64").toString("utf8")).toBe("josé:pässwörd");
  });

  it("refuses a value carrying CR, LF or NUL, which could append headers", () => {
    for (const hostile of ["abc\r\nX-Evil: 1", "abc\nX-Evil: 1", "abc\u0000"]) {
      expect(() => buildCredentialHeader("header", "X-Api-Key", { value: hostile })).toThrow(CredentialUnavailableError);
    }
    expect(() => buildCredentialHeader("bearer", null, { token: "tok\r\nX-Evil: 1" })).toThrow(
      CredentialUnavailableError,
    );
  });

  it("refuses a reserved header even when a stored row somehow holds one", () => {
    // Re-checked at use: the row was validated under a possibly older list.
    expect(() => buildCredentialHeader("header", "Host", { value: "abc" })).toThrow(CredentialUnavailableError);
    expect(() => buildCredentialHeader("header", "", { value: "abc" })).toThrow(CredentialUnavailableError);
  });

  it("refuses an incomplete envelope rather than sending a half-built header", () => {
    expect(() => buildCredentialHeader("bearer", null, {})).toThrow(CredentialUnavailableError);
    expect(() => buildCredentialHeader("basic", null, { username: "alice" })).toThrow(CredentialUnavailableError);
    expect(() => buildCredentialHeader("header", "X-Api-Key", {})).toThrow(CredentialUnavailableError);
  });

  it("never puts the value in the message it throws", () => {
    try {
      buildCredentialHeader("header", "X-Api-Key", { value: "super-secret\r\n" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret");
    }
  });
});

describe("credentialHeaderName", () => {
  it("ignores a stray header name on a kind that names its own header", () => {
    expect(credentialHeaderName("bearer", "X-Ignored")).toBe("Authorization");
    expect(credentialHeaderName("basic", "X-Ignored")).toBe("Authorization");
    expect(credentialHeaderName("header", "X-Api-Key")).toBe("X-Api-Key");
  });
});

describe("parseCredentialFilters", () => {
  it("drops an unknown type and normalizes the page", () => {
    expect(parseCredentialFilters({ type: "oauth", page: "0" })).toMatchObject({ type: undefined, page: 1 });
    expect(parseCredentialFilters({ type: "basic", page: "3" })).toMatchObject({ type: "basic", page: 3 });
    expect(parseCredentialFilters({ type: ["bearer"] })).toMatchObject({ type: "bearer" });
  });

  it("trims a blank search to undefined so it does not become a query key", () => {
    expect(parseCredentialFilters({ search: "   " }).search).toBeUndefined();
    expect(parseCredentialFilters({ search: "  stripe " }).search).toBe("stripe");
  });
});

describe("the form shape mirrors the schema", () => {
  it("declares exactly the fields credentialSchemaFor produces", () => {
    // `credential-dialog.tsx` casts a per-submit schema to
    // `Resolver<CredentialFormValues>`. That cast is only sound while these two
    // agree, so the agreement is asserted rather than assumed.
    const parsed = credentialSchemaFor("basic", { secretsRequired: true }).safeParse({
      name: "Acme",
      headerName: "",
      secrets: { username: "alice", password: "hunter2" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // A compile-time assertion as much as a runtime one: this assignment fails
    // to typecheck if the schema's output stops matching the form type.
    const fromSchema: CredentialFormValues = { ...parsed.data, type: "basic" };
    expect(Object.keys(fromSchema).sort()).toEqual(["headerName", "name", "secrets", "type"]);
    expect(fromSchema.type).toBe("basic");
  });

  it("keeps every kind's secret fields non-empty and uniquely keyed", () => {
    for (const type of CREDENTIAL_TYPES) {
      const keys = CREDENTIAL_TYPE_META[type].secretFields.map((field) => field.key);
      expect(keys.length, `${type} declares no secret fields`).toBeGreaterThan(0);
      expect(new Set(keys).size, `${type} repeats a field key`).toBe(keys.length);
    }
  });
});
