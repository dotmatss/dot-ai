# Dot — AI chatbot & workflow platform

Multi-tenant SaaS for creating, deploying and managing AI chatbots, agents, workflows, RAG knowledge collections, conversations and a CRM. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, Zustand, Zod, React Hook Form and PostgreSQL.

## Quick start

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL to your local PostgreSQL
npm run db:migrate
npm run dev
```

Open http://localhost:3000, create an account, and you land in your first workspace. See [docs/development.md](docs/development.md) for scripts, testing and migrations, and [docs/environment.md](docs/environment.md) for every environment variable.

## What is inside

| Area | Path | Notes |
| --- | --- | --- |
| Design system | `src/app/globals.css`, `src/components/ui` | Monochrome tokens (ink scale, semantic surfaces, status tones), `App*` primitives |
| App shell | `src/components/layout` | Sidebar, top bar, page header/container, providers |
| Features | `src/features/*` | Feature-oriented modules: auth, workspaces, dashboard, chatbots, agents, workflows, knowledge, conversations, crm, integrations, mcp, analytics, settings, pricing, embed, marketing, docs, legal, public-chatbot |
| Server boundary | `src/server/*` | PostgreSQL access, sessions/DAL, route-handler helpers, AI gateway, activity/usage logging |
| Routes | `src/app` | `/(auth)`, `/onboarding`, `/w/[workspaceSlug]/...`, `/embed/[embedKey]`, `/api/v1/...`, `/api/public/...` |
| Public site | `src/app/(marketing)`, `src/features/marketing`, `src/features/docs`, `src/features/legal`, `src/features/public-chatbot` | Static landing page, developer documentation, legal pages, and a tenant-less AI demo that loads on first click |
| Data | `src/server/db/migrations`, `src/server/db/schema` | Forward-only SQL migrations with Row Level Security; Drizzle describes the same tables in TypeScript |
| Tests | `tests/unit`, `src/**/*.test.tsx`, `tests/e2e` | Vitest + Testing Library, Playwright |

## Talking to a chatbot from your own code

Two supported paths, both ending at the same streaming service:

- **Embed** a chatbot on a website with the snippet on its Deploy tab. The widget is allowed only on the domains you list.
- **Call the API** with a workspace API key from Integrations → API keys. Keys are shown once and stored only as a hash.

```bash
curl -N -X POST https://your-app.example.com/api/v1/public/chat \
  -H "Authorization: Bearer $DOT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "chatbotId": "YOUR_CHATBOT_ID",
    "messages": [{ "role": "user", "content": "What are your opening hours?" }]
  }'
```

The reply is a server-sent event stream, the same contract the widget consumes.

Never hard-code a key or put one in a `NEXT_PUBLIC_*` variable. Full reference at `/docs`.

## Architecture

- [docs/architecture.md](docs/architecture.md) — layers, request flow, domain model
- [docs/feature-conventions.md](docs/feature-conventions.md) — how every feature module is built
- [docs/adr](docs/adr) — decisions on authentication, tenant isolation, the AI boundary and embedding security
- [docs/dependencies.md](docs/dependencies.md) — what was installed, what was deferred and why
- [docs/theming.md](docs/theming.md) — light, dark and system appearance, and why the preference is not a cookie
- [docs/legal-and-privacy.md](docs/legal-and-privacy.md) — where policy content lives, what the app stores in a browser, and the questions still open for legal review
- [docs/orm-evaluation.md](docs/orm-evaluation.md) — why Drizzle ORM was chosen, and what adopting it did and did not change
- [docs/mcp-evaluation.md](docs/mcp-evaluation.md) — Model Context Protocol: the client architecture, what phase 1 implemented, and what is deliberately left to phase 2
- [docs/mcp-phase2-gate.md](docs/mcp-phase2-gate.md) — **proposed, not implemented.** The DNS-rebinding window that must close before any MCP tool executes, and the six decisions it needs
