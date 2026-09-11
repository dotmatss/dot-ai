import "server-only";

import { getServerEnv } from "@/config/env";

import type { AiGateway } from "./gateway";
import { MockAiGateway } from "./mock-gateway";
import { OpenAiCompatibleGateway } from "./openai-compatible-gateway";

let gateway: AiGateway | undefined;

/**
 * Resolves the configured AI gateway. Selection is an environment concern so
 * feature code stays provider-agnostic.
 */
export function getAiGateway(): AiGateway {
  if (gateway) return gateway;
  const env = getServerEnv();
  if (env.AI_PROVIDER === "gateway") {
    if (!env.AI_GATEWAY_BASE_URL) {
      throw new Error("AI_PROVIDER=gateway requires AI_GATEWAY_BASE_URL");
    }
    gateway = new OpenAiCompatibleGateway({
      baseUrl: env.AI_GATEWAY_BASE_URL,
      apiKey: env.AI_GATEWAY_API_KEY,
      defaultModel: env.AI_DEFAULT_MODEL,
    });
  } else {
    gateway = new MockAiGateway();
  }
  return gateway;
}

export type { AiGateway, ChatCompletionRequest, EmbeddingProvider } from "./gateway";
