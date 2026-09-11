// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { mintEmbedToken, verifyEmbedToken } from "@/features/embed/server/embed-token";

const ORIGIN = "https://www.customer.example";

afterEach(() => {
  vi.useRealTimers();
});

describe("embed tokens", () => {
  it("round-trips the widget session it was minted for", () => {
    const token = mintEmbedToken({ embedKey: "cb_abc123", origin: ORIGIN, preview: false });
    const payload = verifyEmbedToken(token);

    expect(payload).not.toBeNull();
    expect(payload?.embedKey).toBe("cb_abc123");
    expect(payload?.origin).toBe(ORIGIN);
    expect(payload?.preview).toBe(false);
    expect(payload?.exp).toBeGreaterThan(Date.now());
  });

  it("carries only the widget session facts, never a secret", () => {
    const token = mintEmbedToken({ embedKey: "cb_abc123", origin: ORIGIN, preview: true });
    const [encoded] = token.split(".");
    // The payload is signed, not encrypted, so it must stay non-sensitive.
    const decoded = JSON.parse(Buffer.from(encoded ?? "", "base64url").toString("utf8"));
    expect(Object.keys(decoded).sort()).toEqual(["embedKey", "exp", "origin", "preview"]);
  });

  it("rejects a tampered payload", () => {
    const token = mintEmbedToken({ embedKey: "cb_abc123", origin: ORIGIN, preview: false });
    const [, signature] = token.split(".");

    // Re-point the token at another origin while keeping the old signature.
    const forgedPayload = Buffer.from(
      JSON.stringify({ embedKey: "cb_abc123", origin: "https://evil.example", preview: false, exp: Date.now() + 60_000 }),
    ).toString("base64url");

    expect(verifyEmbedToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a tampered signature and malformed input", () => {
    const token = mintEmbedToken({ embedKey: "cb_abc123", origin: ORIGIN, preview: false });
    const [encoded, signature] = token.split(".");

    expect(verifyEmbedToken(`${encoded}.${(signature ?? "").slice(0, -2)}xx`)).toBeNull();
    expect(verifyEmbedToken(`${encoded}.`)).toBeNull();
    expect(verifyEmbedToken(encoded ?? "")).toBeNull();
    expect(verifyEmbedToken("...")).toBeNull();
    expect(verifyEmbedToken("")).toBeNull();
    expect(verifyEmbedToken(undefined)).toBeNull();
    expect(verifyEmbedToken(null)).toBeNull();
  });

  it("expires so a leaked token cannot be replayed forever", () => {
    const token = mintEmbedToken({ embedKey: "cb_abc123", origin: ORIGIN, preview: false });
    expect(verifyEmbedToken(token)).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(verifyEmbedToken(token)).toBeNull();
  });

  it("distinguishes a preview session from a visitor session", () => {
    const preview = verifyEmbedToken(mintEmbedToken({ embedKey: "cb_x", origin: ORIGIN, preview: true }));
    const visitor = verifyEmbedToken(mintEmbedToken({ embedKey: "cb_x", origin: ORIGIN, preview: false }));

    // The public chat route relies on this flag to allow members to test an
    // inactive chatbot without opening it to the internet.
    expect(preview?.preview).toBe(true);
    expect(visitor?.preview).toBe(false);
  });
});
