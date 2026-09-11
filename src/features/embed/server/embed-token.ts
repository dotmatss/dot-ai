import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/config/env";

/**
 * Short-lived, signed token that binds a widget session to a chatbot and the
 * parent page origin that was validated when the iframe was served. The public
 * chat API requires it, so allowed-domain enforcement cannot be bypassed by
 * calling the API directly from elsewhere.
 */
export interface EmbedTokenPayload {
  embedKey: string;
  origin: string;
  /** True for workspace members previewing an inactive chatbot. */
  preview: boolean;
  exp: number;
}

const TOKEN_TTL_MS = 60 * 60 * 1000;

function secret(): string {
  return getServerEnv().APP_SECRET;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function mintEmbedToken(input: Omit<EmbedTokenPayload, "exp">): string {
  const payload: EmbedTokenPayload = { ...input, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyEmbedToken(token: string | undefined | null): EmbedTokenPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EmbedTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.embedKey !== "string" || typeof payload.origin !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
