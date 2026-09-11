import { ArrowUpRight, KeyRound } from "lucide-react";
import type { Route } from "next";

import { AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppCodeBlock, AppInlineCode } from "@/components/ui/app-code-block";
import { AppText } from "@/components/ui/app-typography";

function curlExample(origin: string, chatbotId: string): string {
  return [
    `curl -N -X POST ${origin}/api/v1/public/chat \\`,
    `  -H "Authorization: Bearer $DOT_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "chatbotId": "${chatbotId}",`,
    `    "messages": [{ "role": "user", "content": "What are your opening hours?" }]`,
    `  }'`,
  ].join("\n");
}

/**
 * The API path to this chatbot, shown beside the embed snippet.
 *
 * Embedding and calling the API are peers: both end at the same streaming
 * service, and they differ only in how the caller proves it may talk to this
 * chatbot. Presenting the API here keeps it a first-class choice rather than
 * something a developer has to go hunting for.
 *
 * The key is always written as an environment variable. A real key must never
 * appear in a snippet, a screenshot or a document.
 */
export function ChatbotApiCard({
  origin,
  chatbotId,
  workspaceSlug,
}: {
  origin: string;
  chatbotId: string;
  workspaceSlug: string;
}) {
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Or call it from your own code</AppCardTitle>
          <AppCardDescription>
            Same chatbot, same streamed answer, authenticated by a workspace API key instead of an allowed domain.
          </AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent className="flex flex-col gap-3 pt-4">
        <AppCodeBlock code={curlExample(origin, chatbotId)} language="bash" label="curl" />
        <AppText size="sm" tone="muted">
          Read the key from the environment on your server. Never ship it to a browser, and never put it in a{" "}
          <AppInlineCode>NEXT_PUBLIC_</AppInlineCode> variable.
        </AppText>
        <div className="flex flex-wrap gap-2">
          <AppButtonLink
            href={`/w/${workspaceSlug}/integrations/api-keys` as Route}
            variant="secondary"
            size="sm"
            leadingIcon={<KeyRound aria-hidden />}
          >
            Manage API keys
          </AppButtonLink>
          <AppButtonLink
            href={"/docs/api/chat" as Route}
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost"
            size="sm"
            trailingIcon={<ArrowUpRight aria-hidden />}
          >
            API reference
          </AppButtonLink>
        </div>
      </AppCardContent>
    </AppCard>
  );
}
