// @vitest-environment node
/**
 * The verification gate, at the point of entry.
 *
 * The gate itself lives in the DAL and is what actually enforces the rule: an
 * unverified account is turned away from `/w/[slug]` and from `/onboarding` no
 * matter how it got there. These cases cover the layer above it - where a
 * freshly authenticated account is SENT - because that is the part with no
 * safety net of its own and the part a well-meaning change to a redirect can
 * quietly undo.
 *
 * Getting it wrong is not a security hole (the DAL still refuses), but it is a
 * visible one: the person is thrown at a dashboard, bounced off it, and lands
 * on a verification page having watched the application flicker through a page
 * it never intended to show them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  firebaseConfigured: vi.fn(),
  authenticateWithPassword: vi.fn(),
  signInWithFirebase: vi.fn(),
  registerWithFirebase: vi.fn(),
  findDefaultWorkspaceSlug: vi.fn(),
  getPlatformGrant: vi.fn(),
  createSession: vi.fn(),
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
  findDefaultWorkspaceSlug: mocks.findDefaultWorkspaceSlug,
  registerUser: vi.fn(),
  registerInvitedUser: vi.fn(),
}));
vi.mock("@/features/auth/server/firebase-auth-service", () => ({
  signInWithFirebase: mocks.signInWithFirebase,
  registerWithFirebase: mocks.registerWithFirebase,
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
vi.mock("@/server/auth/platform-dal", () => ({ getPlatformGrant: mocks.getPlatformGrant }));
vi.mock("@/features/settings/server/invitation-service", () => ({ acceptInvitation: vi.fn() }));
vi.mock("@/server/http/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  checkRateLimits: () => ({ allowed: true, retryAfterSeconds: 0 }),
  clientIpFrom: () => "127.0.0.1",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const { signInAction, signInWithFirebaseAction, signUpWithFirebaseAction } = await import("@/features/auth/actions");

const TOKEN = "aaa.bbb.ccc";

function destination(): string | undefined {
  return mocks.redirect.mock.calls.at(-1)?.[0] as string | undefined;
}

describe("where an account lands after authenticating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSession.mockResolvedValue({ token: "t", session: { expiresAt: new Date() } });
    mocks.getPlatformGrant.mockResolvedValue(null);
    mocks.findDefaultWorkspaceSlug.mockResolvedValue("acme");
  });

  describe("password sign-in", () => {
    it("sends a verified account to its workspace", async () => {
      mocks.firebaseConfigured.mockReturnValue(false);
      mocks.authenticateWithPassword.mockResolvedValue({ id: "u1", email: "a@rajahx.com", name: "A", emailVerified: true });

      await signInAction({ email: "a@rajahx.com", password: "x".repeat(12) });

      expect(destination()).toBe("/w/acme/dashboard");
    });

    it("sends an unverified account to the verification page instead", async () => {
      mocks.firebaseConfigured.mockReturnValue(false);
      mocks.authenticateWithPassword.mockResolvedValue({ id: "u1", email: "a@rajahx.com", name: "A", emailVerified: false });

      await signInAction({ email: "a@rajahx.com", password: "x".repeat(12) });

      expect(destination()).toBe("/verify-email");
    });

    /**
     * `next` is a request, not an instruction. An unverified account arriving
     * with `?next=` pointing into a workspace must not be handed to the guard
     * just to be turned away - and a `next` that could override the gate would
     * make the gate advisory.
     */
    it("does not let ?next= carry an unverified account past the gate", async () => {
      mocks.firebaseConfigured.mockReturnValue(false);
      mocks.authenticateWithPassword.mockResolvedValue({ id: "u1", email: "a@rajahx.com", name: "A", emailVerified: false });

      await signInAction({ email: "a@rajahx.com", password: "x".repeat(12), next: "/w/acme/settings" });

      expect(destination()).toBe("/verify-email");
    });

    it("honours ?next= once the account is verified", async () => {
      mocks.firebaseConfigured.mockReturnValue(false);
      mocks.authenticateWithPassword.mockResolvedValue({ id: "u1", email: "a@rajahx.com", name: "A", emailVerified: true });

      await signInAction({ email: "a@rajahx.com", password: "x".repeat(12), next: "/w/acme/settings" });

      expect(destination()).toBe("/w/acme/settings");
    });
  });

  describe("Firebase sign-in", () => {
    beforeEach(() => mocks.firebaseConfigured.mockReturnValue(true));

    /** A Google token arrives with email_verified already true. */
    it("lets a verified identity straight through to the workspace", async () => {
      mocks.signInWithFirebase.mockResolvedValue({
        user: { id: "u1", email: "a@rajahx.com", name: "A" },
        emailVerified: true,
        workspaceSlug: "acme",
      });

      await signInWithFirebaseAction({ idToken: TOKEN });

      expect(destination()).toBe("/w/acme/dashboard");
    });

    it("holds an unverified identity at the verification page", async () => {
      mocks.signInWithFirebase.mockResolvedValue({
        user: { id: "u1", email: "a@rajahx.com", name: "A" },
        emailVerified: false,
        workspaceSlug: "acme",
      });

      await signInWithFirebaseAction({ idToken: TOKEN });

      expect(destination()).toBe("/verify-email");
    });

    /**
     * An account with no workspace normally goes to /onboarding - but that page
     * CREATES workspaces, so verification has to come first there too.
     */
    it("holds an unverified identity with no workspace at the gate, not at onboarding", async () => {
      mocks.signInWithFirebase.mockResolvedValue({
        user: { id: "u1", email: "a@rajahx.com", name: "A" },
        emailVerified: false,
        workspaceSlug: null,
      });

      await signInWithFirebaseAction({ idToken: TOKEN });

      expect(destination()).toBe("/verify-email");
    });
  });

  describe("Firebase registration", () => {
    beforeEach(() => mocks.firebaseConfigured.mockReturnValue(true));

    /**
     * The workspace is created either way - it is theirs and it is waiting.
     * What is withheld is entry to it.
     */
    it("creates the workspace but withholds entry until the address is confirmed", async () => {
      mocks.registerWithFirebase.mockResolvedValue({
        user: { id: "u1", email: "a@rajahx.com", name: "A" },
        workspaceSlug: "acme",
        emailVerified: false,
      });

      await signUpWithFirebaseAction({ idToken: TOKEN, name: "Ada", organizationName: "Acme" });

      expect(mocks.registerWithFirebase).toHaveBeenCalledOnce();
      expect(destination()).toBe("/verify-email");
    });

    /** Registering with Google: Google has already proved the address. */
    it("admits a Google registration immediately", async () => {
      mocks.registerWithFirebase.mockResolvedValue({
        user: { id: "u1", email: "a@rajahx.com", name: "A" },
        workspaceSlug: "acme",
        emailVerified: true,
      });

      // No `name` - the verified token carries the Google profile name.
      await signUpWithFirebaseAction({ idToken: TOKEN, organizationName: "Acme" });

      expect(destination()).toBe("/w/acme/dashboard");
    });
  });
});
