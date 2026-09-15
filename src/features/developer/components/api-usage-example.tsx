import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppCodeBlock, AppInlineCode } from "@/components/ui/app-code-block";
import { AppText } from "@/components/ui/app-typography";
import { API_KEY_PREFIX } from "@/features/developer/constants";

function curlExample(origin: string): string {
  return [
    `curl -N -X POST ${origin}/api/v1/public/chat \\`,
    `  -H "Authorization: Bearer ${API_KEY_PREFIX}your_key_here" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "chatbotId": "00000000-0000-0000-0000-000000000000",`,
    `    "messages": [{ "role": "user", "content": "What are your opening hours?" }]`,
    `  }'`,
  ].join("\n");
}

/**
 * Server Component: the snippet is static text, so it needs no client
 * JavaScript. `AppCodeBlock` brings its own copy affordance.
 */
export function ApiUsageExample({ origin }: { origin: string }) {
  return (
    <AppCard>
      <AppCardHeader>
        <div>
          <AppCardTitle>Calling the API</AppCardTitle>
          <AppCardDescription>
            The response is a server-sent event stream, the same contract the website widget uses.
          </AppCardDescription>
        </div>
      </AppCardHeader>
      <AppCardContent className="flex flex-col gap-3">
        <AppCodeBlock code={curlExample(origin)} language="bash" label="curl" />
        <AppText size="sm" tone="muted">
          Send the key in the <AppInlineCode>Authorization</AppInlineCode> header only. The chatbot must be active and
          belong to this workspace; ids from other workspaces are reported as not found.
        </AppText>
      </AppCardContent>
    </AppCard>
  );
}
