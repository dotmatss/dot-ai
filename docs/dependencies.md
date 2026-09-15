# Dependency review

Decision order used for every capability: existing dependency → Next.js → React → platform → internal abstraction → mature third‑party → custom code. Anything not in the baseline below was deliberately deferred.

## Installed (runtime)

| Dependency | Purpose | Why needed | Alternative | Recommendation |
| --- | --- | --- | --- | --- |
| `@tanstack/react-query` | Server state, caching, invalidation, mutations, pagination | Baseline stack; SSR hydration pattern documented by Next.js | SWR | Adopted |
| `zustand` | Client-only global state (sidebar prefs, toasts) | Baseline stack; tiny; per-request store pattern for SSR | React context only | Adopted, scoped to UI state |
| `zod` (v4) | Validation shared by forms and route handlers | Baseline stack | Valibot | Adopted |
| `react-hook-form` + `@hookform/resolvers` | Complex forms with client + server validation | Baseline stack; resolvers bridge Zod v4 | Native `useActionState` only | Adopted |
| `lucide-react` | Icons | Baseline stack | Heroicons | Adopted |
| `pg` | PostgreSQL driver | Prisma is excluded by requirement; `pg` is the mature, minimal driver | `postgres` (porsager) | Adopted; SQL lives in feature repositories |
| `drizzle-orm` | Typed query builder and row mapping over the existing `pg` pool | Approved after the written evaluation in `orm-evaluation.md`. Replaces hand-written row interfaces and positional-parameter juggling without taking ownership of the schema away from SQL | Kysely (runner-up), Prisma (rejected: cannot express RLS, policies or triggers, needs a codegen step, awkward with transaction-scoped `set_config`) | Adopted. Zero transitive dependencies. Migrating repository by repository; `chatbot-repository.ts` is the reference |
| `server-only` | Build-time guard against importing server modules into client bundles | Recommended by Next.js data-security guide | none | Adopted (0 runtime cost) |
| `firebase` | Firebase Authentication in the BROWSER: account creation, sign-in, verification email, password reset | Adopted once a Firebase project existed, as ADR 0001 anticipated. It is what keeps passwords off our servers entirely — `createUserWithEmailAndPassword` and `signInWithEmailAndPassword` send them to Google over TLS, and our server only ever sees an ID token | Firebase Auth REST API (`identitytoolkit`) directly — zero dependency, but the password would then travel through our server, which is the one property this is here to avoid | Adopted, `firebase/auth` only (tree-shaken); client-side, never imported by a server module |

## Installed (development)

| Dependency | Purpose |
| --- | --- |
| `vitest`, `@vitejs/plugin-react`, `jsdom`, `vite-tsconfig-paths` | Unit and component tests (Next.js Vitest guide) |
| `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`, `@testing-library/user-event` | Component tests that assert behavior, not implementation |
| `@playwright/test` | End-to-end critical journeys |
| `@types/node@22` | Matches the Node 22 runtime (required by Vitest 5 peer range) |
| `firebase-admin` | `importUsers` for the one-time migration of existing scrypt hashes into Firebase (`scripts/migrate-users-to-firebase.mjs`) | Needs a service-account credential and is the official, tested path for `STANDARD_SCRYPT` import, where a hand-rolled REST call would fail silently rather than loudly if a parameter were wrong. **Dev-only and script-only**: it is a Node SDK that cannot run on Cloudflare Workers, and nothing under `src/` imports it — request-path verification uses WebCrypto against Google's JWKS (ADR 0007) | Hand-rolled `accounts:batchCreate` REST call with a service-account-signed JWT | Adopted as a devDependency; never bundled, never deployed |
| `drizzle-kit` | Diffs the TypeScript schema and emits SQL for review | Output goes to `drizzle/` for review, never straight into `src/server/db/migrations/`. Carries a **moderate dev-only advisory**: its bundled `esbuild <= 0.24.2` allows any website to read responses from an esbuild **dev server**. drizzle-kit never starts one, and the package never ships to production. The only npm-offered "fix" is drizzle-kit 0.18.1, which predates and is incompatible with drizzle-orm 0.45 - a real downgrade for a risk we do not run. Accepted knowingly; revisit when drizzle-kit drops `@esbuild-kit/*` |

## Evaluated and deferred

| Capability | Candidate | Decision | Reason |
| --- | --- | --- | --- |
| Class name merging | `clsx`, `tailwind-merge`, `cva` | Custom `cn()` + explicit variant maps | Components avoid conflicting utilities by construction; no runtime merge needed |
| Headless UI | Radix, Headless UI, react-aria | Custom primitives on native `<dialog>`, ARIA menu/tabs patterns | Requirements fit well-understood patterns; keeps bundle small and design fully controlled. Revisit if combobox/date-picker complexity grows |
| Tables | `@tanstack/react-table`, `@tanstack/react-virtual` | Composable `AppTable` primitives + server pagination | Server-side pagination keeps lists small; add virtualization when a single view must render thousands of rows |
| Charts | Recharts, visx, d3 | Custom SVG `AppBarChart`/`AppSparkline` | Monochrome, single-series charts with table fallbacks are small; library adds bundle weight and styling fights |
| Workflow visualization | `@xyflow/react` (React Flow), `reactflow` v11, `elkjs`/`dagre` for layout | Custom projection + SVG renderer (`domain/preview.ts`, `workflow-preview-canvas.tsx`) | Re-evaluated when the read-only Preview tab was built, and declined for this scope. React Flow is production-grade and would be the right answer for an *editable* canvas — drag, connect, snap, handles — but Preview needs none of that: it needs layout, orthogonal edges, pan/zoom/fit and node selection, which is roughly 400 lines of pure, testable code against a 50 kB min+gzip dependency that also ships its own stylesheet and CSS variables to reconcile with a monochrome token system. The deciding factor is the same one behind the custom charts: the accessible walkthrough is the primary reading path, and a canvas library cannot supply it. `elkjs` (a WASM port of a Java layout engine) is heavier still for a layered rank the graph schema already caps at 60 nodes. **Revisit when the canvas becomes editable** — at that point React Flow's interaction model is worth its weight, and `buildPreviewGraph` is the projection it would consume |
| AI streaming | Vercel AI SDK | Custom SSE contract (`ChatStreamEvent`) | Keeps the frontend provider-agnostic and the boundary aligned with Cloudflare AI Gateway; the SDK can be introduced behind `AiGateway` if needed |
| Authentication | Auth.js (NextAuth) | Rejected | `firebase` and `firebase-admin` have since been adopted (see above); Auth.js remains declined — it brings its own schema and session model to replace a small module that already works and already has the provider seam. See ADR 0001 and ADR 0007 |
| Rich text / Markdown | `react-markdown`, Tiptap | Deferred | No rich-text requirement yet; assistant messages render as text |
| File uploads | UploadThing, tus | Route handler + `FormData` | Text-based knowledge sources only for now; object storage (Cloudflare R2) planned |
| Error tracking / analytics | Sentry, PostHog | Deferred | Provider not chosen; hooks exist in `error.tsx` boundaries and `AppErrorState` |
| Drag and drop | dnd-kit | Deferred | Builder uses keyboard-accessible reorder buttons first |
| Socket pinning for outbound requests | `undici` (direct dependency) | Adopted in phase 2a, then **removed** | It pinned each connection to an address the policy had already validated, closing a DNS-rebinding window. It cannot work on Cloudflare Workers, which exposes no custom dispatcher, and the deployment target was set to Workers. Re-adopt if the app ever runs on a Node runtime; see `docs/deployment.md` |
| Schema push | `drizzle-kit push` | Refused, not wired up | It mutates the database directly from TypeScript. Our Row Level Security policies, `FORCE ROW LEVEL SECURITY`, `set_updated_at` triggers and extensions exist only in SQL, so a push would silently drop the tenant-isolation layer |
