import { CREDENTIAL_RESERVED_HEADERS, credentialHeaderName } from "@/features/integrations/constants";
import type { CredentialType } from "@/features/integrations/types";

/**
 * Turning a credential's stored fields into one request header.
 *
 * A leaf module with no database and no `server-only`, deliberately: this is
 * the security-critical half of the credential path - which header, built how,
 * and refused when - and it should be provable by a unit test rather than only
 * reachable through a repository. `credential-resolver.ts` does the decryption
 * and calls this; nothing else should call either.
 *
 * Everything here operates on plaintext secret material. Nothing in this file
 * writes to a log, and nothing it throws contains a value.
 */

export class CredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialUnavailableError";
  }
}

export interface CredentialHeader {
  name: string;
  value: string;
}

const INCOMPLETE = "The stored credential is incomplete. Re-enter it and try again.";

/**
 * A header value may not contain CR, LF or NUL.
 *
 * `fetch` would reject these itself, but the check belongs here: it makes the
 * refusal a named, testable condition rather than a driver error, and a stored
 * secret is the one input to a request an operator can paste newlines into.
 * A value that could carry a newline could append headers of its own.
 */
function assertHeaderSafe(value: string): void {
  if (/[\r\n\0]/.test(value)) {
    throw new CredentialUnavailableError("The stored credential contains characters that cannot be sent in a header.");
  }
}

function valueFor(type: CredentialType, secrets: Record<string, string>): string {
  switch (type) {
    case "bearer": {
      const token = secrets.token ?? "";
      if (!token) throw new CredentialUnavailableError(INCOMPLETE);
      return `Bearer ${token}`;
    }
    case "basic": {
      const username = secrets.username ?? "";
      const password = secrets.password ?? "";
      if (!username || !password) throw new CredentialUnavailableError(INCOMPLETE);
      // Encoded from UTF-8 rather than latin1: RFC 7617 allows a non-ASCII
      // password, and silently mangling one would look like a wrong password.
      return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
    }
    case "header": {
      const value = secrets.value ?? "";
      if (!value) throw new CredentialUnavailableError(INCOMPLETE);
      return value;
    }
  }
}

/**
 * Builds the header a credential sets, or throws `CredentialUnavailableError`
 * with a message safe to show an operator.
 *
 * The header name is re-checked here rather than trusted from the row: the
 * validation that put it there ran at a different time, under a different
 * version of the reserved list.
 */
export function buildCredentialHeader(
  type: CredentialType,
  headerName: string | null,
  secrets: Record<string, string>,
): CredentialHeader {
  const name = credentialHeaderName(type, headerName);
  if (!name || CREDENTIAL_RESERVED_HEADERS.includes(name.toLowerCase())) {
    throw new CredentialUnavailableError("This credential is configured with a header that cannot be set.");
  }
  const value = valueFor(type, secrets);
  assertHeaderSafe(value);
  return { name, value };
}
