import type { DocPage } from "@/features/docs/types";

export const DEPLOY_PAGES: DocPage[] = [
  {
    slug: "embed",
    title: "Website embed",
    description: "Put the assistant on your own site with a script tag and an allowed-domain list.",
    blocks: [
      {
        type: "paragraph",
        text: "The embed is the fastest way to ship. A small loader script adds a launcher and an iframe; everything else runs inside that frame, so no platform credential ever reaches your page.",
      },
      { type: "heading", id: "install", text: "Install" },
      {
        type: "steps",
        items: [
          { title: "Open Deploy", body: "On your chatbot, go to the Deploy tab." },
          {
            title: "Allow your domains",
            body: "Add each hostname that may use the widget. `www.example.com` matches exactly; `*.example.com` matches its subdomains. A bare entry does not cover subdomains.",
          },
          { title: "Activate the chatbot", body: "The widget loads but will not answer until the chatbot is Active." },
          { title: "Copy the snippet", body: "Paste it before the closing </body> tag on every page that should show the chat." },
        ],
      },
      {
        type: "code",
        language: "html",
        label: "index.html",
        code: `<script
  src="https://app.example.com/embed/widget.js"
  data-chatbot="cb_YOUR_EMBED_KEY"
  data-color="#111111"
  data-label="Chat with us"
  data-position="bottom-right"
  async
></script>`,
      },
      { type: "heading", id: "attributes", text: "Script attributes" },
      {
        type: "table",
        head: ["Attribute", "Required", "Purpose"],
        rows: [
          ["data-chatbot", "Yes", "The chatbot's embed key. A public identifier, safe to publish."],
          ["data-color", "No", "Launcher and header colour. Text contrast is chosen automatically."],
          ["data-label", "No", "Launcher label."],
          ["data-position", "No", "`bottom-right` (default) or `bottom-left`."],
        ],
      },
      { type: "heading", id: "security", text: "What protects it" },
      {
        type: "list",
        items: [
          "The embed key identifies a chatbot. It is not a credential and grants nothing beyond chatting with a chatbot you have published.",
          "The iframe document is served only when the chatbot is active and the requesting page's origin is on the allowed-domain list.",
          "That decision is carried in a short-lived signed token which the chat endpoint re-checks on every message.",
          "Application pages refuse to be framed; only the embed route may be.",
          "Requests are bounded by ceilings keyed on your workspace and chatbot, so a busy page cannot run up an unbounded bill.",
        ],
      },
      {
        type: "callout",
        tone: "warning",
        title: "Allowed domains are a browser-facing control",
        body: "The parent page's origin is taken from the Referer header, which a browser sets honestly and a non-browser client can forge. Treat the list as protection against your widget being embedded on someone else's site, not as an API-level access control. Server-to-server callers should use an API key instead, where the credential is the boundary.",
      },
      { type: "heading", id: "preview", text: "Previewing before you publish" },
      {
        type: "paragraph",
        text: "Members of the workspace can open the widget from the Deploy tab even while the chatbot is a draft. That preview works only for a signed-in member with edit rights, from the application itself.",
      },
    ],
  },
  {
    slug: "api/authentication",
    title: "API authentication",
    description: "Create a workspace API key and authenticate a server-to-server request.",
    blocks: [
      {
        type: "paragraph",
        text: "The API authenticates with a workspace API key sent as a bearer token. The key identifies the workspace, so your request never names a tenant and cannot reach another one.",
      },
      { type: "heading", id: "create", text: "Create a key" },
      {
        type: "steps",
        items: [
          { title: "Open the developer area", body: "Developer → API keys, in the workspace the key should belong to." },
          { title: "Create and name it", body: "Name it after the system that will use it, so revoking later is obvious." },
          { title: "Copy it once", body: "The full key is shown exactly once. Afterwards only a short prefix is stored for identification." },
          { title: "Store it as a secret", body: "Put it in your server's secret store or environment. Never in client code or a repository." },
        ],
      },
      { type: "heading", id: "format", text: "Key format" },
      {
        type: "paragraph",
        text: "A key looks like `dot_live_` followed by 32 URL-safe characters. Only a SHA-256 hash and the display prefix are stored, so a database disclosure does not hand anyone a working credential.",
      },
      { type: "heading", id: "use", text: "Use it" },
      {
        type: "code",
        language: "bash",
        label: "Authorization header",
        code: `curl https://app.example.com/api/v1/public/chat \\
  -H "Authorization: Bearer $DOT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "chatbotId": "YOUR_CHATBOT_ID", "messages": [] }'`,
      },
      {
        type: "callout",
        tone: "danger",
        title: "Server-side only",
        body: "An API key carries workspace-wide access to the public API. Never ship it in a browser bundle, a mobile binary, a public repository or an analytics payload, and never put a real key in documentation. If a key is exposed, revoke it — revocation takes effect on the next request.",
      },
      { type: "heading", id: "browser", text: "Calling from a browser or mobile app" },
      {
        type: "paragraph",
        text: "Do not put the key in the client. Proxy through your own backend, which holds the key and forwards the stream, or use the [website embed](/docs/embed), which is designed for untrusted pages.",
      },
      { type: "heading", id: "rotation", text: "Rotating and revoking" },
      {
        type: "list",
        items: [
          "Create the replacement key first, deploy it, then revoke the old one — there is no downtime that way.",
          "Revoking is immediate and permanent; a revoked key cannot be restored.",
          "Each key records when it was created and when it was last used, which is how you find one nothing is using any more.",
        ],
      },
    ],
  },
  {
    slug: "api/chat",
    title: "Chat API",
    description: "Send a message to a chatbot and stream the reply.",
    blocks: [
      { type: "endpoint", method: "POST", path: "/api/v1/public/chat", auth: "Bearer API key", summary: "Send a turn to a chatbot and stream the reply as Server-Sent Events." },
      {
        type: "paragraph",
        text: "This is the same pipeline the widget and the playground use: knowledge is retrieved, the model streams a reply, and the conversation and its token usage are recorded against your workspace on the `api` channel.",
      },
      { type: "heading", id: "request", text: "Request" },
      {
        type: "table",
        head: ["Field", "Type", "Required", "Notes"],
        rows: [
          ["chatbotId", "string (uuid)", "Yes", "A chatbot in the key's workspace. It must be Active."],
          ["messages", "array", "Yes", "1–60 turns of `{ role, content }`, where role is `user` or `assistant`. Content is 1–8000 characters."],
          ["conversationId", "string (uuid)", "No", "Continues an existing conversation. Omit it to start a new one."],
        ],
      },
      {
        type: "code",
        language: "json",
        label: "Request body",
        code: `{
  "chatbotId": "b3f1c0de-0000-4000-8000-000000000000",
  "messages": [
    { "role": "user", "content": "Do you ship to the EU?" }
  ]
}`,
      },
      {
        type: "paragraph",
        text: "Send the whole visible transcript on each turn, not just the newest message: the platform stores what it receives and passes the history to the model. Only the latest user message is recorded as a new message.",
      },
      { type: "heading", id: "response", text: "Response" },
      {
        type: "paragraph",
        text: "`200 OK` with `Content-Type: text/event-stream`. Each line is a `data:` frame holding one JSON event. The stream always ends with a `done` event.",
      },
      {
        type: "code",
        language: "text",
        label: "Stream",
        code: `data: {"type":"tool-result","id":"conversation","result":{"conversationId":"…"}}

data: {"type":"start","id":"gen_…","model":"…"}

data: {"type":"sources","sources":[{"id":"…","title":"Shipping policy","snippet":"…"}]}

data: {"type":"text-delta","delta":"Yes — EU orders "}

data: {"type":"text-delta","delta":"ship in 2–4 days."}

data: {"type":"usage","usage":{"inputTokens":412,"outputTokens":38}}

data: {"type":"done","finishReason":"stop"}`,
      },
      { type: "heading", id: "events", text: "Event types" },
      {
        type: "table",
        head: ["Event", "Payload", "Meaning"],
        rows: [
          ["tool-result (id `conversation`)", "{ conversationId }", "Sent first. Keep it to continue the conversation on the next call."],
          ["start", "{ id, model }", "Generation began."],
          ["sources", "{ sources[] }", "Knowledge passages the answer may cite as [n]."],
          ["text-delta", "{ delta }", "A fragment of the reply. Concatenate in order."],
          ["tool-call / tool-result", "{ id, name, arguments } / { id, result }", "Tool activity, on agent-backed runs."],
          ["usage", "{ inputTokens, outputTokens }", "Token counts for the turn."],
          ["done", "{ finishReason }", "`stop`, `length`, `tool_calls`, `cancelled` or `error`."],
          ["error", "{ message, code }", "Generation failed. A `done` with `error` always follows."],
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Cancelling",
        body: "Abort the HTTP request to stop generation. The server notices the disconnect, stops the model, and records the conversation up to that point.",
      },
      { type: "heading", id: "errors", text: "Failure modes" },
      {
        type: "table",
        head: ["Status", "Code", "When"],
        rows: [
          ["401", "unauthorized", "Missing, malformed or revoked API key."],
          ["403", "forbidden", "The chatbot exists but is not Active."],
          ["404", "not_found", "No chatbot with that id in this workspace. Another tenant's id is indistinguishable from a missing one."],
          ["422", "validation_error", "The body failed validation; `details` names the fields."],
          ["429", "rate_limited", "A ceiling was hit. See [rate limits](/docs/api/rate-limits)."],
        ],
      },
      {
        type: "paragraph",
        text: "See [errors](/docs/api/errors) for the envelope, and [examples](/docs/examples) for working clients.",
      },
    ],
  },
  {
    slug: "api/errors",
    title: "Errors",
    description: "One error envelope, stable codes, and what to do about each.",
    blocks: [
      {
        type: "paragraph",
        text: "Every failing API response uses the same shape. Branch on `code`, which is stable, rather than on `message`, which is written for humans and may change.",
      },
      {
        type: "code",
        language: "json",
        label: "Error response",
        code: `{
  "error": {
    "code": "validation_error",
    "message": "Validation failed",
    "details": { "messages": ["Array must contain at least 1 element(s)"] }
  }
}`,
      },
      { type: "heading", id: "codes", text: "Codes" },
      {
        type: "table",
        head: ["Code", "Status", "What to do"],
        rows: [
          ["bad_request", "400", "The request was malformed, for example invalid JSON. Fix and retry."],
          ["unauthorized", "401", "Authenticate. Check the key was not revoked."],
          ["forbidden", "403", "The credential is valid but not allowed to do this."],
          ["not_found", "404", "No such resource in this workspace."],
          ["conflict", "409", "The write collided with an existing record, such as a duplicate email."],
          ["validation_error", "422", "Read `details` for the offending fields."],
          ["rate_limited", "429", "Back off and retry; the message says for how long."],
          ["unavailable", "503", "A dependency is down. Retry with backoff."],
          ["internal_error", "500", "Something broke on our side. Safe to retry once."],
        ],
      },
      {
        type: "callout",
        tone: "info",
        title: "Errors mid-stream",
        body: "A request that has already returned 200 cannot change its status. If generation fails after the stream opens, an `error` event arrives inside the stream, followed by `done` with `finishReason: \"error\"`.",
      },
    ],
  },
  {
    slug: "api/rate-limits",
    title: "Rate limits",
    description: "The ceilings applied to the public API and the widget.",
    blocks: [
      {
        type: "paragraph",
        text: "Limits are fixed windows of one minute. Ceilings keyed on your workspace or chatbot are the ones that actually bound spend, because a caller cannot change which workspace it is in.",
      },
      { type: "heading", id: "api", text: "Public API" },
      {
        type: "table",
        head: ["Scope", "Limit"],
        rows: [
          ["Per workspace", "600 requests / minute"],
          ["Per API key", "120 requests / minute"],
        ],
      },
      { type: "heading", id: "widget", text: "Website widget" },
      {
        type: "table",
        head: ["Scope", "Limit"],
        rows: [
          ["Per workspace", "600 requests / minute"],
          ["Per chatbot", "300 requests / minute"],
          ["Per visitor address, per chatbot", "30 requests / minute"],
        ],
      },
      { type: "heading", id: "handling", text: "Handling a 429" },
      {
        type: "paragraph",
        text: "Exceeding a limit returns `429` with code `rate_limited`, and the message states how long until the window resets. Retry with exponential backoff and jitter. If you consistently need more headroom than the per-key limit, spread traffic across keys per application rather than retrying harder.",
      },
      {
        type: "callout",
        tone: "info",
        title: "Deployment note",
        body: "Limits are enforced per application instance. A deployment running several instances behind a load balancer multiplies the effective ceiling, so an edge rate limiter should front the public API in production.",
      },
    ],
  },
  {
    slug: "examples",
    title: "Examples",
    description: "Working clients for the streaming chat API.",
    blocks: [
      {
        type: "paragraph",
        text: "Each example reads the API key from the environment. Never inline a real key.",
      },
      { type: "heading", id: "curl", text: "curl" },
      {
        type: "code",
        language: "bash",
        label: "Stream to the terminal",
        code: `curl -N https://app.example.com/api/v1/public/chat \\
  -H "Authorization: Bearer $DOT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "chatbotId": "YOUR_CHATBOT_ID",
    "messages": [{ "role": "user", "content": "Do you ship to the EU?" }]
  }'`,
      },
      { type: "heading", id: "node", text: "Node.js" },
      {
        type: "code",
        language: "ts",
        label: "chat.ts",
        code: `type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-result"; id: string; result: { conversationId?: string } }
  | { type: "usage"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string; code?: string };

export async function ask(chatbotId: string, question: string, conversationId?: string) {
  const response = await fetch("https://app.example.com/api/v1/public/chat", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.DOT_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatbotId,
      conversationId,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(\`\${error.code}: \${error.message}\`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let conversation = conversationId;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line.
    let boundary = buffer.indexOf("\\n\\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\\n\\n");

      const data = frame
        .split("\\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;

      const event = JSON.parse(data) as StreamEvent;
      if (event.type === "text-delta") answer += event.delta;
      if (event.type === "tool-result" && event.id === "conversation") {
        conversation = event.result.conversationId ?? conversation;
      }
      if (event.type === "error") throw new Error(event.message);
    }
  }

  return { answer, conversationId: conversation };
}`,
      },
      { type: "heading", id: "continuing", text: "Continuing a conversation" },
      {
        type: "paragraph",
        text: "Keep the `conversationId` from the first event of a stream and send it with the next turn. The thread then appears as one conversation in the inbox, and the model keeps its context.",
      },
      { type: "heading", id: "proxy", text: "Proxying from your own frontend" },
      {
        type: "paragraph",
        text: "A browser must never hold the API key. Expose your own endpoint that authenticates your user, calls this API server-side, and pipes the stream back. That keeps the credential on your server and lets you apply your own limits per user.",
      },
    ],
  },
];
