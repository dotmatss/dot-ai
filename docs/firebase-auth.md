# Firebase Authentication

Firebase is the **identity provider**. PostgreSQL remains the **application user
database** and the only thing that decides what anybody may do.

```
        Firebase                                PostgreSQL
  ────────────────────────              ──────────────────────────
  who this person is                    what they may do here
  passwords, reset, MFA                 users, organizations, roles
  email verification                    platform_admins, billing, usage
                        │
                        │  ID token, verified server-side
                        ▼
                  user_identities  ──▶  users.id
```

Nothing about authorization changed when Firebase arrived. `requireWorkspaceAccess`
still reads `organization_members.role`, `requirePlatformAccess` still reads
`platform_admins`, and a perfectly valid Firebase token for somebody with no
membership gets exactly as far as an empty cookie: nowhere.

## The bridge: `user_identities`, not `users.firebase_uid`

A Firebase account is linked to an application user by a row in
`user_identities`:

| column | value |
| --- | --- |
| `provider` | `firebase` |
| `provider_uid` | the Firebase UID (`sub` in the ID token) |
| `user_id` | `users.id` |

`UNIQUE (provider, provider_uid)` is what guarantees a Firebase UID can be
claimed by at most one application user — enforced by the database, not by
application code.

There is deliberately **no `users.firebase_uid` column**. That table already
existed for this purpose (ADR 0001), a second home for the same fact could
disagree with the first, and a single column cannot hold the second provider the
moment Google or SAML sign-in is enabled. Migration `0029_firebase_identity.sql`
explains this at length.

The two ids are **not** the same and nothing assumes they are. Requests resolve
`Firebase UID → user_identities → users.id`, and everything downstream uses the
internal id it always used.

## Sessions: the token is exchanged, not carried

The browser authenticates to Firebase and gets an ID token. It sends that token
to the server **once**; the server verifies it and issues the application's own
session cookie (ADR 0001, ADR 0007).

The reason is structural rather than stylistic: nearly every page here is a
Server Component rendered during a browser navigation, and a navigation cannot
carry an `Authorization` header — only cookies. Keeping the ID token in a cookie
instead would mean holding a bearer credential this server cannot revoke, still
valid for up to an hour after an account is disabled. The application session is
revocable by deleting one row.

Programmatic clients that do want to present a token per request can:
`requireApiAuth` accepts `Authorization: Bearer <firebase-id-token>` on the API
surface, resolves it through `user_identities`, and feeds the same authorization
checks. The opaque workspace API keys (`dot_live_…`) share that header and are
unaffected — they are not three-part JWTs, so each authenticator recognises only
its own credential.

## Token verification, and why not `firebase-admin`

`src/server/auth/firebase/verify-id-token.ts` verifies ID tokens directly:
RS256 over Google's published JWKS, using WebCrypto.

This deployment targets **Cloudflare Workers** (`docs/deployment.md`).
`firebase-admin` is a Node SDK — `node:http2`, a filesystem credential loader, a
long-lived process — and does not run on workerd. Firebase documents this case
and specifies verifying the ID token as an ordinary JWT against its public keys,
which is what this does. One implementation serves `next dev`, `vitest` and
production, and the runtime dependency count is unchanged.

Every rule is checked: `alg` is RS256 (refused before any key is fetched, so a
forged header cannot select a symmetric algorithm), `kid` is one Google
publishes, the signature verifies, `aud` is our project, `iss` is
`https://securetoken.google.com/<project>`, `exp`/`iat`/`auth_time` are sane, and
`sub` is a non-empty string of at most 128 characters.

`aud` and `iss` are the checks that make this project-specific. Without them a
token minted by **any** Firebase project — including one an attacker owns and
can create accounts in freely — would verify. `tests/unit/firebase-token-verification.test.ts`
signs its own tokens with real RSA keys and proves each rule rejects.

`firebase-admin` **is** used, as a devDependency, by
`scripts/migrate-users-to-firebase.mjs`. That runs on Node, by a person, with a
service-account credential. Nothing under `src/` imports it.

## Google sign-in

Google is a sign-in method *of* the Firebase project, not a second identity
system. What comes back is an ordinary Firebase ID token with the same `sub`,
verified by the same code and resolved through the same `user_identities` row.
The only server-visible difference is `firebase.sign_in_provider`, which is
recorded and not acted on. No schema change, no second provider key.

Console: **Authentication → Sign-in method → Google → Enable**, and add every
deployment's domain under **Authentication → Settings → Authorized domains**.
Missing the second step is the most common first-time failure and it surfaces
in the UI as "This site is not authorized for Google sign-in", which is the
literal fix.

Where each button leads, and why the three differ:

| Page | Action | May create an account? |
| --- | --- | --- |
| Sign in | `signInWithFirebaseAction` | **No.** An identity with no application user is refused and pointed at sign-up |
| Sign up | `signUpWithFirebaseAction` | Yes - and it creates the organization and workspace too |
| Invitation | `signUpWithInvitationFirebaseAction` | Yes, into the inviting organization; no new one |

Sign-in refusing to create is the §9 rule, not an oversight: a click on a
sign-in page must never quietly manufacture a tenant.

Sign-up asks for the **organization name before** opening the Google popup.
Google supplies a name and an address but no organization, and the alternatives
are both worse - deriving a name from the email domain gives every tenant a name
nobody chose, and opening the popup first means authenticating somebody and then
telling them the form was incomplete, by which point a Firebase account exists
and the page has to explain a half-finished state.

The person's name is taken from the **verified token**, not from a form field,
which is why `name` is optional on the Firebase sign-up schemas.

## Email verification

Firebase's own, start to finish. The browser calls `sendEmailVerification()`;
Firebase owns the template, the link, the token and its expiry. This application
has no verification token, no verification route, and nothing to leak.

`users.email_verified` mirrors the claim so a page can gate on it without a
network call. It is written **only** by the server, **only** from a verified ID
token (`syncEmailVerified`), and mirrors in both directions — changing an address
in Firebase resets its verification, and a one-way mirror would keep treating the
old address as confirmed.

The client cannot assert verification. `/verify-email` re-reads the user from
Firebase, forces a fresh ID token, and sends the **token**; the server checks the
signature and reads the claim itself.

Gates:

| | |
| --- | --- |
| `requireWorkspaceAccess` | redirects to `/verify-email` |
| `requireApiWorkspaceAccess` | 403, before the membership lookup so the answer does not leak which workspaces exist |
| `requirePlatformAccess` / `requireApiPlatformAccess` | same, before the grant lookup |
| `requireVerifiedAuthOrRedirect` | `/onboarding`, which **creates** workspaces and is reached precisely by accounts that have none - so the workspace guard never runs for it |
| `destinationAfterAuth` | every sign-in and registration, so an unverified account is *sent* to the gate rather than bounced off a dashboard it was never allowed to see |

A `?next=` is honoured only for a verified account. Otherwise a link into a
gated page would decide the destination before the gate got a say - and the
person would watch the application flicker through a page it never meant to
show them.

Google registrations pass straight through: the token already carries
`email_verified: true` because Google proved the address. Nothing is waived -
the proof simply already exists. Email/password registrations land on
`/verify-email` with their workspace created and waiting; what is withheld is
entry to it, not the account.

No loop is possible: `/verify-email` is reached through `requireAuthOrRedirect`,
never through the gate, and the gate stops redirecting the moment the column is
true.

## Account linking, and the takeover it prevents

An identity whose address Firebase has **not** verified may never be attached to
an application account that already exists.

Without that rule the email match is an account-takeover primitive: anybody can
create a Firebase account claiming `owner@customer.com` — Firebase issues it
without proof and only demands proof before marking it *verified* — and the
first sign-in would hand over the existing user with its organizations, its role
and its data.

So matching by address does exactly one thing, and only for a verified address:
lets an account created before Firebase adopt its Firebase identity. That is the
migration path below. Every later sign-in matches on the UID and never reads the
address, which is also why changing an address in Firebase cannot move an
application account.

Creating a **new** account from an unverified identity is still allowed — there
is nothing to take over, and the verification gate holds it back until Firebase
confirms.

## Migrating the existing accounts

`scripts/migrate-users-to-firebase.mjs` creates a Firebase account for every row
in `users`, **carrying the existing password** where there is one.

`src/server/auth/password.ts` hashes with Node's scrypt at N=16384, r=8, p=1,
64-byte output, which is exactly what Firebase's `importUsers` accepts as
`STANDARD_SCRYPT`. The hash is carried across as bytes; nobody learns a password.

```
node scripts/migrate-users-to-firebase.mjs --dry-run   # counts, writes nothing
node scripts/migrate-users-to-firebase.mjs             # import + link
```

Note the parameter mapping, because getting it wrong fails silently rather than
loudly — every imported password would simply stop matching:

| ours | Firebase | value |
| --- | --- | --- |
| N = 16384 | `memoryCost` (the **exponent**) | 14 |
| r = 8 | `blockSize` | 8 |
| p = 1 | `parallelization` | 1 |
| keylen = 64 | `derivedKeyLength` | 64 |

Rows with `password_hash IS NULL` have no credential to carry. They are created
without a password — usable the moment their owner uses "Forgot password", and
not a way in for anybody else, since an account with no password cannot be
signed in to. The dry run reports how many of each you have.

Firebase UIDs are derived deterministically from `users.id` (`pg_<uuid>`), so the
script is idempotent: re-running it targets the same accounts, and a partial run
is finished by running it again rather than unpicked. The application never
assumes the two ids are related.

`email_verified` is carried across rather than reset, so the accounts migration
0029 grandfathered are not locked out on their first Firebase sign-in.

### Manual steps

1. Create the Firebase project and enable **Email/Password** sign-in.
2. Add your domains under **Authentication → Settings → Authorized domains**.
3. Download a service-account key (**Project settings → Service accounts**).
   Do not commit it; `.gitignore` covers `.env*`, not arbitrary JSON.
4. `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/migrate-users-to-firebase.mjs --dry-run`
5. Run it for real, then set the environment variables below and deploy.
6. Tell the users the dry run counted as "will need Forgot password" to use it
   once. Everybody else signs in with the password they already had.
7. Once sign-ins are confirmed working, consider clearing `users.password_hash`.
   It is dead weight the moment `FIREBASE_PROJECT_ID` is set — the password
   Server Actions refuse outright — but it is also the rollback, so keep it
   until you are sure.

## Turning it on

Firebase is **off** unless configured, and that is a supported state: the
built-in scrypt credentials keep local development and the test suite running
without a Firebase project (ADR 0001). The switch is the presence of
configuration — see `docs/environment.md` for the variables.

### On Cloudflare Workers specifically

The five variables land in two different places, because they are read at two
different times:

| variable | where | why |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | `vars` in `wrangler.jsonc`, alongside `NODE_ENV` and `APP_URL` | read at **runtime** by `getServerEnv()` on every verification. Not a secret, so `vars` rather than `wrangler secret put` |
| the four `NEXT_PUBLIC_FIREBASE_*` | build environment (`.github/workflows/deploy.yml`) | Next.js inlines them into the **browser bundle** at build time. A Worker var cannot supply them — by the time the Worker runs, the bundle is already written |

So adding them to `wrangler.jsonc` alone produces a deployment where the server
will happily verify tokens and the browser has no Firebase to get one from. Both
halves are needed, and the workflow builds the bundle twice (`verify` and
`deploy`), so the build environment has to carry them in both jobs.

None of the five is a secret, so they can be plain `env:` entries in the
workflow rather than GitHub secrets — the same reasoning as the `APP_SECRET`
placeholder already there, and the opposite of the service-account key, which
belongs in neither.

The moment `FIREBASE_PROJECT_ID` is set, the password Server Actions
(`signInAction`, `signUpAction`, `signUpWithInvitationAction`) refuse. Hiding the
form would not have been enough: a Server Action is an HTTP endpoint, and one
still accepting a password comparison would be a second, weaker way in that
knows nothing about Firebase's rate limits, account disablement, verification or
MFA.

## What is deliberately not done

- **No revocation check per request.** An ID token stays valid for its hour
  whatever Firebase does, and checking costs an Admin SDK call per request. It
  is not needed: the token buys a session once, and `sessions` plus
  `users.disabled_at` revoke in one statement, effective on the next request —
  faster than Firebase revocation would be.
- **No Firebase session cookies.** They would couple every request to Firebase
  and block local development (ADR 0001).
- **No roles in Firebase, and no custom claims.** Roles live in
  `organization_members.role` and `platform_admins`. A claim in a token is a
  copy that can go stale, and granting privilege from one would put authorization
  in a system the application does not own.
