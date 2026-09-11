import type { DocPage } from "@/features/docs/types";

export const GETTING_STARTED_PAGES: DocPage[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Create a workspace, build a grounded chatbot, and put it in front of customers.",
    blocks: [
      {
        type: "paragraph",
        text: "This platform builds AI assistants on your own content and gives you two ways to reach customers: a script tag on your website, or an HTTP API you call from your own application. This page takes you from a new account to a published chatbot.",
      },
      { type: "heading", id: "create-a-workspace", text: "Create a workspace" },
      {
        type: "paragraph",
        text: "Sign up at [/sign-up](/sign-up). The first account creates an organization and a workspace, and becomes its owner. A workspace is the unit of isolation: chatbots, knowledge, conversations and contacts all belong to exactly one, and nothing crosses between them.",
      },
      { type: "heading", id: "build-a-chatbot", text: "Build a chatbot" },
      {
        type: "steps",
        items: [
          {
            title: "Create it",
            body: "Chatbots → New chatbot. Give it a name; everything else has a working default.",
          },
          {
            title: "Write the instructions",
            body: "The Instructions tab holds the system prompt: who the assistant is, what it should do, and what it should refuse. Keep it specific; this is the highest-leverage setting on the page.",
          },
          {
            title: "Ground it",
            body: "Create a collection under Knowledge, add a document or a URL, wait for it to reach Ready, then attach it on the chatbot's Knowledge tab. Answers will cite what they used.",
          },
          {
            title: "Test it",
            body: "The Playground runs against the configuration you just saved, streaming the reply exactly as a visitor would see it. Conversations from here are recorded on the `playground` channel so they never mix with real traffic.",
          },
          {
            title: "Publish it",
            body: "On Deploy, add the domains allowed to use the widget, then activate the chatbot. It answers nothing until it is active.",
          },
        ],
      },
      { type: "heading", id: "choose-an-integration", text: "Choose an integration" },
      {
        type: "paragraph",
        text: "Both paths reach the same chatbot, the same knowledge and the same streaming response.",
      },
      {
        type: "table",
        head: ["Path", "Use it when", "Guide"],
        rows: [
          [
            "Website embed",
            "The assistant belongs on a page you control: marketing site, help centre, docs.",
            "[Website embed](/docs/embed)",
          ],
          [
            "HTTP API",
            "You are building the interface yourself: your own frontend, a backend service, a mobile or internal app.",
            "[Chat API](/docs/api/chat)",
          ],
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "The same contract either way",
        body: "The widget and the API consume an identical Server-Sent Events stream, so switching between them, or running both, does not change how replies behave.",
      },
      { type: "heading", id: "next", text: "Where to go next" },
      {
        type: "list",
        items: [
          "[Core concepts](/docs/concepts) — workspaces, roles, channels and how isolation works.",
          "[Knowledge](/docs/knowledge) — collections, and how retrieval-augmented generation works here.",
          "[API authentication](/docs/api/authentication) — create a key and make your first call.",
        ],
      },
    ],
  },
  {
    slug: "concepts",
    title: "Core concepts",
    description: "Workspaces, roles, channels and the boundaries the platform enforces.",
    blocks: [
      { type: "heading", id: "hierarchy", text: "Accounts, organizations, workspaces" },
      {
        type: "paragraph",
        text: "A user belongs to one or more organizations. An organization owns workspaces. Everything you build lives in a workspace, and a workspace is the tenant boundary: every record carries its workspace, every query filters on it, and PostgreSQL row-level security enforces it a second time underneath.",
      },
      { type: "heading", id: "roles", text: "Roles" },
      {
        type: "table",
        head: ["Role", "Can do"],
        rows: [
          ["Owner", "Everything, including deleting the workspace and managing billing when it exists."],
          ["Admin", "Manage members, integrations, API keys, and delete resources."],
          ["Member", "Create and edit chatbots, agents, workflows, knowledge and CRM records."],
          ["Viewer", "Read dashboards, conversations and records. No writes, and no playground runs."],
        ],
      },
      {
        type: "paragraph",
        text: "Roles are checked on the server for every request. A control hidden in the interface is a convenience, never the boundary.",
      },
      { type: "heading", id: "assistants", text: "Chatbots and agents" },
      {
        type: "paragraph",
        text: "A **chatbot** answers questions from its instructions and its attached knowledge. An **agent** adds tools, a memory window, structured output and an approval step. Start with a chatbot; move to an agent when the assistant needs to *do* something rather than only answer.",
      },
      { type: "heading", id: "channels", text: "Channels" },
      {
        type: "paragraph",
        text: "Every conversation records where it came from, so reporting can separate real traffic from your own testing.",
      },
      {
        type: "table",
        head: ["Channel", "Source"],
        rows: [
          ["widget", "The embedded website widget."],
          ["api", "A server-to-server call authenticated with a workspace API key."],
          ["playground", "Testing inside the dashboard."],
          ["agent", "An agent run."],
        ],
      },
      { type: "heading", id: "usage", text: "Usage and metering" },
      {
        type: "paragraph",
        text: "Messages and token counts are recorded per workspace as they happen, and surfaced in Analytics. There is no quota enforcement or billing yet; see [rate limits](/docs/api/rate-limits) for the ceilings that do apply.",
      },
    ],
  },
];
