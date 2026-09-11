# ADR 0003 — AI boundary: provider-agnostic gateway with a shared streaming contract

**Status:** Accepted · **Date:** 2026-09-10

## Context

Chatbots, agents, workflows and knowledge retrieval all need LLM access. Infrastructure direction is Cloudflare AI Gateway in front of the model provider. UI must handle streaming, partial responses, cancellation, tool calls, citations and usage.

## Decision

- `src/server/ai/gateway.ts` defines `AiGateway.streamChat()` yielding normalized `ChatStreamEvent`s (`start`, `text-delta`, `sources`, `tool-call`, `tool-result`, `usage`, `done`, `error`) and an `EmbeddingProvider` interface for RAG.
- Two implementations: `MockAiGateway` (deterministic, default for development/tests) and `OpenAiCompatibleGateway` targeting Cloudflare AI Gateway's OpenAI-compatible endpoint. Selection is by environment (`AI_PROVIDER`).
- Route handlers stream Server-Sent Events via `eventsToSseResponse()`; the client parses them with `readChatStream()` and drives UI through the `useChatStream` hook. Persistence (conversation + messages + usage) happens server-side in `runChatbotChat()` as the stream completes.
- Retrieval is a boundary (`retrieveKnowledge()`); the vector store/embedding provider is an implementation detail behind it.

## Consequences

- No vendor SDK in the frontend; model identifiers are opaque strings routed by the gateway.
- Adding a provider means adding one gateway class; adding a UI capability means adding one event type.
