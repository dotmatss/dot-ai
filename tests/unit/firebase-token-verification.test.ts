// @vitest-environment node
/**
 * The trust boundary, exercised against tokens this test signs itself.
 *
 * `verifyFirebaseIdToken` is the single place that decides whether a caller is
 * who Firebase says they are, so a defect here is not a bug in a feature - it
 * is an authentication bypass for the whole application. That is why these
 * cases are mostly negative: proving a good token passes is one assertion, and
 * proving every BAD one fails is the actual test.
 *
 * The keys are real RSA keys generated per run and the tokens are really
 * signed, so the signature check is genuinely exercised rather than mocked out.
 * Only the network is stubbed - `fetch` returns our public key where Google's
 * JWKS endpoint would be - which is also what lets the tampering cases prove
 * something: a token this file signs with a DIFFERENT key must fail, and does.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FirebaseNotConfiguredError,
  FirebaseTokenError,
  firebaseIdTokenFrom,
  resetFirebaseKeyCacheForTests,
  verifyFirebaseIdToken,
} from "@/server/auth/firebase/verify-id-token";

const PROJECT_ID = "dot-test-project";
const KID = "test-key-1";

let signingKey: CryptoKey;
let publicJwk: JsonWebKey;
/** A second, unrelated key pair, for the "signed by somebody else" case. */
let impostorKey: CryptoKey;

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSegment(value: object): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

interface TokenOptions {
  claims?: Record<string, unknown>;
  header?: Record<string, unknown>;
  key?: CryptoKey;
}

/** A token that is valid unless a case deliberately breaks one thing. */
async function mintToken({ claims = {}, header = {}, key }: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now - 10,
    user_id: "firebase-uid-1",
    sub: "firebase-uid-1",
    iat: now - 10,
    exp: now + 3600,
    email: "person@rajahx.com",
    email_verified: true,
    firebase: { identities: { email: ["person@rajahx.com"] }, sign_in_provider: "password" },
    ...claims,
  };
  const headerSegment = encodeSegment({ alg: "RS256", kid: KID, typ: "JWT", ...header });
  const payloadSegment = encodeSegment(payload);
  const data = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = await crypto.subtle.sign(RS256.name, key ?? signingKey, data);
  return `${headerSegment}.${payloadSegment}.${base64Url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, [
    "sign",
    "verify",
  ]);
  signingKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const impostorPair = await crypto.subtle.generateKey(
    { ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  );
  impostorKey = impostorPair.privateKey;
});

beforeEach(() => {
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  resetFirebaseKeyCacheForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }] },
        { headers: { "cache-control": "public, max-age=3600" } },
      ),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIREBASE_PROJECT_ID;
});

/** `getServerEnv` caches, and these cases change FIREBASE_PROJECT_ID. */
vi.mock("@/config/env", () => ({
  getServerEnv: () => ({ FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID, NODE_ENV: "test" }),
  isProduction: () => false,
}));

describe("verifyFirebaseIdToken", () => {
  it("accepts a well-formed token and returns its claims", async () => {
    const claims = await verifyFirebaseIdToken(await mintToken());

    expect(claims.uid).toBe("firebase-uid-1");
    expect(claims.email).toBe("person@rajahx.com");
    expect(claims.emailVerified).toBe(true);
    expect(claims.signInProvider).toBe("password");
  });

  it("reports email_verified false when the claim is absent", async () => {
    const claims = await verifyFirebaseIdToken(await mintToken({ claims: { email_verified: undefined } }));
    expect(claims.emailVerified).toBe(false);
  });

  /**
   * Strictly `true`, never merely truthy. A provider or a proxy that rendered
   * the claim as the STRING "true" would otherwise flip verification on for
   * every account, and with it the gate on every protected page.
   */
  it('does not accept the string "true" as verification', async () => {
    const claims = await verifyFirebaseIdToken(await mintToken({ claims: { email_verified: "true" } }));
    expect(claims.emailVerified).toBe(false);
  });

  it("rejects a token signed by a different key", async () => {
    await expect(verifyFirebaseIdToken(await mintToken({ key: impostorKey }))).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  /**
   * The canonical forgery: take a real token, edit the claims, keep the
   * signature. It must fail on the signature, before any claim is read.
   */
  it("rejects a token whose payload was edited after signing", async () => {
    const [header, , signature] = (await mintToken()).split(".");
    const tampered = encodeSegment({
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: "somebody-elses-uid",
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email_verified: true,
    });

    await expect(verifyFirebaseIdToken(`${header}.${tampered}.${signature}`)).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  /**
   * A token from another Firebase project, correctly signed by Google with a
   * key we really do trust. Only `aud` and `iss` separate it from ours - which
   * is why those two checks are not optional hardening.
   */
  it("rejects a valid token issued for a different Firebase project", async () => {
    const wrongAudience = await mintToken({ claims: { aud: "somebody-elses-project" } });
    await expect(verifyFirebaseIdToken(wrongAudience)).rejects.toBeInstanceOf(FirebaseTokenError);

    const wrongIssuer = await mintToken({ claims: { iss: "https://securetoken.google.com/somebody-elses-project" } });
    await expect(verifyFirebaseIdToken(wrongIssuer)).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyFirebaseIdToken(await mintToken({ claims: { exp: now - 120, iat: now - 3600 } }))).rejects.toBeInstanceOf(
      FirebaseTokenError,
    );
  });

  it("rejects a token issued in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    await expect(verifyFirebaseIdToken(await mintToken({ claims: { iat: now + 3600 } }))).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  /**
   * `alg: none` is the oldest JWT attack there is, and the check must happen
   * before the key lookup - an implementation that fetched a key first and
   * then noticed would still be wrong, just more slowly.
   */
  it("rejects alg: none", async () => {
    const headerSegment = encodeSegment({ alg: "none", kid: KID, typ: "JWT" });
    const payloadSegment = encodeSegment({ iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID, sub: "x" });

    await expect(verifyFirebaseIdToken(`${headerSegment}.${payloadSegment}.`)).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  it("rejects a symmetric algorithm", async () => {
    await expect(verifyFirebaseIdToken(await mintToken({ header: { alg: "HS256" } }))).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  it("rejects a token citing a key id Google does not publish", async () => {
    await expect(verifyFirebaseIdToken(await mintToken({ header: { kid: "not-a-real-key" } }))).rejects.toBeInstanceOf(
      FirebaseTokenError,
    );
  });

  it("rejects a token with no subject", async () => {
    await expect(verifyFirebaseIdToken(await mintToken({ claims: { sub: "" } }))).rejects.toBeInstanceOf(FirebaseTokenError);
  });

  it("rejects malformed and empty tokens", async () => {
    for (const value of ["", "not-a-jwt", "only.two", `${"a".repeat(9000)}.b.c`]) {
      await expect(verifyFirebaseIdToken(value)).rejects.toBeInstanceOf(FirebaseTokenError);
    }
  });

  it("refuses to verify anything when no Firebase project is configured", async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    await expect(verifyFirebaseIdToken(await mintToken())).rejects.toBeInstanceOf(FirebaseNotConfiguredError);
  });

  /**
   * A network failure must not be reported as a bad token: the caller would be
   * told to sign in again, which cannot help, and an operator would be sent
   * looking at credentials during somebody else's outage.
   */
  it("distinguishes an unreachable key endpoint from an invalid token", async () => {
    const token = await mintToken();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    resetFirebaseKeyCacheForTests();

    await expect(verifyFirebaseIdToken(token)).rejects.not.toBeInstanceOf(FirebaseTokenError);
  });

  it("fetches Google's keys once and serves later verifications from cache", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await verifyFirebaseIdToken(await mintToken());
    await verifyFirebaseIdToken(await mintToken());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("firebaseIdTokenFrom", () => {
  it("reads a Bearer JWT", () => {
    expect(firebaseIdTokenFrom("Bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
    expect(firebaseIdTokenFrom("bearer aaa.bbb.ccc")).toBe("aaa.bbb.ccc");
  });

  /**
   * The developer API keys in `api-key-auth.ts` use the same header. They are
   * opaque single-part strings, so requiring three parts is what keeps the two
   * authenticators from trying to consume each other's credentials.
   */
  it("ignores credentials that are not three-part JWTs", () => {
    expect(firebaseIdTokenFrom("Bearer dot_live_abc123")).toBeNull();
    expect(firebaseIdTokenFrom("Basic dXNlcjpwYXNz")).toBeNull();
    expect(firebaseIdTokenFrom("Bearer")).toBeNull();
    expect(firebaseIdTokenFrom(null)).toBeNull();
  });
});
