# Environment configuration

Copy `.env.example` to `.env.local` (git-ignored) and fill in values. Only `src/config/env.ts` reads `process.env`; everything else receives configuration through it. Validation is lazy: builds succeed without secrets, runtime fails loudly on first use.

| Variable | Required | Scope | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes (runtime) | server | PostgreSQL connection string, e.g. `postgresql://postgres:<password>@localhost:5432/dot`. Use a dedicated non-superuser role in shared environments so Row Level Security applies. |
| `APP_URL` | yes | server | Public origin of the deployment. Used for embed snippets and to recognise first-party widget previews. Default `http://localhost:3000`. |
| `APP_SECRET` | production | server | 32+ random characters. Signs embed tokens and derives encryption keys for integration secrets. Development falls back to a fixed value. |
| `AI_PROVIDER` | no | server | `mock` (default, no external calls) or `gateway`. |
| `AI_GATEWAY_BASE_URL` | when `gateway` | server | OpenAI-compatible base URL, typically your Cloudflare AI Gateway endpoint. |
| `AI_GATEWAY_API_KEY` | when `gateway` | server | Bearer token for the gateway/provider. Never exposed to the browser. |
| `AI_DEFAULT_MODEL` | no | server | Model identifier passed through the gateway when a chatbot/agent uses the workspace default. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | multi-instance prod | server | Stable key for Server Action closure encryption across instances (Next.js). |
| `FIREBASE_PROJECT_ID` | when Firebase is used | server | The Firebase project whose ID tokens this deployment accepts. Becomes the `aud` and `iss` that `verify-id-token.ts` demands, so a token from any other Firebase project is refused. Unset means Firebase sign-in is off and the built-in scrypt credentials are used instead. Not a secret — the browser carries the same id — but it must be read here rather than from the client, or the backend would be checking against a value the frontend supplies. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | when Firebase is used | browser | Firebase web API key. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | when Firebase is used | browser | e.g. `your-project.firebaseapp.com`. |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | when Firebase is used | browser | Should name the same project as `FIREBASE_PROJECT_ID`; only the server-side one decides anything. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | when Firebase is used | browser | Firebase web app id. |

### Firebase: which half is which

Development and production differ only in **which Firebase project** the five
variables above name. Use a separate project per environment so a developer
cannot create accounts in the production user pool, and add each environment's
domain under Authentication → Settings → Authorized domains.

The four `NEXT_PUBLIC_FIREBASE_*` values are the **client** configuration and
are published in the browser bundle by design — a Firebase web API key is an
identifier, not a credential, and grants nothing on its own. What protects the
project is its Console configuration.

What must NEVER appear in any of these, in `.env*`, or in Git: the
**service-account private key**. Nothing on the request path needs one — token
verification uses Google's published public keys — and the only consumer is
`scripts/migrate-users-to-firebase.mjs`, which reads it from
`GOOGLE_APPLICATION_CREDENTIALS` on a developer's machine. See
`docs/firebase-auth.md`.

Other `NEXT_PUBLIC_*` variables are inlined into browser bundles at build time. Add one only for values that are safe to publish.

## What does NOT belong here

This table is **platform** configuration: one set of values for the whole deployment, validated at boot, changed by an operator.

A credential that belongs to one workspace is not platform configuration. One process serves every tenant, so an environment variable cannot mean "this workspace's Stripe key", a customer cannot rotate one without a redeploy, and every workspace would share it. Those live in `workspace_credentials` (Integrations → Credentials), encrypted per workspace and resolved at run time by `src/features/integrations/server/credential-resolver.ts`. See ADR 0006.

The line is direction, not sensitivity: `AI_GATEWAY_API_KEY` is ours and belongs here; a token a customer pastes in to reach their own CRM belongs in the credential store.

## Planned infrastructure bindings

- **Cloudflare**: CDN/WAF/rate limiting in front of the app; AI Gateway behind `AI_GATEWAY_BASE_URL`; R2 for knowledge-source files (upload boundary lives in the knowledge feature).
- ~~**Firebase Auth**~~: done. Verified server-side and mapped to application sessions (ADR 0001, ADR 0007); the client config above is the first set of `NEXT_PUBLIC_*` values. See `docs/firebase-auth.md`.
- **GCP**: hosting for background workers (knowledge processing, workflow execution) that today run inline in requests.
