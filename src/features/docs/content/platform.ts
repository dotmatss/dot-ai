import type { DocPage } from "@/features/docs/types";

export const PLATFORM_PAGES: DocPage[] = [
  {
    slug: "chatbots",
    title: "Chatbots",
    description: "Instructions, model settings, knowledge and the publish flow.",
    blocks: [
      {
        type: "paragraph",
        text: "A chatbot is the simplest assistant: instructions, a model, optional collections, and an appearance. It streams answers and cites the sources it used.",
      },
      { type: "heading", id: "instructions", text: "Instructions" },
      {
        type: "paragraph",
        text: "The Instructions tab is the system prompt sent on every conversation. Say who the assistant is, what it should do, how to behave when it does not know, and when to hand off to a human. Instructions are capped at 20,000 characters.",
      },
      {
        type: "code",
        language: "text",
        label: "Example instructions",
        code: `You are the support assistant for Acme, a company that sells lab equipment.

- Answer from the connected collections and cite the sources as [n].
- If the knowledge does not cover the question, say so and offer to pass it to
  a human rather than guessing.
- Never quote a price; prices change, so link to the pricing page instead.
- Keep answers under four sentences unless asked for detail.`,
      },
      { type: "heading", id: "model", text: "Model settings" },
      {
        type: "paragraph",
        text: "Pick a model tier, a temperature between 0 and 2, and a maximum reply length. Model identifiers are routed by the AI gateway rather than hard-coded into the product, so the same chatbot can be pointed at a different provider without changing its configuration.",
      },
      { type: "heading", id: "welcome", text: "Welcome message" },
      {
        type: "paragraph",
        text: "The first message a visitor sees. It is not sent to the model and does not count towards usage.",
      },
      { type: "heading", id: "knowledge", text: "Knowledge" },
      {
        type: "paragraph",
        text: "Attach any number of collections from the same workspace. On every turn the most relevant chunks are retrieved and passed to the model, which cites them as numbered sources. See [knowledge](/docs/knowledge).",
      },
      { type: "heading", id: "status", text: "Status" },
      {
        type: "table",
        head: ["Status", "Behaviour"],
        rows: [
          ["Draft", "Editable, testable in the playground, invisible to visitors."],
          ["Active", "Serving the widget and the API."],
          ["Paused", "Configuration kept, but it stops answering immediately."],
          ["Archived", "Hidden from lists and disabled."],
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "Publishing takes two things",
        body: "A chatbot serves the widget only when it is Active **and** the requesting site is on its allowed-domain list. The API path needs Active plus a valid workspace API key.",
      },
    ],
  },
  {
    slug: "agents",
    title: "Agents",
    description: "Tools, memory, structured output and human approval.",
    blocks: [
      {
        type: "paragraph",
        text: "An agent is a chatbot that can also reach for tools. It keeps everything a chatbot has — instructions, model settings, knowledge — and adds four things.",
      },
      { type: "heading", id: "tools", text: "Tools" },
      {
        type: "paragraph",
        text: "Enable tools from a registry and configure each one. When the model asks to use a tool, the request is resolved against that registry and reported in the transcript with its decision.",
      },
      {
        type: "table",
        head: ["Decision", "Meaning"],
        rows: [
          ["Simulated", "The tool is known and enabled; the call is recorded but nothing was executed."],
          ["Needs approval", "The tool or the agent requires a person to approve the call first."],
          ["Unavailable", "The tool is known but not enabled on this agent."],
          ["Unknown tool", "The model asked for something that is not in the registry."],
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "Tools do not execute yet",
        body: "Tool calls are resolved and surfaced, not run. This is deliberate: it lets you see exactly what an agent would do before anything can act on your systems. Execution and an approval queue are not implemented.",
      },
      { type: "heading", id: "memory", text: "Memory" },
      {
        type: "paragraph",
        text: "Memory bounds how much of the conversation is sent back to the model. Set a window size and, optionally, a summary of what falls out of it, which keeps long conversations affordable without losing the thread.",
      },
      { type: "heading", id: "structured-output", text: "Structured output" },
      {
        type: "paragraph",
        text: "Provide a JSON Schema and the agent is instructed to answer in that shape, which is what you want when the reply feeds another system rather than a person. The schema is validated as JSON when you save it; the model's reply is not yet validated against it server-side.",
      },
      { type: "heading", id: "approval", text: "Human approval" },
      {
        type: "paragraph",
        text: "Turn on approval at the agent level to mark every tool request as needing a person, regardless of the per-tool setting.",
      },
    ],
  },
  {
    slug: "workflows",
    title: "Workflows",
    description: "Typed nodes, validation before running, and a per-step run history.",
    blocks: [
      {
        type: "paragraph",
        text: "A workflow is a graph of typed nodes: a trigger, optional input, AI steps, conditions, tools, actions and an output. Each node type declares its own configuration schema, so the builder can validate a workflow before it ever runs.",
      },
      { type: "heading", id: "nodes", text: "Node types" },
      {
        type: "list",
        items: [
          "**Triggers** — manual, webhook, or when a conversation starts.",
          "**Input** — a typed form of values the run begins with.",
          "**AI** — generate text from a prompt template, or classify into one of a set of categories.",
          "**Condition** — branch on a run variable.",
          "**Tool** — an outbound HTTP request, disabled unless explicitly allowed.",
          "**Action** — create a contact, send a notification.",
          "**Output** — the response the run returns.",
        ],
      },
      { type: "heading", id: "templates", text: "Templates" },
      {
        type: "paragraph",
        text: "Prompt and request templates interpolate run variables with `{{path.to.value}}`, resolved against the values produced by earlier steps.",
      },
      { type: "heading", id: "validation", text: "Validation" },
      {
        type: "paragraph",
        text: "A workflow must have exactly one trigger, no cycles, edges that point at real nodes, and valid configuration on every node. Unreachable nodes are reported as warnings. Problems appear in the builder as you edit rather than at run time.",
      },
      { type: "heading", id: "preview", text: "Preview" },
      {
        type: "paragraph",
        text: "The builder has two views of the same workflow. **Build** is the editor. **Preview** draws the workflow as a diagram: every step as a card showing its type, name and a one-line summary, and every connection as an arrow, with both sides of a branch labelled “If true” and “Otherwise”. It reads the definition you are editing, so unsaved changes appear straight away and are marked as such.",
      },
      {
        type: "list",
        items: [
          "**Read-only** — the preview can pan, zoom, fit to view and select a step. It has no way to move, delete, reconnect or reconfigure anything; the editor stays on the Build tab.",
          "**Inspect a step** — selecting a card dims everything that is not upstream or downstream of it, and shows what that step does and what it is connected to. Credentials are never shown: an HTTP step lists its header names, never their values.",
          "**Walkthrough** — the same workflow as a numbered list, with each step's summary and where the run goes next. It is always on the page, works with a keyboard and a screen reader, and is the presentation used on narrow screens where a diagram would be unreadable.",
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Preview is not a run",
        body: "The preview shows what a workflow is, not what a run did. No step on it carries a status, because nothing has executed. Steps the engine only records rather than performs are labelled “Simulated” so a diagram cannot suggest a system was contacted when it was not. For what actually happened, open Runs.",
      },
      { type: "heading", id: "runs", text: "Runs" },
      {
        type: "paragraph",
        text: "Running a workflow records a run with a status and a step-by-step timeline, including each step's output, error and duration. Tool and action steps are simulated unless a step explicitly allows outbound traffic and its target host is on that step's allowlist.",
      },
      {
        type: "callout",
        tone: "info",
        title: "Runs execute inline",
        body: "A run happens inside the request that starts it. That is fine for the short workflows the builder produces today; a queue is the production path for long-running work, and the run row already exists before execution starts so adopting one needs no schema change.",
      },
    ],
  },
  {
    slug: "knowledge",
    title: "Knowledge",
    description: "How collections group your sources into retrievable, cited answers.",
    blocks: [
      {
        type: "paragraph",
        text: "Knowledge turns your content into passages a model can quote. A source is one document; a collection is a named group of them. Attach a collection to a chatbot or an agent and its answers become grounded and citable.",
      },
      { type: "heading", id: "collections", text: "Collections" },
      {
        type: "paragraph",
        text: "A collection is a logical grouping, not a folder. It holds no retrieval settings and no embedding configuration — those belong to the document and to the agent doing the retrieving. What a collection decides is scope: an agent answers from the collections it has been given and from nothing else, which is how “this bot can only answer from HR Policies” becomes a fact about the data rather than a line in a prompt.",
      },
      {
        type: "code",
        language: "text",
        label: "How knowledge is organized",
        code: `Workspace
└── Knowledge
      ├── Collection ── Source, Source, Source
      ├── Collection ── Source
      └── Unorganized ── Source, Source`,
      },
      {
        type: "paragraph",
        text: "A source belongs to at most one collection. Moving it between collections is a metadata change: nothing is re-fetched, re-chunked or re-embedded, so filing your library is cheap no matter how large it is.",
      },
      { type: "heading", id: "unorganized", text: "Unorganized" },
      {
        type: "paragraph",
        text: "A source added without a collection lands in Unorganized. It is fully ingested, chunked, embedded and searchable in the app — but no agent can retrieve from it until you file it. Unorganized is a staging area, deliberately outside every retrieval scope, so nothing becomes answerable by accident just because somebody uploaded it.",
      },
      {
        type: "callout",
        tone: "info",
        title: "Deleting a collection keeps its sources",
        body: "Deleting a collection removes the grouping and its chatbot and agent attachments. The sources in it, and every passage indexed from them, move to Unorganized intact. Deleting a source is the separate, explicit action that destroys content.",
      },
      { type: "heading", id: "lifecycle", text: "The lifecycle" },
      {
        type: "code",
        language: "text",
        label: "Source to answer",
        code: `Source → Ingestion → Processing → Chunking → Embedding → Indexing → Retrieval → Answer`,
      },
      {
        type: "paragraph",
        text: "Each stage is recorded on the source, so a stuck or failed import tells you exactly where it stopped and why.",
      },
      { type: "heading", id: "sources", text: "Source types" },
      {
        type: "table",
        head: ["Type", "Notes"],
        rows: [
          ["Text", "Paste content directly. The most predictable option."],
          ["URL", "The page is fetched server-side, stripped to readable text, with a timeout and a size cap. Private, loopback and link-local addresses are refused."],
          ["File", ".txt, .md, .csv, .json and .html up to 5 MB, read as UTF-8. PDF and DOCX are not supported yet."],
        ],
      },
      { type: "heading", id: "retrieval", text: "Retrieval" },
      {
        type: "paragraph",
        text: "On each turn the question is matched against indexed chunks using PostgreSQL full-text ranking, restricted to the collections the assistant is attached to, and the best passages are passed to the model with their titles, so it can cite them as [1], [2] and so on. A source that is not yet chunked falls back to its own text rather than returning nothing.",
      },
      {
        type: "callout",
        tone: "info",
        title: "Embeddings today",
        body: "Retrieval currently ranks with full-text search, and embeddings are generated by a deterministic local provider so the pipeline is exercised end to end without an external dependency. The retrieval boundary is provider-agnostic, so a vector store can be introduced without changing any caller.",
      },
      { type: "heading", id: "testing", text: "Test retrieval" },
      {
        type: "paragraph",
        text: "The Test tab runs a query against one collection and shows the ranked passages with their scores. It runs exactly the retrieval the chat pipeline runs, so what you see is what the model would be given. Use it to check coverage before attaching the collection to an assistant.",
      },
    ],
  },
  {
    slug: "conversations",
    title: "Conversations",
    description: "One inbox for every channel, with summaries and human replies.",
    blocks: [
      {
        type: "paragraph",
        text: "Every exchange — widget, API, playground or agent run — lands in the same inbox, filterable by status, channel, assistant, contact and assignee. Filters live in the URL, so a filtered view is a link you can share.",
      },
      { type: "heading", id: "detail", text: "Reading a conversation" },
      {
        type: "paragraph",
        text: "The transcript shows each message with its citations and token usage. The side panel carries the channel, the originating chatbot or agent, the linked contact, and the status.",
      },
      { type: "heading", id: "summary", text: "AI summaries" },
      {
        type: "paragraph",
        text: "Generate a summary of a long thread on demand. It is stored with the conversation and can be regenerated.",
      },
      { type: "heading", id: "replies", text: "Replying as a human" },
      {
        type: "paragraph",
        text: "A team member can reply directly in the thread. The message is attributed to that person and rendered as Team, while staying part of the model's context so the assistant does not contradict it later.",
      },
    ],
  },
  {
    slug: "crm",
    title: "CRM",
    description: "Contacts, stages, tags, notes and activity, linked to conversations.",
    blocks: [
      {
        type: "paragraph",
        text: "The CRM holds the people behind the conversations: contacts with a stage, tags, custom properties, notes and a merged activity timeline.",
      },
      { type: "heading", id: "stages", text: "Stages" },
      {
        type: "table",
        head: ["Stage", "Meaning"],
        rows: [
          ["Lead", "Someone who has interacted but is not qualified."],
          ["Prospect", "Qualified and in conversation."],
          ["Customer", "Converted."],
          ["Churned", "Previously a customer."],
        ],
      },
      { type: "heading", id: "activity", text: "Activity" },
      {
        type: "paragraph",
        text: "Stage changes, tag changes, property edits and notes are all recorded, so the timeline explains how a contact reached its current state. Conversations linked to a contact appear on their own tab.",
      },
      { type: "heading", id: "uniqueness", text: "Identity" },
      {
        type: "paragraph",
        text: "Email is normalised and unique per workspace. Creating a contact with an address that already exists returns a conflict rather than a duplicate.",
      },
    ],
  },
  {
    slug: "integrations",
    title: "Integrations",
    description: "Outgoing webhooks, Slack and SMTP, with credentials encrypted at rest.",
    blocks: [
      {
        type: "paragraph",
        text: "Integrations connect a workspace to systems you already run. Each provider declares its own configuration, and anything secret is encrypted before it is stored.",
      },
      { type: "heading", id: "available", text: "Available today" },
      {
        type: "table",
        head: ["Provider", "What it does"],
        rows: [
          ["Webhook", "Posts events to a URL you control, optionally signed."],
          ["Slack", "Posts to an incoming webhook."],
          ["SMTP", "Sends mail through your own server."],
          ["Zapier", "Uses a workspace API key rather than its own credential."],
        ],
      },
      {
        type: "paragraph",
        text: "Google Sheets and HubSpot appear in the catalogue marked as coming, and cannot be connected.",
      },
      { type: "heading", id: "secrets", text: "How credentials are handled" },
      {
        type: "list",
        items: [
          "Secrets are encrypted with AES-256-GCM before they are written, using a key derived from the application secret.",
          "No route ever returns a decrypted secret. The interface shows that one is configured and offers to replace it.",
          "Test requests run server-side, with a timeout, and refuse private, loopback and link-local addresses at every redirect hop.",
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Looking for API keys?",
        body: "Workspace API keys live under Integrations → API keys and are documented in [API authentication](/docs/api/authentication).",
      },
    ],
  },
  {
    slug: "analytics",
    title: "Analytics",
    description: "Conversations, messages, resolution rate and token spend over time.",
    blocks: [
      {
        type: "paragraph",
        text: "Analytics reports what the workspace did over a period — 7, 30 or 90 days — against the period immediately before it, so a number always has something to be compared with.",
      },
      { type: "heading", id: "measures", text: "What is measured" },
      {
        type: "list",
        items: [
          "Conversations and visitor messages over time.",
          "Resolution rate: the share of conversations marked resolved.",
          "Token usage, in and out, including a breakdown by chatbot.",
          "Channel mix across widget, API, playground and agent runs.",
          "Workflow runs, succeeded against failed.",
          "New contacts over the period.",
        ],
      },
      {
        type: "paragraph",
        text: "Every time series is zero-filled in the database, so a quiet day is a gap in the data rather than a missing point on the chart. Each chart can be switched to a table when you want the numbers rather than the shape.",
      },
    ],
  },
];
