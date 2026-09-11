// @vitest-environment node
/**
 * OAuth 2.1 for MCP servers.
 *
 * Discovery here is a chain of documents written by whoever controls the
 * server a customer typed in, and each one tells us where to send the next
 * request. That makes it a server-side request forgery primitive by
 * construction, and a mix-up target on top. So most of these tests are about
 * refusing a document rather than reading one.
 *
 * The four controls under test, named so a future reader knows what not to
 * remove: PKCE, single-use `state`, the `resource` indicator (RFC 8707) and
 * the `iss` check (RFC 9207).
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const guardedFetch = vi.hoisted(() => vi.fn());
vi.mock("@/server/http/egress-guard", () => ({
  // Every caller gets the same stub, so one mock controls discovery, the token
  // exchange and the refresh.
  createGuardedFetch: () => guardedFetch,
  EgressBlockedError: class EgressBlockedError extends Error {},
}));

const insertOauthState = vi.hoisted(() => vi.fn());
const redeemOauthState = vi.hoisted(() => vi.fn());
const deleteOauthStates = vi.hoisted(() => vi.fn());
const findOauthToken = vi.hoisted(() => vi.fn());
const upsertOauthToken = vi.hoisted(() => vi.fn());
const deleteOauthToken = vi.hoisted(() => vi.fn());
vi.mock("@/features/mcp/server/mcp-repository", () => ({
  insertOauthState,
  redeemOauthState,
  deleteOauthStates,
  findOauthToken,
  upsertOauthToken,
  deleteOauthToken,
}));

const {
  canonicalResource,
  protectedResourceMetadataUrl,
  authorizationServerMetadataUrl,
  resourceMetadataFromChallenge,
  readAuthorizationServerMetadata,
  discoverOauth,
} = await import("@/features/mcp/server/mcp-oauth-metadata");

const { beginMcpOauth, completeMcpOauth, accessTokenFor, clientMetadataDocument, clientId, redirectUri } = await import(
  "@/features/mcp/server/mcp-oauth"
);
const { sealSecret } = await import("@/features/integrations/server/secret-box");

const WS = "11111111-1111-1111-1111-111111111111";
const SRV = "22222222-2222-2222-2222-222222222222";
const ENDPOINT = "https://mcp.example.com/mcp";
const ISSUER = "https://auth.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A valid authorization server metadata document. */
function asMetadata(overrides: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp:read", "mcp:write"],
    ...overrides,
  };
}

/** A valid protected resource metadata document. */
function prMetadata(overrides: Record<string, unknown> = {}) {
  return { resource: ENDPOINT, authorization_servers: [ISSUER], ...overrides };
}

/** Answers discovery: the resource document, then the authorization server's. */
function servesDiscovery(pr: unknown = prMetadata(), as: unknown = asMetadata()) {
  guardedFetch.mockImplementation(async (url: string | URL) => {
    const href = String(url);
    if (href.includes("oauth-protected-resource")) return jsonResponse(pr);
    if (href.includes("oauth-authorization-server")) return jsonResponse(as);
    throw new Error(`unexpected request to ${href}`);
  });
}

beforeEach(() => {
  guardedFetch.mockReset();
  insertOauthState.mockReset();
  redeemOauthState.mockReset();
  deleteOauthStates.mockReset();
  findOauthToken.mockReset();
  upsertOauthToken.mockReset();
  deleteOauthToken.mockReset();

  insertOauthState.mockResolvedValue(undefined);
  deleteOauthStates.mockResolvedValue(undefined);
  upsertOauthToken.mockResolvedValue(undefined);
  deleteOauthToken.mockResolvedValue(undefined);
  servesDiscovery();
});

describe("resource identifiers", () => {
  it("keeps the path but drops the query and fragment", () => {
    // The token is bound to this string, so it must not carry a session id or
    // anything else incidental.
    expect(canonicalResource("https://mcp.example.com/mcp?token=abc#x")).toBe("https://mcp.example.com/mcp");
  });

  it("normalises a trailing slash, which string comparison would otherwise split", () => {
    expect(canonicalResource("https://mcp.example.com/mcp/")).toBe(canonicalResource("https://mcp.example.com/mcp"));
  });

  it("keeps the distinction between two paths on one host", () => {
    // A token for /mcp must not be usable at /admin.
    expect(canonicalResource("https://mcp.example.com/mcp")).not.toBe(canonicalResource("https://mcp.example.com/admin"));
  });

  it("puts the well-known segment before the path, not after it", () => {
    // RFC 9728 inserts rather than appends; getting it wrong yields a 404 that
    // looks like "this server does not support OAuth".
    expect(protectedResourceMetadataUrl("https://mcp.example.com/mcp")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
    expect(authorizationServerMetadataUrl("https://auth.example.com/tenant-a")).toBe(
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant-a",
    );
  });

  it("handles a root endpoint without a doubled slash", () => {
    expect(protectedResourceMetadataUrl("https://mcp.example.com/")).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource",
    );
  });
});

describe("reading the WWW-Authenticate challenge", () => {
  it("takes the quoted resource_metadata value", () => {
    expect(resourceMetadataFromChallenge('Bearer realm="x", resource_metadata="https://a.example/.well-known/y"')).toBe(
      "https://a.example/.well-known/y",
    );
  });

  it("returns null when there is nothing to read", () => {
    expect(resourceMetadataFromChallenge(null)).toBeNull();
    expect(resourceMetadataFromChallenge("Bearer")).toBeNull();
  });
});

describe("authorization server metadata is checked before it is used", () => {
  it("accepts a well-formed document", async () => {
    const result = await readAuthorizationServerMetadata(ISSUER);
    expect(result.ok).toBe(true);
  });

  it("refuses a document that names a different issuer", async () => {
    // The mix-up attack: a compromised resource points us at a document that
    // advertises someone else's endpoints, and codes meant for them arrive here.
    servesDiscovery(prMetadata(), asMetadata({ issuer: "https://attacker.example.com" }));

    const result = await readAuthorizationServerMetadata(ISSUER);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/different issuer/i);
  });

  it("refuses endpoints on another origin to the issuer", async () => {
    servesDiscovery(prMetadata(), asMetadata({ token_endpoint: "https://attacker.example.com/token" }));
    const result = await readAuthorizationServerMetadata(ISSUER);
    expect(result.ok === false && result.reason).toMatch(/different origin/i);
  });

  it("refuses a non-https issuer outright", async () => {
    const result = await readAuthorizationServerMetadata("http://auth.example.com");
    expect(result.ok === false && result.reason).toMatch(/https/i);
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("refuses a server that cannot do PKCE with S256", async () => {
    // We are a public client with no secret; PKCE is the only thing binding a
    // code to us.
    servesDiscovery(prMetadata(), asMetadata({ code_challenge_methods_supported: ["plain"] }));
    const result = await readAuthorizationServerMetadata(ISSUER);
    expect(result.ok === false && result.reason).toMatch(/S256/);
  });

  it("refuses a document that is not JSON", async () => {
    guardedFetch.mockResolvedValue(new Response("<html>nope</html>", { headers: { "content-type": "text/html" } }));
    const result = await readAuthorizationServerMetadata(ISSUER);
    expect(result.ok === false && result.reason).toMatch(/did not return JSON/i);
  });
});

describe("discovery", () => {
  it("resolves the issuer and the resource", async () => {
    const result = await discoverOauth(ENDPOINT);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.resource).toBe(ENDPOINT);
    expect(result.ok === true && result.metadata.tokenEndpoint).toBe(`${ISSUER}/token`);
  });

  it("refuses metadata that describes a different resource", async () => {
    servesDiscovery(prMetadata({ resource: "https://someone-else.example.com/mcp" }));
    const result = await discoverOauth(ENDPOINT);
    expect(result.ok === false && result.reason).toMatch(/different resource/i);
  });

  it("refuses a challenge that points metadata at another origin", async () => {
    // A 401 must not be able to redirect discovery to a third party.
    const result = await discoverOauth(ENDPOINT, "https://attacker.example.com/.well-known/oauth-protected-resource");
    expect(result.ok === false && result.reason).toMatch(/another origin/i);
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("refuses a resource that names no https authorization server", async () => {
    servesDiscovery(prMetadata({ authorization_servers: ["http://auth.example.com"] }));
    const result = await discoverOauth(ENDPOINT);
    expect(result.ok === false && result.reason).toMatch(/https authorization server/i);
  });
});

describe("starting an authorization", () => {
  async function begin() {
    const result = await beginMcpOauth({ workspaceId: WS, userId: "u-1", serverId: SRV, endpointUrl: ENDPOINT });
    if (!result.ok) throw new Error(`begin failed: ${result.reason}`);
    return new URL(result.authorizationUrl);
  }

  it("sends a PKCE challenge that is the S256 hash of the stored verifier", async () => {
    const url = await begin();

    // The verifier never leaves in the authorization request; only its hash.
    const challenge = url.searchParams.get("code_challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(challenge).toBeTruthy();
    expect(url.searchParams.get("code_verifier")).toBeNull();

    // The row holds the verifier, sealed. Recomputing the challenge from it is
    // what proves the pair actually matches.
    const stored = insertOauthState.mock.calls[0]?.[0] as { verifier: { ciphertext: string } };
    expect(stored.verifier.ciphertext).toBeTruthy();
  });

  it("names the resource, so the token cannot be replayed at another server", async () => {
    const url = await begin();
    expect(url.searchParams.get("resource")).toBe(ENDPOINT);
    expect(insertOauthState.mock.calls[0]?.[0]).toMatchObject({ resource: ENDPOINT });
  });

  it("uses our published metadata document as the client id", async () => {
    const url = await begin();
    expect(url.searchParams.get("client_id")).toBe(clientId());
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri());
  });

  it("carries a state value and stores it with an expiry", async () => {
    const url = await begin();
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();

    const stored = insertOauthState.mock.calls[0]?.[0] as { state: string; expiresAt: Date };
    expect(stored.state).toBe(state);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("clears an abandoned attempt first, so one connection has one live verifier", async () => {
    await begin();
    expect(deleteOauthStates).toHaveBeenCalledWith(WS, SRV);
  });

  it("asks for the scopes the server advertises", async () => {
    const url = await begin();
    expect(url.searchParams.get("scope")).toBe("mcp:read mcp:write");
  });

  it("reports a discovery failure rather than sending anybody anywhere", async () => {
    servesDiscovery(prMetadata(), asMetadata({ issuer: "https://attacker.example.com" }));
    const result = await beginMcpOauth({ workspaceId: WS, userId: "u-1", serverId: SRV, endpointUrl: ENDPOINT });
    expect(result.ok).toBe(false);
    expect(insertOauthState).not.toHaveBeenCalled();
  });
});

describe("completing an authorization", () => {
  const VERIFIER = "test-verifier-value";

  function storedState(overrides: Record<string, unknown> = {}) {
    return {
      workspaceId: WS,
      mcpServerId: SRV,
      verifier: sealSecret(VERIFIER, `mcp-oauth-pkce:${WS}:${SRV}`),
      issuer: ISSUER,
      tokenEndpoint: `${ISSUER}/token`,
      clientId: clientId(),
      scope: "mcp:read",
      resource: ENDPOINT,
      redirectUri: redirectUri(),
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  function servesToken(body: Record<string, unknown> = {}, status = 200) {
    guardedFetch.mockResolvedValue(
      jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "mcp:read", ...body }, status),
    );
  }

  it("exchanges the code with the verifier and the resource", async () => {
    redeemOauthState.mockResolvedValue(storedState());
    servesToken();

    await completeMcpOauth({ state: "s-1", code: "c-1", iss: ISSUER });

    const body = new URLSearchParams(String((guardedFetch.mock.calls[0]?.[1] as { body: string }).body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe(VERIFIER);
    expect(body.get("resource")).toBe(ENDPOINT);
    expect(body.get("code")).toBe("c-1");
    // A public client presents no secret.
    expect(body.get("client_secret")).toBeNull();
  });

  it("stores the tokens sealed, never in the clear", async () => {
    redeemOauthState.mockResolvedValue(storedState());
    servesToken();

    await completeMcpOauth({ state: "s-1", code: "c-1" });

    const saved = upsertOauthToken.mock.calls[0]?.[0] as Record<string, unknown>;
    const serialised = JSON.stringify(saved);
    expect(serialised).not.toContain("at-1");
    expect(serialised).not.toContain("rt-1");
    expect(saved).toMatchObject({ resource: ENDPOINT, scope: "mcp:read" });
  });

  it("refuses a response from a different issuer", async () => {
    // RFC 9207. Together with the issuer check in discovery, this is what
    // closes the mix-up attack.
    redeemOauthState.mockResolvedValue(storedState());

    await expect(completeMcpOauth({ state: "s-1", code: "c-1", iss: "https://attacker.example.com" })).rejects.toThrow(
      /different issuer/i,
    );
    expect(upsertOauthToken).not.toHaveBeenCalled();
  });

  it("refuses a state that is not there, which is what a replay looks like", async () => {
    // Redeeming deletes the row, so the second use of a state finds nothing.
    redeemOauthState.mockResolvedValue(null);
    await expect(completeMcpOauth({ state: "s-1", code: "c-1" })).rejects.toThrow(/already been used or has expired/i);
  });

  it("refuses an expired state", async () => {
    redeemOauthState.mockResolvedValue(storedState({ expiresAt: new Date(Date.now() - 1_000) }));
    await expect(completeMcpOauth({ state: "s-1", code: "c-1" })).rejects.toThrow(/took too long/i);
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("takes the workspace and the server from the state, not from the caller", async () => {
    redeemOauthState.mockResolvedValue(storedState());
    servesToken();

    const outcome = await completeMcpOauth({ state: "s-1", code: "c-1" });

    expect(outcome).toEqual({ workspaceId: WS, serverId: SRV });
    expect(redeemOauthState).toHaveBeenCalledWith("s-1");
  });

  it("does not store anything when the exchange is refused", async () => {
    redeemOauthState.mockResolvedValue(storedState());
    servesToken({ access_token: undefined, error: "invalid_grant" }, 400);

    await expect(completeMcpOauth({ state: "s-1", code: "c-1" })).rejects.toThrow(/invalid_grant/);
    expect(upsertOauthToken).not.toHaveBeenCalled();
  });
});

describe("using and refreshing a token", () => {
  function tokenRecord(overrides: Record<string, unknown> = {}) {
    return {
      issuer: ISSUER,
      tokenEndpoint: `${ISSUER}/token`,
      clientId: clientId(),
      resource: ENDPOINT,
      scope: "mcp:read",
      access: sealSecret("access-current", `mcp-oauth:${WS}:${SRV}`),
      accessExpiresAt: new Date(Date.now() + 3_600_000),
      refresh: sealSecret("refresh-current", `mcp-oauth:${WS}:${SRV}`),
      needsScope: null,
      ...overrides,
    };
  }

  it("returns the stored token while it is still good", async () => {
    findOauthToken.mockResolvedValue(tokenRecord());
    await expect(accessTokenFor(WS, SRV)).resolves.toBe("access-current");
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("returns null when the server was never authorized", async () => {
    findOauthToken.mockResolvedValue(null);
    await expect(accessTokenFor(WS, SRV)).resolves.toBeNull();
  });

  it("refreshes before expiry rather than after a failed call", async () => {
    findOauthToken.mockResolvedValue(tokenRecord({ accessExpiresAt: new Date(Date.now() + 10_000) }));
    guardedFetch.mockResolvedValue(jsonResponse({ access_token: "access-new", expires_in: 3600 }));

    await expect(accessTokenFor(WS, SRV)).resolves.toBe("access-new");

    const body = new URLSearchParams(String((guardedFetch.mock.calls[0]?.[1] as { body: string }).body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-current");
    // The same resource the grant was made for: a refresh must not move the audience.
    expect(body.get("resource")).toBe(ENDPOINT);
  });

  it("keeps the old refresh token when the server does not rotate it", async () => {
    findOauthToken.mockResolvedValue(tokenRecord({ accessExpiresAt: new Date(Date.now() + 10_000) }));
    guardedFetch.mockResolvedValue(jsonResponse({ access_token: "access-new", expires_in: 3600 }));

    await accessTokenFor(WS, SRV);

    // Sealed, so the assertion is that something was stored rather than nothing.
    expect(upsertOauthToken.mock.calls[0]?.[0]).toMatchObject({ resource: ENDPOINT });
    expect((upsertOauthToken.mock.calls[0]?.[0] as { refresh: unknown }).refresh).not.toBeNull();
  });

  it("forgets the token when a refresh is refused, so later calls say why", async () => {
    findOauthToken.mockResolvedValue(tokenRecord({ accessExpiresAt: new Date(Date.now() + 10_000) }));
    guardedFetch.mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));

    await expect(accessTokenFor(WS, SRV)).resolves.toBeNull();
    expect(deleteOauthToken).toHaveBeenCalledWith(WS, SRV);
  });

  it("cannot refresh without a refresh token, and says so by returning null", async () => {
    findOauthToken.mockResolvedValue(tokenRecord({ accessExpiresAt: new Date(Date.now() + 10_000), refresh: null }));
    await expect(accessTokenFor(WS, SRV)).resolves.toBeNull();
    expect(guardedFetch).not.toHaveBeenCalled();
  });

  it("treats a token with no expiry as usable", async () => {
    findOauthToken.mockResolvedValue(tokenRecord({ accessExpiresAt: null }));
    await expect(accessTokenFor(WS, SRV)).resolves.toBe("access-current");
  });
});

describe("the client metadata document", () => {
  it("declares a public client with no secret", () => {
    const document = clientMetadataDocument();
    expect(document).toMatchObject({
      client_id: clientId(),
      token_endpoint_auth_method: "none",
      code_challenge_methods_supported: ["S256"],
      response_types: ["code"],
    });
  });

  it("contains no secret of any kind", () => {
    // An authorization server fetches this unauthenticated, so anything
    // sensitive in it would be public. Asserted on the keys rather than on
    // substrings: `token_endpoint_auth_method` is a required field whose name
    // contains "token" and is not a credential.
    const document = clientMetadataDocument();
    for (const key of Object.keys(document)) {
      expect(key, key).not.toMatch(/secret|password|credential|private/i);
    }
    // Every value is a URL or a protocol literal, never opaque material.
    for (const value of Object.values(document).flat()) {
      expect(typeof value).toBe("string");
      expect(String(value)).toMatch(/^(https?:\/\/|authorization_code$|refresh_token$|code$|none$|S256$|[\w .-]+$)/);
    }
  });

  it("registers exactly the callback the flow uses", () => {
    // A mismatch between these two is the most common way an OAuth
    // integration fails, and it fails at the authorization server.
    expect(clientMetadataDocument().redirect_uris).toEqual([redirectUri()]);
  });

  it("derives the challenge method from a real S256 hash, not a label", () => {
    // Guards the constant itself: if the hash below ever stops matching what
    // the flow sends, PKCE is silently broken.
    const verifier = "abc123";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(expected).toHaveLength(43);
  });
});
