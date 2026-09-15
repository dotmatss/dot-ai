#!/usr/bin/env node
/**
 * Development seed: one demo account whose workspace has something in every
 * feature - chatbots, agents, knowledge, MCP servers with their grants and call
 * history, workflows and runs, CRM contacts, conversations and integrations -
 * so every list page renders real rows instead of an empty state.
 *
 * Conversation Intelligence is the exception, and deliberately: its rows are
 * DERIVED, so seeding them directly would fake the one thing worth seeing work.
 * The seed instead plants recurring questions across five subjects with a
 * realistic mix of grounding and hand-offs, and an analysis run produces the
 * topics from them.
 *
 *   pnpm db:seed                 create the demo tenant (no-op if it exists)
 *   SEED_RESET=1 pnpm db:seed    delete the demo organization and rebuild it
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=... pnpm db:seed
 *
 * Everything hangs off one organization, so SEED_RESET only ever deletes what
 * this script created: organizations cascade to every tenant table.
 *
 * Never run against production data.
 */
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(root, file);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // ignore
    }
  }
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed in production.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const email = (process.env.SEED_EMAIL ?? "demo@example.com").toLowerCase();
const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString("base64url");
const teammateEmail = "sam@example.com";
const teammatePassword = randomBytes(9).toString("base64url");
const reset = process.env.SEED_RESET === "1";

// Must match src/server/auth/password.ts
function hashPassword(plain) {
  const salt = randomBytes(16);
  const params = { N: 16384, r: 8, p: 1 };
  return new Promise((resolve, reject) => {
    scryptCallback(plain.normalize("NFKC"), salt, 64, params, (error, derived) => {
      if (error) return reject(error);
      resolve(["scrypt", params.N, params.r, params.p, salt.toString("base64"), derived.toString("base64")].join("$"));
    });
  });
}

/**
 * Mirrors src/features/mcp/server/tool-identity.ts.
 *
 * A grant is stale when its approved_hash no longer equals the tool's
 * content_hash, and both states are worth seeing in the UI, so the seed has to
 * compute the hash exactly the way the application does rather than invent one.
 */
function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = canonicalise(value[key]);
  }
  return out;
}

function toolContentHash(tool) {
  const annotations = {};
  for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
    if (tool.annotations?.[key] !== undefined) annotations[key] = tool.annotations[key];
  }
  const canonical = JSON.stringify(
    canonicalise({
      v: 1,
      name: tool.name,
      description: tool.description ?? null,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? null,
      annotations,
    }),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const client = new pg.Client({ connectionString });

/** jsonb values are sent as text: node-postgres turns a JS array into a Postgres array literal. */
const json = (value) => JSON.stringify(value);

const now = Date.now();
const at = (daysAgo, hoursAgo = 0) => new Date(now - daysAgo * 86_400_000 - hoursAgo * 3_600_000);

async function insert(table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const params = [];
  const tuples = rows.map((row, rowIndex) => {
    const placeholders = columns.map((column, columnIndex) => {
      params.push(row[column]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, params);
}

async function main() {
  await client.connect();
  await client.query("BEGIN");

  if (reset) {
    await client.query("DELETE FROM organizations WHERE slug = 'demo-co'");
    await client.query("DELETE FROM users WHERE email IN ($1, $2)", [email, teammateEmail]);
    console.log("Reset: removed the previous demo organization.");
  }

  const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  let userId = existingUser.rows[0]?.id;
  const createdUser = !userId;
  if (!userId) {
    userId = randomUUID();
    await insert("users", [{ id: userId, email, name: "Demo User", password_hash: await hashPassword(password) }]);
  }

  const existingOrg = await client.query(
    "SELECT o.id FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = $1 LIMIT 1",
    [userId],
  );
  if (existingOrg.rows[0]) {
    const existingWorkspace = await client.query("SELECT slug FROM workspaces WHERE organization_id = $1 LIMIT 1", [
      existingOrg.rows[0].id,
    ]);
    await client.query("COMMIT");
    console.log("Already seeded. Re-run with SEED_RESET=1 to rebuild the demo organization.");
    console.log(`Sign in at /sign-in and open /w/${existingWorkspace.rows[0]?.slug ?? "demo"}/dashboard`);
    return;
  }

  // ------------------------------------------------------------------ identity
  const teammateId = randomUUID();
  await insert("users", [
    { id: teammateId, email: teammateEmail, name: "Sam Rivera", password_hash: await hashPassword(teammatePassword) },
  ]);

  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  await insert("organizations", [{ id: organizationId, name: "Demo Co", slug: "demo-co", created_at: at(45) }]);
  await insert("organization_members", [
    { organization_id: organizationId, user_id: userId, role: "owner" },
    { organization_id: organizationId, user_id: teammateId, role: "member" },
  ]);
  await insert("workspaces", [
    { id: workspaceId, organization_id: organizationId, name: "Demo Workspace", slug: "demo", created_at: at(45) },
  ]);

  const ws = { workspace_id: workspaceId };

  // ----------------------------------------------------------------- knowledge
  const docsCollectionId = randomUUID();
  const policyCollectionId = randomUUID();
  const draftCollectionId = randomUUID();
  await insert("knowledge_collections", [
    { id: docsCollectionId, ...ws, name: "Product Docs", description: "Handbook and API reference.", status: "ready", created_by: userId, created_at: at(40), updated_at: at(4) },
    { id: policyCollectionId, ...ws, name: "Billing Policies", description: "Refunds, trials and invoicing rules.", status: "ready", created_by: userId, created_at: at(32), updated_at: at(6) },
    { id: draftCollectionId, ...ws, name: "Onboarding Drafts", description: "Nothing ingested yet.", status: "empty", created_by: teammateId, created_at: at(6), updated_at: at(6) },
  ]);

  const sourceRows = [
    { id: randomUUID(), collection: docsCollectionId, type: "url", name: "Getting started guide", uri: "https://docs.example.com/getting-started", status: "ready", chunks: 3, tokens: 384 },
    { id: randomUUID(), collection: docsCollectionId, type: "file", name: "api-reference.md", uri: null, status: "ready", chunks: 2, tokens: 512 },
    { id: randomUUID(), collection: policyCollectionId, type: "text", name: "Refund policy", uri: null, status: "ready", chunks: 2, tokens: 220 },
    { id: randomUUID(), collection: policyCollectionId, type: "url", name: "Invoicing FAQ", uri: "https://docs.example.com/billing/faq", status: "failed", chunks: 0, tokens: 0 },
    { id: randomUUID(), collection: docsCollectionId, type: "url", name: "Changelog", uri: "https://docs.example.com/changelog", status: "embedding", chunks: 0, tokens: 0 },
  ];
  await insert(
    "knowledge_sources",
    sourceRows.map((source, index) => ({
      id: source.id,
      ...ws,
      collection_id: source.collection,
      type: source.type,
      name: source.name,
      uri: source.uri,
      content: source.type === "text" ? "Annual plans are refundable within 14 days of purchase. Monthly plans are not." : null,
      status: source.status,
      chunk_count: source.chunks,
      token_count: source.tokens,
      error: source.status === "failed" ? "Fetch failed: 404 Not Found" : null,
      metadata: json(source.uri ? { fetchedAt: at(30 - index).toISOString() } : {}),
      created_at: at(38 - index * 3),
      updated_at: at(30 - index),
    })),
  );

  const chunks = [
    [sourceRows[0], "Create a workspace, invite your team, then connect a chatbot to a knowledge collection."],
    [sourceRows[0], "Every chatbot has an embed key. Paste the snippet before the closing body tag."],
    [sourceRows[0], "Agents differ from chatbots: they can call tools and start workflows on your behalf."],
    [sourceRows[1], "POST /api/v1/conversations starts a conversation and returns a streaming response."],
    [sourceRows[1], "Rate limits are per workspace: 120 requests per minute on the starter plan."],
    [sourceRows[2], "Annual plans are refundable within 14 days. Monthly plans are not refundable."],
    [sourceRows[2], "Trials last 14 days and never auto-convert without a confirmed payment method."],
  ];
  await insert(
    "knowledge_chunks",
    chunks.map(([source, content], index) => ({
      id: randomUUID(),
      ...ws,
      collection_id: source.collection,
      source_id: source.id,
      position: index,
      content,
      token_count: Math.ceil(content.length / 4),
      created_at: at(37),
    })),
  );

  // ------------------------------------------------------------------ chatbots
  const appearance = (primaryColor, launcherLabel) =>
    json({ primaryColor, theme: "light", position: "bottom-right", launcherLabel, avatarUrl: null, showBranding: true });
  const modelConfig = (model, temperature, maxTokens) => json({ model, temperature, maxTokens });

  const supportBotId = randomUUID();
  const salesBotId = randomUUID();
  const docsBotId = randomUUID();
  await insert("chatbots", [
    {
      id: supportBotId, ...ws, name: "Support Assistant", slug: "support-assistant",
      description: "Answers product and billing questions.", status: "active",
      instructions: "You are a friendly support assistant. Keep answers short and cite sources when available.",
      welcome_message: "Hi! How can I help you today?",
      model_config: modelConfig(null, 0.3, 1024), appearance: appearance("#111111", "Chat with us"),
      allowed_domains: ["localhost:3000", "example.com"], embed_key: `cb_${randomBytes(12).toString("base64url")}`,
      created_by: userId, created_at: at(40), updated_at: at(2),
    },
    {
      id: salesBotId, ...ws, name: "Sales Concierge", slug: "sales-concierge",
      description: "Qualifies inbound leads and books demos.", status: "active",
      instructions: "Qualify the visitor, capture their email, and offer a demo slot. Never quote custom pricing.",
      welcome_message: "Looking for a demo? Tell me about your team.",
      model_config: modelConfig("balanced", 0.6, 2048), appearance: appearance("#1d4ed8", "Talk to sales"),
      allowed_domains: ["example.com", "*.example.com"], embed_key: `cb_${randomBytes(12).toString("base64url")}`,
      created_by: userId, created_at: at(28), updated_at: at(1),
    },
    {
      id: docsBotId, ...ws, name: "Docs Helper", slug: "docs-helper",
      description: "Search-only bot for the documentation site.", status: "draft",
      instructions: "Answer strictly from the provided documentation. If it is not covered, say so.",
      welcome_message: "Ask me anything about the docs.",
      model_config: modelConfig("fast", 0.1, 1024), appearance: appearance("#047857", "Search docs"),
      allowed_domains: [], embed_key: `cb_${randomBytes(12).toString("base64url")}`,
      created_by: teammateId, created_at: at(9), updated_at: at(9),
    },
  ]);
  await insert("chatbot_collections", [
    { chatbot_id: supportBotId, collection_id: docsCollectionId, ...ws },
    { chatbot_id: supportBotId, collection_id: policyCollectionId, ...ws },
    { chatbot_id: docsBotId, collection_id: docsCollectionId, ...ws },
  ]);

  // -------------------------------------------------------------------- agents
  const researchAgentId = randomUUID();
  const billingAgentId = randomUUID();
  const onboardingAgentId = randomUUID();
  await insert("agents", [
    {
      id: researchAgentId, ...ws, name: "Research Assistant",
      description: "Looks things up on the web and in our own docs.", status: "active",
      instructions: "Research the question, prefer internal documentation, and always cite what you used.",
      model_config: modelConfig("quality", 0.4, 4096),
      tools: json([
        { toolId: "web_search", enabled: true, config: { maxResults: 5, region: "global" }, requiresApproval: false },
        { toolId: "knowledge_search", enabled: true, config: { maxChunks: 4, requireCitations: true }, requiresApproval: false },
        { source: "mcp", serverSlug: "github", toolName: "search_issues", enabled: true, requiresApproval: false },
      ]),
      memory_config: json({ enabled: true, windowMessages: 20, summarize: true }),
      requires_approval: false, created_by: userId, created_at: at(26), updated_at: at(3),
    },
    {
      id: billingAgentId, ...ws, name: "Billing Triage",
      description: "Triages billing tickets and files the follow-up.", status: "active",
      instructions: "Classify the billing issue, quote the refund policy exactly, and create a contact for follow-up.",
      model_config: modelConfig("balanced", 0.2, 2048),
      tools: json([
        { toolId: "knowledge_search", enabled: true, config: { maxChunks: 3, requireCitations: true }, requiresApproval: false },
        { toolId: "create_contact", enabled: true, config: { dedupeByEmail: true, defaultTag: "billing" }, requiresApproval: false },
        { toolId: "send_email", enabled: false, config: { fromName: "Demo Co Billing", replyTo: "billing@example.com", maxPerTurn: 1 }, requiresApproval: true },
        { source: "mcp", serverSlug: "github", toolName: "create_issue", enabled: true, requiresApproval: true },
      ]),
      memory_config: json({ enabled: true, windowMessages: 12, summarize: false }),
      output_schema: json({
        type: "object",
        properties: { category: { type: "string" }, refundEligible: { type: "boolean" } },
        required: ["category"],
      }),
      requires_approval: true, created_by: userId, created_at: at(18), updated_at: at(1),
    },
    {
      id: onboardingAgentId, ...ws, name: "Onboarding Concierge",
      description: "Walks a new customer through setup. Still being written.", status: "draft",
      instructions: "Greet the customer, confirm their plan, and walk through the first three setup steps.",
      model_config: modelConfig(null, 0.5, 2048),
      tools: json([{ toolId: "knowledge_search", enabled: true, config: { maxChunks: 4, requireCitations: false }, requiresApproval: false }]),
      memory_config: json({ enabled: false, windowMessages: 10, summarize: false }),
      requires_approval: false, created_by: teammateId, created_at: at(5), updated_at: at(5),
    },
  ]);
  await insert("agent_collections", [
    { agent_id: researchAgentId, collection_id: docsCollectionId, ...ws },
    { agent_id: billingAgentId, collection_id: policyCollectionId, ...ws },
    { agent_id: onboardingAgentId, collection_id: docsCollectionId, ...ws },
  ]);

  // ---------------------------------------------------------------------- MCP
  const githubServerId = randomUUID();
  const linearServerId = randomUUID();
  const sandboxServerId = randomUUID();
  await insert("mcp_servers", [
    {
      id: githubServerId, ...ws, name: "GitHub", slug: "github",
      endpoint_url: "https://mcp.example.com/github", transport: "http", auth_kind: "none", status: "active",
      last_probe_at: at(0, 3), last_probe_ok: true, last_probe_message: "4 tools listed", tool_count: 4,
      created_by: userId, created_at: at(20), updated_at: at(0, 3),
    },
    {
      id: linearServerId, ...ws, name: "Linear", slug: "linear",
      endpoint_url: "https://mcp.example.com/linear", transport: "http", auth_kind: "oauth", status: "unauthorized",
      last_probe_at: at(1), last_probe_ok: false, last_probe_message: "401 Unauthorized: authorization required", tool_count: 0,
      created_by: userId, created_at: at(12), updated_at: at(1),
    },
    {
      id: sandboxServerId, ...ws, name: "Sandbox Files", slug: "sandbox-files",
      endpoint_url: "https://mcp.example.com/files", transport: "http", auth_kind: "none", status: "draft",
      last_probe_at: null, last_probe_ok: null, last_probe_message: null, tool_count: 0,
      created_by: teammateId, created_at: at(3), updated_at: at(3),
    },
  ]);

  // The definitions the server advertised, hashed the way the application hashes them.
  const githubTools = [
    {
      name: "search_issues",
      title: "Search issues",
      description: "Search issues and pull requests in the connected repositories.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "create_issue",
      title: "Create issue",
      description: "Open a new issue in a repository.",
      inputSchema: { type: "object", properties: { repo: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["repo", "title"] },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    {
      name: "close_issue",
      title: "Close issue",
      description: "Close an open issue.",
      inputSchema: { type: "object", properties: { repo: { type: "string" }, number: { type: "integer" } }, required: ["repo", "number"] },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "list_repos",
      title: "List repositories",
      // Reworded since it was approved, which is what makes the grant below stale.
      description: "List repositories the token can see, including archived ones.",
      inputSchema: { type: "object", properties: { visibility: { type: "string", enum: ["all", "public", "private"] } } },
      annotations: { readOnlyHint: true },
    },
  ];
  const toolHashes = Object.fromEntries(githubTools.map((tool) => [tool.name, toolContentHash(tool)]));

  await insert(
    "mcp_server_tools",
    githubTools.map((tool) => ({
      id: randomUUID(),
      ...ws,
      mcp_server_id: githubServerId,
      name: tool.name,
      title: tool.title,
      description: tool.description,
      input_schema: json(tool.inputSchema),
      output_schema: null,
      annotations: json(tool.annotations),
      content_hash: toolHashes[tool.name],
      first_seen_at: at(20),
      last_seen_at: at(0, 3),
      removed_at: null,
    })),
  );

  await insert("mcp_tool_grants", [
    { id: randomUUID(), ...ws, mcp_server_id: githubServerId, tool_name: "search_issues", approved_hash: toolHashes.search_issues, risk_class: "read", requires_approval: false, state: "active", granted_by: userId, granted_at: at(19) },
    { id: randomUUID(), ...ws, mcp_server_id: githubServerId, tool_name: "create_issue", approved_hash: toolHashes.create_issue, risk_class: "write", requires_approval: true, state: "active", granted_by: userId, granted_at: at(19) },
    { id: randomUUID(), ...ws, mcp_server_id: githubServerId, tool_name: "close_issue", approved_hash: toolHashes.close_issue, risk_class: "destructive", requires_approval: true, state: "active", granted_by: userId, granted_at: at(17) },
    // Approved against the older description, so this grant reads as stale.
    {
      id: randomUUID(), ...ws, mcp_server_id: githubServerId, tool_name: "list_repos",
      approved_hash: toolContentHash({ ...githubTools[3], description: "List repositories the token can see." }),
      risk_class: "read", requires_approval: false, state: "stale", granted_by: userId, granted_at: at(16),
    },
  ]);

  const mcpCalls = [
    { tool: "search_issues", status: "executed", resolution: "resolved", risk: "read", args: { query: "billing webhook retry", limit: 5 }, result: { count: 3, issues: ["#412 Retry storm on webhook 5xx", "#388 Backoff not applied", "#301 Duplicate invoice events"] }, duration: 412, agent: researchAgentId, decided: null, days: 0 },
    { tool: "search_issues", status: "executed", resolution: "resolved", risk: "read", args: { query: "refund policy annual" }, result: { count: 1, issues: ["#455 Clarify annual refund window"] }, duration: 287, agent: researchAgentId, decided: null, days: 1 },
    { tool: "create_issue", status: "awaiting_approval", resolution: "approval_required", risk: "write", args: { repo: "demo-co/platform", title: "Invoice PDF missing VAT line", body: "Reported by acme@example.com in conversation." }, result: null, duration: null, agent: billingAgentId, decided: null, days: 0 },
    { tool: "close_issue", status: "denied", resolution: "approval_required", risk: "destructive", args: { repo: "demo-co/platform", number: 388 }, result: null, duration: null, agent: billingAgentId, decided: userId, days: 2 },
    { tool: "list_repos", status: "refused", resolution: "stale_grant", risk: "read", args: { visibility: "all" }, result: null, duration: null, agent: researchAgentId, decided: null, days: 1 },
    { tool: "create_issue", status: "failed", resolution: "resolved", risk: "write", args: { repo: "demo-co/platform", title: "Trial expiry email not sent" }, result: null, duration: 5013, agent: billingAgentId, decided: userId, days: 4 },
  ];
  await insert(
    "mcp_tool_calls",
    mcpCalls.map((call) => ({
      id: randomUUID(),
      ...ws,
      mcp_server_id: githubServerId,
      agent_id: call.agent,
      conversation_id: null,
      tool_ref: `mcp.github.${call.tool}`,
      tool_name: call.tool,
      status: call.status,
      resolution: call.resolution,
      risk_class: call.risk,
      approved_hash: toolHashes[call.tool],
      arguments: json(call.args),
      result: call.result ? json(call.result) : null,
      result_bytes: call.result ? JSON.stringify(call.result).length : null,
      result_truncated: false,
      is_error: call.status === "failed",
      error_message: call.status === "failed" ? "Upstream timed out after 5000ms" : null,
      duration_ms: call.duration,
      requested_by: userId,
      decided_by: call.decided,
      decided_at: call.decided ? at(call.days) : null,
      created_at: at(call.days, 2),
      updated_at: at(call.days, 1),
    })),
  );

  // ----------------------------------------------------------------- workflows
  const leadWorkflowId = randomUUID();
  const triageWorkflowId = randomUUID();
  const digestWorkflowId = randomUUID();

  const leadDefinition = {
    nodes: [
      { id: "trigger", type: "trigger.webhook", label: "Website form", config: { path: "incoming-lead", requireSignature: true }, position: { x: 0, y: 0 } },
      { id: "classify", type: "ai.classify", label: "Qualify the lead", config: { input: "{{trigger.message}}", categories: ["qualified", "not_qualified"], instructions: "Qualified means a team of 10 or more.", fallbackCategory: "not_qualified", model: "", outputKey: "category" }, position: { x: 240, y: 0 } },
      { id: "branch", type: "condition.branch", label: "Qualified?", config: { left: "{{vars.category}}", operator: "equals", right: "qualified", caseSensitive: false }, position: { x: 480, y: 0 } },
      { id: "contact", type: "action.create_contact", label: "Create contact", config: { email: "{{input.email}}", name: "{{input.name}}", company: "{{input.company}}", stage: "prospect", tags: ["inbound"] }, position: { x: 720, y: -80 } },
      { id: "respond", type: "output.respond", label: "Thank them", config: { message: "Thanks! Someone from our team will be in touch within one business day.", outputKey: "message" }, position: { x: 960, y: 0 } },
    ],
    edges: [
      { id: "e1", from: "trigger", to: "classify" },
      { id: "e2", from: "classify", to: "branch" },
      { id: "e3", from: "branch", to: "contact", condition: "true" },
      { id: "e4", from: "branch", to: "respond", condition: "false" },
      { id: "e5", from: "contact", to: "respond" },
    ],
  };

  const triageDefinition = {
    nodes: [
      { id: "start", type: "trigger.conversation_started", label: "New conversation", config: { channel: "widget", keyword: "" }, position: { x: 0, y: 0 } },
      { id: "summarise", type: "ai.generate", label: "Summarise the issue", config: { prompt: "Summarise this support request in one sentence: {{input.message}}", system: "", model: "fast", temperature: 0.2, maxTokens: 512, outputKey: "summary" }, position: { x: 240, y: 0 } },
      { id: "notify", type: "action.send_notification", label: "Notify the team", config: { channel: "in_app", to: "support@example.com", subject: "New support conversation", message: "{{nodes.summarise.text}}" }, position: { x: 480, y: 0 } },
      { id: "reply", type: "output.respond", label: "Acknowledge", config: { message: "Thanks for reaching out. A specialist is reviewing your message now.", outputKey: "message" }, position: { x: 720, y: 0 } },
    ],
    edges: [
      { id: "e1", from: "start", to: "summarise" },
      { id: "e2", from: "summarise", to: "notify" },
      { id: "e3", from: "notify", to: "reply" },
    ],
  };

  const digestDefinition = {
    nodes: [
      { id: "manual", type: "trigger.manual", label: "Run by hand", config: { note: "Run every Monday morning." }, position: { x: 0, y: 0 } },
      { id: "fetch", type: "tool.http_request", label: "Fetch usage", config: { url: "https://api.example.com/reports/weekly", method: "GET", headers: {}, bodyTemplate: "", allowOutbound: false, allowedHosts: ["api.example.com"], timeoutMs: 5000 }, position: { x: 240, y: 0 } },
      { id: "write", type: "ai.generate", label: "Write the digest", config: { prompt: "Turn this JSON into a short weekly digest: {{nodes.fetch.body}}", system: "", model: "", temperature: 0.3, maxTokens: 1024, outputKey: "generated" }, position: { x: 480, y: 0 } },
      { id: "done", type: "output.respond", label: "Return the digest", config: { message: "{{nodes.write.text}}", outputKey: "digest" }, position: { x: 720, y: 0 } },
    ],
    edges: [
      { id: "e1", from: "manual", to: "fetch" },
      { id: "e2", from: "fetch", to: "write" },
      { id: "e3", from: "write", to: "done" },
    ],
  };

  await insert("workflows", [
    { id: leadWorkflowId, ...ws, name: "Lead capture", description: "Qualifies a website lead and files it in the CRM.", status: "active", definition: json(leadDefinition), version: 4, created_by: userId, created_at: at(30), updated_at: at(2) },
    { id: triageWorkflowId, ...ws, name: "Support triage", description: "Summarises a new conversation and notifies the team.", status: "active", definition: json(triageDefinition), version: 2, created_by: userId, created_at: at(22), updated_at: at(5) },
    { id: digestWorkflowId, ...ws, name: "Weekly digest", description: "Pulls usage numbers and drafts the Monday digest.", status: "draft", definition: json(digestDefinition), version: 1, created_by: teammateId, created_at: at(7), updated_at: at(7) },
  ]);

  const step = (nodeId, type, label, status, minutesAgo, output, error = null) => ({
    nodeId,
    type,
    label,
    status,
    startedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    finishedAt: new Date(now - (minutesAgo - 1) * 60_000).toISOString(),
    output,
    error,
  });

  await insert("workflow_runs", [
    {
      id: randomUUID(), ...ws, workflow_id: leadWorkflowId, status: "succeeded",
      trigger: json({ kind: "webhook", label: "incoming-lead" }),
      input: json({ email: "dana@northwind.example", name: "Dana Whitfield", company: "Northwind", message: "We are 40 people and need SSO." }),
      output: json({ message: "Thanks! Someone from our team will be in touch within one business day.", category: "qualified" }),
      steps: json([
        step("trigger", "trigger.webhook", "Website form", "succeeded", 180, { received: true }),
        step("classify", "ai.classify", "Qualify the lead", "succeeded", 179, { category: "qualified" }),
        step("branch", "condition.branch", "Qualified?", "succeeded", 178, { taken: "true" }),
        step("contact", "action.create_contact", "Create contact", "succeeded", 177, { contactCreated: true }),
        step("respond", "output.respond", "Thank them", "succeeded", 176, { message: "Thanks!" }),
      ]),
      error: null, started_at: at(0, 3), finished_at: at(0, 2), created_at: at(0, 3),
    },
    {
      id: randomUUID(), ...ws, workflow_id: leadWorkflowId, status: "failed",
      trigger: json({ kind: "webhook", label: "incoming-lead" }),
      input: json({ email: "not-an-email", message: "hello" }),
      output: null,
      steps: json([
        step("trigger", "trigger.webhook", "Website form", "succeeded", 2880, { received: true }),
        step("classify", "ai.classify", "Qualify the lead", "succeeded", 2879, { category: "not_qualified" }),
        step("branch", "condition.branch", "Qualified?", "succeeded", 2878, { taken: "false" }),
        step("contact", "action.create_contact", "Create contact", "failed", 2877, null, "Invalid email address"),
      ]),
      error: "Invalid email address", started_at: at(2), finished_at: at(2), created_at: at(2),
    },
    {
      id: randomUUID(), ...ws, workflow_id: triageWorkflowId, status: "succeeded",
      trigger: json({ kind: "conversation", label: "Support Assistant" }),
      input: json({ message: "My invoice is missing the VAT line." }),
      output: json({ message: "Thanks for reaching out. A specialist is reviewing your message now." }),
      steps: json([
        step("start", "trigger.conversation_started", "New conversation", "succeeded", 600, { conversationStarted: true }),
        step("summarise", "ai.generate", "Summarise the issue", "succeeded", 599, { text: "Customer reports a missing VAT line on their invoice." }),
        step("notify", "action.send_notification", "Notify the team", "succeeded", 598, { delivered: true }),
        step("reply", "output.respond", "Acknowledge", "succeeded", 597, { message: "Thanks for reaching out." }),
      ]),
      error: null, started_at: at(0, 10), finished_at: at(0, 9), created_at: at(0, 10),
    },
    {
      id: randomUUID(), ...ws, workflow_id: triageWorkflowId, status: "waiting_approval",
      trigger: json({ kind: "conversation", label: "Billing Triage" }),
      input: json({ message: "Please close my account and refund the year." }),
      output: null,
      steps: json([
        step("start", "trigger.conversation_started", "New conversation", "succeeded", 60, { conversationStarted: true }),
        step("summarise", "ai.generate", "Summarise the issue", "succeeded", 59, { text: "Customer asks to cancel and refund an annual plan." }),
      ]),
      error: null, started_at: at(0, 1), finished_at: null, created_at: at(0, 1),
    },
    {
      id: randomUUID(), ...ws, workflow_id: triageWorkflowId, status: "cancelled",
      trigger: json({ kind: "manual", label: "Demo User" }),
      input: json({ message: "test run" }),
      output: null,
      steps: json([step("start", "trigger.conversation_started", "New conversation", "succeeded", 7200, { conversationStarted: true })]),
      error: null, started_at: at(5), finished_at: at(5), created_at: at(5),
    },
  ]);

  // ----------------------------------------------------------------------- CRM
  const contactRows = [
    { id: randomUUID(), email: "dana@northwind.example", name: "Dana Whitfield", company: "Northwind", phone: "+1 415 555 0136", stage: "prospect", source: "website", tags: ["inbound", "sso"], properties: { seats: 40, plan: "trial" }, ai_summary: "Evaluating for 40 seats; blocked on SSO availability.", days: 3 },
    { id: randomUUID(), email: "acme@example.com", name: "Jordan Pike", company: "Acme Industrial", phone: null, stage: "customer", source: "widget", tags: ["billing"], properties: { seats: 120, plan: "annual" }, ai_summary: "Long-standing annual customer; recent invoice formatting complaint.", days: 1 },
    { id: randomUUID(), email: "lee@brightpath.example", name: "Lee Okafor", company: "Brightpath", phone: "+44 20 7946 0812", stage: "lead", source: "sales-concierge", tags: ["inbound"], properties: { seats: 8 }, ai_summary: null, days: 6 },
    { id: randomUUID(), email: "mira@helios.example", name: "Mira Castellanos", company: "Helios Labs", phone: null, stage: "customer", source: "referral", tags: ["expansion"], properties: { seats: 25, plan: "annual" }, ai_summary: "Asked about adding a second workspace for their research team.", days: 9 },
    { id: randomUUID(), email: "tom@oldmill.example", name: "Tom Byrne", company: "Old Mill Co", phone: null, stage: "churned", source: "website", tags: ["price"], properties: { seats: 5, churnReason: "price" }, ai_summary: "Left for a cheaper tool after the trial.", days: 21 },
    { id: randomUUID(), email: "priya@vantage.example", name: "Priya Nandakumar", company: "Vantage", phone: "+1 206 555 0173", stage: "prospect", source: "demo-request", tags: ["enterprise", "security-review"], properties: { seats: 300 }, ai_summary: "Security review in progress; asked for the RLS documentation.", days: 4 },
  ];
  await insert(
    "contacts",
    contactRows.map((contact) => ({
      id: contact.id, ...ws, email: contact.email, name: contact.name, phone: contact.phone, company: contact.company,
      stage: contact.stage, source: contact.source, tags: contact.tags, properties: json(contact.properties),
      ai_summary: contact.ai_summary, last_seen_at: at(contact.days), created_at: at(contact.days + 10), updated_at: at(contact.days),
    })),
  );

  await insert("contact_notes", [
    { id: randomUUID(), ...ws, contact_id: contactRows[0].id, author_id: userId, body: "Wants SSO before signing. Sent the security overview and the RLS notes.", created_at: at(3) },
    { id: randomUUID(), ...ws, contact_id: contactRows[1].id, author_id: teammateId, body: "Invoice PDF is missing the VAT line. Filed with engineering.", created_at: at(1) },
    { id: randomUUID(), ...ws, contact_id: contactRows[5].id, author_id: userId, body: "Security questionnaire returned; two follow-ups on data residency.", created_at: at(4) },
  ]);

  await insert("contact_activities", [
    { id: randomUUID(), ...ws, contact_id: contactRows[0].id, type: "workflow", description: "Created by the Lead capture workflow", metadata: json({ workflow: "Lead capture" }), created_at: at(3) },
    { id: randomUUID(), ...ws, contact_id: contactRows[1].id, type: "conversation", description: "Started a conversation with Support Assistant", metadata: json({ channel: "widget" }), created_at: at(1) },
    { id: randomUUID(), ...ws, contact_id: contactRows[1].id, type: "stage_change", description: "Stage changed from prospect to customer", metadata: json({ from: "prospect", to: "customer" }), created_at: at(14) },
    { id: randomUUID(), ...ws, contact_id: contactRows[3].id, type: "email", description: "Sent the expansion pricing sheet", metadata: json({ subject: "Adding a second workspace" }), created_at: at(9) },
  ]);

  // --------------------------------------------------------------- conversations
  const conversationRows = [
    {
      id: randomUUID(), chatbot_id: supportBotId, agent_id: null, contact_id: contactRows[1].id, channel: "widget", status: "resolved",
      title: "Invoice missing VAT line", assigned_to: teammateId, days: 1,
      messages: [
        { role: "user", content: "My latest invoice is missing the VAT line. Can you resend it?" },
        { role: "assistant", content: "I can help with that. Invoices are regenerated from the billing portal, and VAT appears once a tax ID is on file. I can see one is missing on your account.", sources: [{ id: "src-faq", title: "Invoicing FAQ", snippet: "VAT appears on invoices once a tax ID is saved on the workspace.", uri: "https://docs.example.com/billing/faq", score: 0.82 }], usage: { inputTokens: 412, outputTokens: 96 } },
        { role: "user", content: "Where do I add the tax ID?" },
        { role: "assistant", content: "Settings → Billing → Tax details. Add it there and I will regenerate the invoice for you.", usage: { inputTokens: 480, outputTokens: 42 } },
      ],
    },
    {
      id: randomUUID(), chatbot_id: salesBotId, agent_id: null, contact_id: contactRows[0].id, channel: "widget", status: "open",
      title: "SSO for a 40 person team", assigned_to: null, days: 3,
      messages: [
        { role: "user", content: "Do you support SAML SSO? We are about 40 people." },
        { role: "assistant", content: "SSO is on the roadmap for the Business plan. For a team of 40 I would set up a call with our team - what timezone are you in?", usage: { inputTokens: 322, outputTokens: 58 } },
        { role: "user", content: "Pacific. Mornings work best." },
      ],
    },
    {
      id: randomUUID(), chatbot_id: null, agent_id: researchAgentId, contact_id: null, channel: "playground", status: "open",
      title: "Retry storm investigation", assigned_to: userId, days: 0,
      messages: [
        { role: "user", content: "What do we know about the webhook retry storm?" },
        { role: "tool", content: '{"count":3,"issues":["#412 Retry storm on webhook 5xx","#388 Backoff not applied","#301 Duplicate invoice events"]}', tool_calls: [{ id: "call_1", name: "mcp.github.search_issues", arguments: { query: "billing webhook retry", limit: 5 } }] },
        { role: "assistant", content: "Three open issues cover it: #412 is the retry storm itself, #388 is the missing backoff, and #301 is the duplicate invoice events it caused. #388 looks like the root cause.", sources: [{ id: "src-api", title: "api-reference.md", snippet: "Rate limits are per workspace: 120 requests per minute on the starter plan.", uri: null, score: 0.44 }], usage: { inputTokens: 1180, outputTokens: 148 } },
      ],
    },
    {
      id: randomUUID(), chatbot_id: null, agent_id: billingAgentId, contact_id: contactRows[4].id, channel: "agent", status: "escalated",
      title: "Refund request for an annual plan", assigned_to: userId, days: 2,
      messages: [
        { role: "system", content: "Classify the billing issue and quote the refund policy exactly." },
        { role: "user", content: "I cancelled last week and want the full year refunded." },
        { role: "assistant", content: "Annual plans are refundable within 14 days of purchase; this purchase was 11 months ago, so it falls outside the policy. I am escalating this to a person to review.", sources: [{ id: "src-policy", title: "Refund policy", snippet: "Annual plans are refundable within 14 days. Monthly plans are not refundable.", uri: null, score: 0.91 }], usage: { inputTokens: 640, outputTokens: 88 } },
      ],
    },
  ];

  await insert(
    "conversations",
    conversationRows.map((conversation) => ({
      id: conversation.id, ...ws, chatbot_id: conversation.chatbot_id, agent_id: conversation.agent_id,
      contact_id: conversation.contact_id, channel: conversation.channel, status: conversation.status,
      title: conversation.title, message_count: conversation.messages.length,
      last_message_at: at(conversation.days), metadata: json({}), assigned_to: conversation.assigned_to,
      created_at: at(conversation.days, 1), updated_at: at(conversation.days),
    })),
  );

  await insert(
    "messages",
    conversationRows.flatMap((conversation) =>
      conversation.messages.map((message, index) => ({
        id: randomUUID(),
        ...ws,
        conversation_id: conversation.id,
        role: message.role,
        content: message.content,
        sources: message.sources ? json(message.sources) : null,
        tool_calls: message.tool_calls ? json(message.tool_calls) : null,
        usage: message.usage ? json(message.usage) : null,
        created_at: new Date(at(conversation.days, 1).getTime() + index * 60_000),
      })),
    ),
  );

  // ------------------------------------------------- recurring question volume
  // The four conversations above are each about something different, which is
  // realistic for a transcript reader and useless for Conversation Intelligence:
  // clustering needs repetition before a topic means anything, and the knowledge
  // gap threshold needs at least three conversations on a subject before it will
  // call one. So this block adds recurring questions on five subjects, with the
  // mix that makes the Intelligence page tell the truth about a support bot:
  //
  //   - "Refund timing" is well covered - most replies cite the refund policy.
  //   - "SSO and SAML" is a knowledge gap - nothing in the knowledge base
  //     answers it, so every reply is ungrounded, and several were handed off.
  //   - "Rate limits" is covered and almost entirely contained.
  //   - "Password reset" is a gap that also escalates.
  //   - "Invoice VAT" is mixed.
  //
  // Nothing here is special-cased by the analysis. These are ordinary
  // conversations and messages; the topics, the coverage and the containment
  // rate are all derived from them by a run like any other.
  const THEMES = [
    {
      subject: "refund",
      grounded: true,
      questions: [
        "How long does a refund take to reach my card",
        "How long do refunds usually take",
        "When will my refund actually arrive",
        "Refund was approved last week, where is the money",
        "How long does a refund take to show up on a statement",
        "Can you tell me how long refunds take",
      ],
      answer: "Refunds are returned to the original payment method and typically settle within five to ten business days.",
      source: { id: "src-policy", title: "Refund policy", snippet: "Refunds settle to the original payment method within 5-10 business days.", uri: null, score: 0.88 },
    },
    {
      subject: "sso",
      grounded: false,
      questions: [
        "Do you support SAML single sign on",
        "Is SAML SSO available on your plans",
        "We need SSO before we can roll this out",
        "Can we connect Okta for single sign on",
        "Does your product do SSO with Azure AD",
        "Is single sign on supported anywhere",
        "Any timeline on SAML support",
      ],
      answer: "I do not have a documented answer on single sign-on. Let me pass this to someone who can confirm.",
      handOffEvery: 2,
    },
    {
      subject: "rate limits",
      grounded: true,
      questions: [
        "What are the API rate limits",
        "How many API requests per minute can I make",
        "What is the rate limit on the starter plan",
        "Am I going to hit a rate limit at 100 requests a minute",
        "Where are the API rate limits documented",
      ],
      answer: "Rate limits are applied per workspace: 120 requests per minute on the starter plan.",
      source: { id: "src-api", title: "api-reference.md", snippet: "Rate limits are per workspace: 120 requests per minute on the starter plan.", uri: null, score: 0.79 },
    },
    {
      subject: "password reset",
      grounded: false,
      questions: [
        "How do I reset my password",
        "I cannot reset my password, the email never arrives",
        "Password reset link does not work",
        "How do I reset my password on mobile",
        "Reset password email goes to spam every time",
      ],
      answer: "I could not find anything covering password resets. I am escalating this so somebody can look at your account.",
      escalateEvery: 2,
    },
    {
      subject: "invoice vat",
      grounded: true,
      questions: [
        "My invoice is missing the VAT line",
        "Why is there no VAT on my invoice",
        "How do I get VAT shown on invoices",
        "Invoice has no tax id or VAT on it",
      ],
      answer: "VAT appears on an invoice once a tax ID is saved on the workspace, under Settings then Billing.",
      source: { id: "src-faq", title: "Invoicing FAQ", snippet: "VAT appears on invoices once a tax ID is saved on the workspace.", uri: "https://docs.example.com/billing/faq", score: 0.84 },
      groundedEvery: 2,
    },
  ];

  const volumeConversations = [];
  const volumeMessages = [];
  let spread = 0;

  for (const theme of THEMES) {
    theme.questions.forEach((question, index) => {
      // Spread across the last 28 days so the default 30-day window covers them
      // and a topic's "last seen" is a real date rather than all-of-them-today.
      spread += 1;
      const daysAgo = (spread * 3) % 28;
      const conversationId = randomUUID();
      const startedAt = at(daysAgo, 2);
      const endedAt = at(daysAgo, 1);

      const handedOff = theme.handOffEvery ? index % theme.handOffEvery === 0 : false;
      const escalated = theme.escalateEvery ? index % theme.escalateEvery === 0 : false;
      const grounded = theme.groundedEvery ? index % theme.groundedEvery === 0 : Boolean(theme.grounded);

      volumeConversations.push({
        id: conversationId,
        ...ws,
        chatbot_id: supportBotId,
        agent_id: null,
        contact_id: null,
        channel: "widget",
        // A thread somebody replied to is left open here; the analysis reads the
        // human reply, not this column, when deciding it was a hand-off.
        status: escalated ? "escalated" : handedOff ? "open" : "resolved",
        title: question.slice(0, 60),
        message_count: handedOff ? 3 : 2,
        last_message_at: endedAt,
        metadata: json({}),
        assigned_to: handedOff ? teammateId : null,
        created_at: startedAt,
        updated_at: endedAt,
      });

      volumeMessages.push({
        id: randomUUID(),
        ...ws,
        conversation_id: conversationId,
        role: "user",
        content: question,
        sources: null,
        tool_calls: null,
        usage: null,
        author_id: null,
        created_at: startedAt,
      });

      volumeMessages.push({
        id: randomUUID(),
        ...ws,
        conversation_id: conversationId,
        role: "assistant",
        content: theme.answer,
        sources: grounded && theme.source ? json([theme.source]) : null,
        tool_calls: null,
        usage: json({ inputTokens: 300 + index * 7, outputTokens: 60 + index * 3 }),
        author_id: null,
        created_at: new Date(startedAt.getTime() + 60_000),
      });

      if (handedOff) {
        volumeMessages.push({
          id: randomUUID(),
          ...ws,
          conversation_id: conversationId,
          role: "assistant",
          content: "Hi, this is Sam from the team. SSO is not available yet - I can let you know the moment it ships.",
          sources: null,
          tool_calls: null,
          usage: null,
          // An author makes it a human reply, which is what the analysis counts.
          author_id: teammateId,
          created_at: endedAt,
        });
      }
    });
  }

  await insert("conversations", volumeConversations);
  await insert("messages", volumeMessages);

  // --------------------------------------------------------------- invitation
  // One live invitation so the Members tab is not empty. The database keeps only
  // the hash of the token, so the usable link is printed once, below.
  const inviteToken = randomBytes(32).toString("base64url");
  await insert("organization_invitations", [
    {
      id: randomUUID(),
      organization_id: organizationId,
      email: "taylor@example.com",
      role: "member",
      token_hash: createHash("sha256").update(inviteToken).digest("hex"),
      invited_by: userId,
      expires_at: new Date(now + 7 * 86_400_000),
      created_at: at(1),
    },
  ]);

  // -------------------------------------------------------------- integrations
  await insert("integrations", [
    { id: randomUUID(), ...ws, provider: "slack", name: "Slack - #support", status: "connected", config: json({ channel: "#support", notifyOn: ["escalated"] }), secret_ref: null, created_by: userId, created_at: at(24), updated_at: at(2), last_test_at: at(2), last_test_ok: true, last_test_message: "Posted a test message to #support" },
    { id: randomUUID(), ...ws, provider: "hubspot", name: "HubSpot CRM", status: "disconnected", config: json({ syncContacts: true }), secret_ref: null, created_by: userId, created_at: at(15), updated_at: at(15), last_test_at: null, last_test_ok: null, last_test_message: null },
    { id: randomUUID(), ...ws, provider: "sendgrid", name: "SendGrid", status: "error", config: json({ fromAddress: "support@example.com" }), secret_ref: null, created_by: teammateId, created_at: at(11), updated_at: at(3), last_test_at: at(3), last_test_ok: false, last_test_message: "403 Forbidden: sender identity not verified" },
  ]);

  // -------------------------------------------------------- usage and activity
  const usageEvents = [];
  for (let day = 0; day < 14; day++) {
    usageEvents.push(
      { ...ws, kind: "message", quantity: 40 + ((day * 13) % 35), ref_type: "chatbot", ref_id: supportBotId, occurred_at: at(day) },
      { ...ws, kind: "message", quantity: 12 + ((day * 7) % 18), ref_type: "chatbot", ref_id: salesBotId, occurred_at: at(day) },
      { ...ws, kind: "agent_run", quantity: 3 + ((day * 5) % 9), ref_type: "agent", ref_id: researchAgentId, occurred_at: at(day) },
      { ...ws, kind: "workflow_run", quantity: 2 + (day % 4), ref_type: "workflow", ref_id: leadWorkflowId, occurred_at: at(day) },
    );
  }
  await insert("usage_events", usageEvents);

  await insert("activity_log", [
    { ...ws, actor_id: userId, entity_type: "chatbot", entity_id: supportBotId, action: "created", summary: "Created chatbot “Support Assistant”", metadata: json({}), created_at: at(40) },
    { ...ws, actor_id: userId, entity_type: "chatbot", entity_id: salesBotId, action: "published", summary: "Published chatbot “Sales Concierge”", metadata: json({}), created_at: at(28) },
    { ...ws, actor_id: userId, entity_type: "agent", entity_id: researchAgentId, action: "created", summary: "Created agent “Research Assistant”", metadata: json({}), created_at: at(26) },
    { ...ws, actor_id: userId, entity_type: "mcp_server", entity_id: githubServerId, action: "connected", summary: "Connected MCP server “GitHub”", metadata: json({ tools: 4 }), created_at: at(20) },
    { ...ws, actor_id: userId, entity_type: "mcp_tool", entity_id: githubServerId, action: "granted", summary: "Granted “close_issue” as destructive, approval required", metadata: json({ tool: "close_issue" }), created_at: at(17) },
    { ...ws, actor_id: userId, entity_type: "workflow", entity_id: leadWorkflowId, action: "activated", summary: "Activated workflow “Lead capture”", metadata: json({ version: 4 }), created_at: at(2) },
    { ...ws, actor_id: teammateId, entity_type: "knowledge_collection", entity_id: policyCollectionId, action: "updated", summary: "Re-ingested “Billing Policies”", metadata: json({}), created_at: at(6) },
    { ...ws, actor_id: userId, entity_type: "mcp_tool_call", entity_id: null, action: "denied", summary: "Denied “close_issue” on demo-co/platform#388", metadata: json({ tool: "close_issue" }), created_at: at(2) },
  ]);

  await client.query("COMMIT");

  const counts = await client.query(
    `SELECT
       (SELECT count(*) FROM chatbots WHERE workspace_id = $1) AS chatbots,
       (SELECT count(*) FROM agents WHERE workspace_id = $1) AS agents,
       (SELECT count(*) FROM knowledge_collections WHERE workspace_id = $1) AS collections,
       (SELECT count(*) FROM knowledge_sources WHERE workspace_id = $1) AS sources,
       (SELECT count(*) FROM mcp_servers WHERE workspace_id = $1) AS mcp_servers,
       (SELECT count(*) FROM mcp_server_tools WHERE workspace_id = $1) AS mcp_tools,
       (SELECT count(*) FROM mcp_tool_grants WHERE workspace_id = $1) AS mcp_grants,
       (SELECT count(*) FROM mcp_tool_calls WHERE workspace_id = $1) AS mcp_calls,
       (SELECT count(*) FROM workflows WHERE workspace_id = $1) AS workflows,
       (SELECT count(*) FROM workflow_runs WHERE workspace_id = $1) AS runs,
       (SELECT count(*) FROM contacts WHERE workspace_id = $1) AS contacts,
       (SELECT count(*) FROM conversations WHERE workspace_id = $1) AS conversations,
       (SELECT count(*) FROM messages WHERE workspace_id = $1) AS messages,
       (SELECT count(*) FROM integrations WHERE workspace_id = $1) AS integrations`,
    [workspaceId],
  );

  console.log("\nSeeded Demo Workspace:");
  for (const [key, value] of Object.entries(counts.rows[0])) console.log(`  ${key.padEnd(14)} ${value}`);
  console.log("\nSign in at /sign-in, then open /w/demo/dashboard");
  console.log(`  owner   ${email} / ${createdUser ? password : "(unchanged)"}`);
  console.log(`  member  ${teammateEmail} / ${teammatePassword}`);
}

main()
  .catch(async (error) => {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
