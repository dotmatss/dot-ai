// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { apiKeyListQuerySchema, createApiKeySchema } from "@/features/integrations/schemas";
import { parseApiKeyFilters } from "@/features/integrations/filters";
import { API_KEY_PREFIX, API_KEY_RANDOM_LENGTH } from "@/features/integrations/constants";
import { apiKeyPrefixOf, bearerTokenFrom, generateApiKey, hashApiKey, looksLikeApiKey } from "@/features/integrations/server/api-key-token";

describe("generateApiKey", () => {
  it("produces dot_live_ plus 32 base64url characters", () => {
    const { secret } = generateApiKey();
    expect(secret.startsWith(API_KEY_PREFIX)).toBe(true);
    const random = secret.slice(API_KEY_PREFIX.length);
    expect(random).toHaveLength(API_KEY_RANDOM_LENGTH);
    // base64url: no +, / or = padding, so the key is safe in headers and logs.
    expect(random).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("is unique across calls", () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().secret));
    expect(keys.size).toBe(200);
  });

  it("returns the hash of the secret, never the secret itself, for storage", () => {
    const { secret, hash } = generateApiKey();
    expect(hash).toBe(createHash("sha256").update(secret, "utf8").digest("hex"));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(secret.slice(API_KEY_PREFIX.length));
  });

  it("derives a display prefix that reveals only a fragment of the key", () => {
    const { secret, prefix } = generateApiKey();
    expect(prefix).toBe(apiKeyPrefixOf(secret));
    expect(prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(prefix).toHaveLength(API_KEY_PREFIX.length + 6);
    // The stored prefix must not be enough to reconstruct the key.
    expect(prefix.length).toBeLessThan(secret.length);
    expect(secret.startsWith(prefix)).toBe(true);
  });
});

describe("hashApiKey", () => {
  it("is deterministic, so a presented key finds its row", () => {
    expect(hashApiKey("dot_live_abc")).toBe(hashApiKey("dot_live_abc"));
  });

  it("differs for keys that differ by one character", () => {
    expect(hashApiKey("dot_live_abc")).not.toBe(hashApiKey("dot_live_abd"));
  });
});

describe("looksLikeApiKey", () => {
  it("accepts a freshly generated key", () => {
    expect(looksLikeApiKey(generateApiKey().secret)).toBe(true);
  });

  it("rejects anything that is not this key format", () => {
    const random = generateApiKey().secret.slice(API_KEY_PREFIX.length);
    for (const value of [
      "",
      "dot_live_",
      "dot_test_" + random,
      random,
      `${API_KEY_PREFIX}${random.slice(0, 31)}`,
      `${API_KEY_PREFIX}${random}extra`,
      `${API_KEY_PREFIX}${"!".repeat(32)}`,
      `${API_KEY_PREFIX}${random.slice(0, 31)}=`,
      "Bearer dot_live_" + random,
    ]) {
      expect(looksLikeApiKey(value)).toBe(false);
    }
  });
});

describe("bearerTokenFrom", () => {
  it("extracts the token from a Bearer header, case-insensitively", () => {
    expect(bearerTokenFrom("Bearer dot_live_abc")).toBe("dot_live_abc");
    expect(bearerTokenFrom("bearer dot_live_abc")).toBe("dot_live_abc");
    expect(bearerTokenFrom("  Bearer   dot_live_abc  ")).toBe("dot_live_abc");
  });

  it("returns null for anything that is not a bearer credential", () => {
    for (const value of [null, "", "Bearer", "Bearer ", "Basic dXNlcjpwYXNz", "dot_live_abc", "Token dot_live_abc"]) {
      expect(bearerTokenFrom(value)).toBeNull();
    }
  });
});

describe("createApiKeySchema", () => {
  it("requires a recognisable name", () => {
    expect(createApiKeySchema.safeParse({ name: "Zapier production" }).success).toBe(true);
    expect(createApiKeySchema.safeParse({ name: " x " }).success).toBe(false);
    expect(createApiKeySchema.safeParse({ name: "a".repeat(61) }).success).toBe(false);
  });

  it("trims the name so display never depends on stray whitespace", () => {
    const parsed = createApiKeySchema.parse({ name: "  Billing service  " });
    expect(parsed.name).toBe("Billing service");
  });
});

describe("api key list filters", () => {
  it("defaults to the first page with no status filter", () => {
    expect(apiKeyListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseApiKeyFilters({})).toEqual({ status: undefined, page: 1, pageSize: 20 });
  });

  it("keeps only the statuses the UI offers", () => {
    expect(parseApiKeyFilters({ status: "revoked" }).status).toBe("revoked");
    expect(parseApiKeyFilters({ status: "active" }).status).toBe("active");
    expect(parseApiKeyFilters({ status: "everything" }).status).toBeUndefined();
    expect(apiKeyListQuerySchema.safeParse({ status: "everything" }).success).toBe(false);
  });

  it("normalizes hostile page values rather than trusting them", () => {
    expect(parseApiKeyFilters({ page: "-3" }).page).toBe(1);
    expect(parseApiKeyFilters({ page: "abc" }).page).toBe(1);
    expect(parseApiKeyFilters({ page: "2.7" }).page).toBe(2);
    expect(parseApiKeyFilters({ page: ["4", "9"] }).page).toBe(4);
  });

  it("rejects a page size beyond the API maximum", () => {
    expect(apiKeyListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
  });
});
