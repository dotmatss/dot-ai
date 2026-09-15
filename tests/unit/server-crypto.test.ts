// @vitest-environment node
/**
 * `secretsMatch` moved out of the integrations secret box when API key
 * authentication moved to `src/features/developer/`: its only caller went with
 * it, and a generic security primitive that two features could need belongs to
 * neither. These cases came with it.
 */
import { describe, expect, it } from "vitest";

import { secretsMatch } from "@/server/crypto";

describe("secretsMatch", () => {
  it("compares equal values", () => {
    expect(secretsMatch("a".repeat(64), "a".repeat(64))).toBe(true);
  });

  it("rejects different values of the same length without throwing", () => {
    expect(secretsMatch("a".repeat(64), `b${"a".repeat(63)}`)).toBe(false);
  });

  it("rejects different lengths instead of throwing", () => {
    expect(secretsMatch("short", "much-longer-value")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });
});
