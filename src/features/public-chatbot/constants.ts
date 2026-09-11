/**
 * Public product demo shown on the marketing site.
 *
 * This chatbot is deliberately NOT a tenant chatbot. It has no workspace, no
 * database row, no knowledge base and no conversation history. Its whole
 * configuration is the code in this feature, and its only knowledge is the
 * published documentation. See `src/features/public-chatbot/server/demo-chat.ts`.
 */

export const DEMO_ASSISTANT_NAME = "Dot";

export const DEMO_DIALOG_TITLE = "Ask Dot";

export const DEMO_DIALOG_DESCRIPTION = "Answers come from the product documentation. Nothing you type here is stored.";

export const DEMO_LAUNCHER_LABEL = "Ask Dot about the product";

export const DEMO_COMPOSER_PLACEHOLDER = "Ask about chatbots, knowledge, workflows or the API…";

/**
 * Suggested openers.
 *
 * Every one of these maps to a documented, implemented capability. Do not add
 * a prompt the product cannot answer honestly - the demo's value is that it
 * never oversells. `tests/unit/public-chatbot-demo.test.ts` checks each prompt
 * still retrieves documentation.
 */
export const SUGGESTED_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: "What can this platform do?", prompt: "What can this platform do?" },
  { label: "Add a chatbot to my site", prompt: "How do I add an AI chatbot to my website?" },
  { label: "Use my own content", prompt: "Can I ground answers in my own knowledge base?" },
  { label: "Build a workflow", prompt: "Can I build custom AI workflows?" },
  { label: "Call the API instead", prompt: "Can I use the API instead of the embed, and how do I authenticate?" },
];

/** Endpoint the demo streams from. Public, unauthenticated, no tenant scope. */
export const DEMO_CHAT_ENDPOINT = "/api/public/demo/chat";

/** Longest single question accepted, in characters. */
export const DEMO_MAX_MESSAGE_LENGTH = 1_000;

/** Turns of history sent back to the model. Keeps the prompt bounded. */
export const DEMO_MAX_HISTORY = 12;
