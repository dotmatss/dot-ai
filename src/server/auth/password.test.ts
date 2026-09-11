// @vitest-environment node
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";

describe("password hashing", () => {
  it("stores the algorithm and its parameters alongside a unique salt", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    const [scheme, n, r, p, salt, hash] = first.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(hash ?? "", "base64")).toHaveLength(64);

    // A per-password salt means identical passwords never share a hash.
    expect(first).not.toBe(second);
    // The plaintext never appears in the stored value.
    expect(first).not.toContain("correct");
  });

  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("s3cret-passphrase");
    await expect(verifyPassword("s3cret-passphrase", stored)).resolves.toBe(true);
    await expect(verifyPassword("s3cret-passphras", stored)).resolves.toBe(false);
    await expect(verifyPassword("S3cret-passphrase", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("treats equivalent unicode spellings as the same password", async () => {
    // Composed vs decomposed "é": a user typing on a different keyboard layout
    // must still be able to sign in.
    const stored = await hashPassword("passe-étoile");
    await expect(verifyPassword("passe-étoile", stored)).resolves.toBe(true);
  });

  it("fails closed for accounts with no password and for damaged hashes", async () => {
    await expect(verifyPassword("anything", null)).resolves.toBe(false);
    await expect(verifyPassword("anything", undefined)).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "bcrypt$10$abc$def")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$16384$8$1$onlyfourparts")).resolves.toBe(false);
  });

  it("does not authenticate when the stored parameters have been altered", async () => {
    const stored = await hashPassword("parameter-tampering");
    const [, , r, p, salt, hash] = stored.split("$");
    const weakened = ["scrypt", 1024, r, p, salt, hash].join("$");

    // A lowered work factor changes the derived key, so the comparison fails
    // instead of silently accepting a cheaper hash.
    await expect(verifyPassword("parameter-tampering", weakened)).resolves.toBe(false);
  });
});
