// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  openSecret,
  openSecretMap,
  SecretDecryptionError,
  sealSecret,
  sealSecretMap,
  secretContext,
  secretsMatch,
} from "@/features/integrations/server/secret-box";

const CONTEXT = secretContext("11111111-1111-1111-1111-111111111111", "webhook");
const OTHER_CONTEXT = secretContext("22222222-2222-2222-2222-222222222222", "webhook");

function flipFirstCharacter(value: string): string {
  const first = value[0] ?? "A";
  const replacement = first === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

describe("sealSecret / openSecret", () => {
  it("round-trips a secret", () => {
    const sealed = sealSecret("shhh-super-secret", CONTEXT);
    expect(openSecret(sealed, CONTEXT)).toBe("shhh-super-secret");
  });

  it("never stores the plaintext in the envelope", () => {
    const sealed = sealSecret("hunter2-plaintext", CONTEXT);
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain("hunter2");
    expect(sealed.ciphertext).not.toContain("hunter2");
  });

  it("uses a fresh IV every time, so identical plaintexts do not look identical", () => {
    const a = sealSecret("same-value", CONTEXT);
    const b = sealSecret("same-value", CONTEXT);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("round-trips unicode and long values", () => {
    const value = `${"x".repeat(2000)}-héllo-🔐`;
    expect(openSecret(sealSecret(value, CONTEXT), CONTEXT)).toBe(value);
  });

  it("round-trips an empty string", () => {
    expect(openSecret(sealSecret("", CONTEXT), CONTEXT)).toBe("");
  });
});

describe("tamper detection", () => {
  it("rejects modified ciphertext", () => {
    const sealed = sealSecret("shhh", CONTEXT);
    expect(() => openSecret({ ...sealed, ciphertext: flipFirstCharacter(sealed.ciphertext) }, CONTEXT)).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects a modified authentication tag", () => {
    const sealed = sealSecret("shhh", CONTEXT);
    expect(() => openSecret({ ...sealed, tag: flipFirstCharacter(sealed.tag) }, CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("rejects a modified IV", () => {
    const sealed = sealSecret("shhh", CONTEXT);
    expect(() => openSecret({ ...sealed, iv: flipFirstCharacter(sealed.iv) }, CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("rejects a truncated IV or tag instead of throwing a driver error", () => {
    const sealed = sealSecret("shhh", CONTEXT);
    expect(() => openSecret({ ...sealed, iv: "AAAA" }, CONTEXT)).toThrow(SecretDecryptionError);
    expect(() => openSecret({ ...sealed, tag: "AAAA" }, CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("rejects an envelope moved to another workspace", () => {
    // The binding context is authenticated data: a row copied between tenants
    // fails to open rather than silently decrypting.
    const sealed = sealSecret("shhh", CONTEXT);
    expect(() => openSecret(sealed, OTHER_CONTEXT)).toThrow(SecretDecryptionError);
  });

  it("never leaks plaintext or ciphertext in the failure message", () => {
    const sealed = sealSecret("top-secret-value", CONTEXT);
    try {
      openSecret(sealed, OTHER_CONTEXT);
      expect.unreachable("decryption should have failed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("top-secret-value");
      expect(message).not.toContain(sealed.ciphertext);
    }
  });

  it("requires a binding context on both sides", () => {
    expect(() => sealSecret("shhh", "")).toThrow();
    expect(() => openSecret(sealSecret("shhh", CONTEXT), "")).toThrow();
  });
});

describe("sealSecretMap", () => {
  it("round-trips a map of named secrets", () => {
    const secrets = { signingSecret: "abc123", webhookUrl: "https://hooks.example.com/x" };
    expect(openSecretMap(sealSecretMap(secrets, CONTEXT), CONTEXT)).toEqual(secrets);
  });

  it("round-trips an empty map", () => {
    expect(openSecretMap(sealSecretMap({}, CONTEXT), CONTEXT)).toEqual({});
  });

  it("fails loudly when the envelope is tampered with", () => {
    const sealed = sealSecretMap({ password: "p" }, CONTEXT);
    expect(() => openSecretMap({ ...sealed, ciphertext: flipFirstCharacter(sealed.ciphertext) }, CONTEXT)).toThrow(
      SecretDecryptionError,
    );
  });
});

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
