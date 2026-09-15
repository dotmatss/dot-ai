// @vitest-environment node
/**
 * Once Firebase owns authentication, the built-in password actions must refuse.
 *
 * Worth its own file because the failure it guards against is invisible in the
 * UI: with Firebase configured the sign-in form never renders a password path,
 * so every manual test passes while `signInAction` sits there as a reachable
 * HTTP endpoint that still compares a scrypt hash. Someone holding a password
 * from an old breach would simply skip the form and post to the action - past
 * Firebase's rate limits, its account disablement, its verification state and
 * any MFA on the project.
 *
 * So these cases assert the two things that matter: the action refuses, and it
 * refuses BEFORE looking at any credential.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  firebaseConfigured: vi.fn(),
  authenticateWithPassword: vi.fn(),
  registerUser: vi.fn(),
  registerInvitedUser: vi.fn(),
  createSession: vi.fn(),
  checkRateLimit: vi.fn(),
  checkRateLimits: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/server/auth/firebase/verify-id-token", () => ({
  isFirebaseConfigured: mocks.firebaseConfigured,
  firebaseIdTokenFrom: () => null,
  verifyFirebaseIdToken: vi.fn(),
  FirebaseTokenError: class extends Error {},
}));
vi.mock("@/features/auth/server/auth-service", () => ({
  authenticateWithPassword: mocks.authenticateWithPassword,
  registerUser: mocks.registerUser,
  registerInvitedUser: mocks.registerInvitedUser,
  findDefaultWorkspaceSlug: vi.fn().mockResolvedValue("workspace"),
}));
vi.mock("@/features/auth/server/firebase-auth-service", () => ({
  signInWithFirebase: vi.fn(),
  registerWithFirebase: vi.fn(),
  registerInvitedWithFirebase: vi.fn(),
  syncVerificationFromToken: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({
  createSession: mocks.createSession,
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  destroySession: vi.fn(),
}));
vi.mock("@/server/auth/dal", () => ({ getAuthContext: vi.fn() }));
vi.mock("@/server/auth/platform-dal", () => ({ getPlatformGrant: vi.fn() }));
vi.mock("@/features/settings/server/invitation-service", () => ({ acceptInvitation: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  checkRateLimits: mocks.checkRateLimits,
  clientIpFrom: () => "127.0.0.1",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { signInAction, signUpAction, signUpWithInvitationAction } = await import("@/features/auth/actions");

describe("password actions once Firebase is the identity provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.checkRateLimits.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  });

  it("refuses to sign in, and never reaches the credential check", async () => {
    mocks.firebaseConfigured.mockReturnValue(true);

    const result = await signInAction({ email: "person@rajahx.com", password: "the-real-password" });

    expect(result).toMatchObject({ ok: false });
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refuses to register, by either route", async () => {
    mocks.firebaseConfigured.mockReturnValue(true);

    const signUp = await signUpAction({
      name: "Person",
      organizationName: "Org",
      email: "person@rajahx.com",
      password: "a-long-enough-password",
    });
    const invited = await signUpWithInvitationAction({
      name: "Person",
      email: "person@rajahx.com",
      password: "a-long-enough-password",
      invitationToken: "a".repeat(32),
    });

    expect(signUp).toMatchObject({ ok: false });
    expect(invited).toMatchObject({ ok: false });
    expect(mocks.registerUser).not.toHaveBeenCalled();
    expect(mocks.registerInvitedUser).not.toHaveBeenCalled();
  });

  /**
   * The other half of the contract: a deployment WITHOUT Firebase still runs on
   * these actions, which is what keeps local development and the test suite
   * working with no Firebase project (ADR 0001). A guard that refused
   * unconditionally would pass the cases above and break every developer.
   */
  it("still works where no Firebase project is configured", async () => {
    mocks.firebaseConfigured.mockReturnValue(false);
    mocks.authenticateWithPassword.mockResolvedValue({ id: "u1", email: "person@rajahx.com", name: "Person" });
    mocks.createSession.mockResolvedValue({ token: "t", session: { expiresAt: new Date() } });

    await signInAction({ email: "person@rajahx.com", password: "the-real-password" });

    expect(mocks.authenticateWithPassword).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/w/workspace/dashboard");
  });
});
