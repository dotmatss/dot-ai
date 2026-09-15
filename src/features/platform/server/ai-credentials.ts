import "server-only";

import { openSecret, sealSecret, SecretDecryptionError, type SealedSecret } from "@/features/integrations/server/secret-box";

/**
 * Platform AI provider credentials.
 *
 * No second secret system: this reuses `secret-box`, the same AES-256-GCM
 * helper the integrations feature uses and the MCP feature already borrows.
 * What is local to the platform is the BINDING CONTEXT, exactly as
 * `mcp-oauth.ts` owns its own token and verifier contexts.
 *
 * ── Why the context matters ─────────────────────────────────────────────────
 *
 * The context is bound as additional authenticated data, so a ciphertext can
 * only be opened with the same context it was sealed under. A workspace
 * integration secret is sealed as `workspace:<id>:integration:<provider>`; a
 * platform provider key is sealed as `platform:ai-provider:<id>`. Neither can
 * be opened as the other, so a row copied - by a bug, a bad restore, or a
 * malicious write - between the customer plane and the platform plane fails to
 * decrypt instead of quietly working.
 *
 * ── The one-way rule ────────────────────────────────────────────────────────
 *
 * `openProviderCredential` exists for the day the gateway resolves providers
 * from this registry. It is deliberately NOT reachable from any read model,
 * API response type or UI component: no type in `ai-types.ts` has a field a key
 * could travel in, and `tests/unit/ai-registry.test.ts` asserts that the
 * repository never selects the ciphertext columns into a summary.
 */

/** Domain separation from every workspace-scoped secret. */
export function providerCredentialContext(providerId: string): string {
  if (!providerId) throw new Error("providerCredentialContext requires a provider id");
  return `platform:ai-provider:${providerId}`;
}

export function sealProviderCredential(apiKey: string, providerId: string): SealedSecret {
  return sealSecret(apiKey, providerCredentialContext(providerId));
}

/**
 * Opens a stored provider credential.
 *
 * Throws `SecretDecryptionError` on any tampering, wrong key or swapped
 * context. There is no best-effort path that returns a partial or empty key:
 * a provider that cannot be authenticated must fail loudly rather than send an
 * unauthenticated request upstream.
 */
export function openProviderCredential(sealed: SealedSecret, providerId: string): string {
  return openSecret(sealed, providerCredentialContext(providerId));
}

export { SecretDecryptionError };
export type { SealedSecret };
