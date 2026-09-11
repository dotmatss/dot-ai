"use client";

import { ExternalLink, Globe, Plus } from "lucide-react";
import type { Route } from "next";
import { useState } from "react";

import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardDescription, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppChip } from "@/components/ui/app-chip";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import { AppInput } from "@/components/ui/app-input";
import { AppFieldError } from "@/components/ui/app-label";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { ChatbotApiCard } from "@/features/chatbots/components/chatbot-api-card";
import { useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useChatbotQuery } from "@/features/chatbots/queries";
import { allowedDomainSchema } from "@/features/chatbots/schemas";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

function buildSnippet(origin: string, chatbot: Chatbot): string {
  // The loader renders the launcher before the iframe loads, so it needs the
  // appearance up front; otherwise a configured colour, label and position only
  // appear once the panel is opened.
  const attributes = [
    `src="${origin}/embed/widget.js"`,
    `data-chatbot="${chatbot.embedKey}"`,
    `data-color="${chatbot.appearance.primaryColor}"`,
    `data-label="${chatbot.appearance.launcherLabel.replace(/"/g, "&quot;")}"`,
    `data-position="${chatbot.appearance.position}"`,
    "async",
  ];
  return ["<script", ...attributes.map((attribute) => `  ${attribute}`), "></script>"].join("\n");
}

function DeployPanel({ chatbot, origin }: { chatbot: Chatbot; origin: string }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbot.id);
  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);

  function addDomain() {
    const parsed = allowedDomainSchema.safeParse(domainInput);
    if (!parsed.success) {
      setDomainError(parsed.error.issues[0]?.message ?? "Invalid domain");
      return;
    }
    if (chatbot.allowedDomains.includes(parsed.data)) {
      setDomainError("This domain is already allowed");
      return;
    }
    setDomainError(null);
    setDomainInput("");
    update.mutate({ allowedDomains: [...chatbot.allowedDomains, parsed.data] });
  }

  function removeDomain(domain: string) {
    update.mutate({ allowedDomains: chatbot.allowedDomains.filter((d) => d !== domain) });
  }

  const ready = chatbot.status === "active" && chatbot.allowedDomains.length > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {chatbot.status !== "active" ? (
          <AppAlert
            tone="warning"
            title="This chatbot is not active"
            action={
              editable ? (
                <AppButton size="sm" onClick={() => update.mutate({ status: "active" })} loading={update.isPending}>
                  Activate
                </AppButton>
              ) : undefined
            }
          >
            The embed loads on your site but will not answer until the chatbot is activated.
          </AppAlert>
        ) : chatbot.allowedDomains.length === 0 ? (
          <AppAlert tone="warning" title="No domains allowed yet">
            Requests from any website are rejected until you allow at least one domain below.
          </AppAlert>
        ) : (
          <AppAlert tone="success" title="Ready to serve">
            The widget answers visitors on {chatbot.allowedDomains.length} allowed domain{chatbot.allowedDomains.length === 1 ? "" : "s"}.
          </AppAlert>
        )}

        <AppCard>
          <AppCardHeader>
            <div>
              <AppCardTitle>Embed snippet</AppCardTitle>
              <AppCardDescription>Paste before the closing &lt;/body&gt; tag of every page where the chat should appear.</AppCardDescription>
            </div>
          </AppCardHeader>
          <AppCardContent className="flex flex-col gap-3 pt-4">
            <AppCodeBlock code={buildSnippet(origin, chatbot)} language="html" label="HTML" />
            <p className="text-xs text-foreground-muted">
              The embed key identifies the chatbot and is safe to expose. Access is controlled by the allowed-domain list and the chatbot status,
              never by secrets in the page.
            </p>
          </AppCardContent>
        </AppCard>

        <AppCard>
          <AppCardHeader>
            <div>
              <AppCardTitle>Allowed domains</AppCardTitle>
              <AppCardDescription>Only pages served from these hostnames can start conversations. Use *.example.com for subdomains.</AppCardDescription>
            </div>
          </AppCardHeader>
          <AppCardContent className="flex flex-col gap-4 pt-4">
            {editable ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex gap-2">
                  <AppInput
                    aria-label="Domain to allow"
                    value={domainInput}
                    onChange={(event) => setDomainInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addDomain();
                      }
                    }}
                    placeholder="www.example.com"
                    leadingIcon={<Globe aria-hidden />}
                    invalid={Boolean(domainError)}
                  />
                  <AppButton variant="secondary" onClick={addDomain} leadingIcon={<Plus aria-hidden />} loading={update.isPending}>
                    Add
                  </AppButton>
                </div>
                <AppFieldError>{domainError}</AppFieldError>
              </div>
            ) : null}
            {chatbot.allowedDomains.length === 0 ? (
              <p className="text-sm text-foreground-muted">No domains allowed.</p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Allowed domains">
                {chatbot.allowedDomains.map((domain) => (
                  <li key={domain}>
                    <AppChip onRemove={editable ? () => removeDomain(domain) : undefined} removeLabel={`Remove ${domain}`} leadingIcon={<Globe aria-hidden />}>
                      {domain}
                    </AppChip>
                  </li>
                ))}
              </ul>
            )}
          </AppCardContent>
        </AppCard>

        <ChatbotApiCard origin={origin} chatbotId={chatbot.id} workspaceSlug={membership.workspace.slug} />
      </div>

      <div className="flex flex-col gap-4">
        <AppCard padding="md" className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Preview</p>
          <p className="text-sm text-foreground-muted">Open the hosted widget page to see exactly what visitors will get.</p>
          <AppButtonLink
            href={`/embed/${chatbot.embedKey}` as Route}
            target="_blank"
            // Deliberately not "noreferrer": the embed page identifies the
            // parent origin from the Referer, and stripping it makes the
            // member preview fall through to the public rules and fail.
            rel="noopener"
            variant="secondary"
            trailingIcon={<ExternalLink aria-hidden />}
          >
            Open widget
          </AppButtonLink>
          {!ready ? <p className="text-xs text-foreground-muted">The preview works for members even before the chatbot is public.</p> : null}
        </AppCard>
      </div>
    </div>
  );
}

export function ChatbotDeployPanel({ chatbotId, origin }: { chatbotId: string; origin: string }) {
  const query = useChatbotQuery(chatbotId);
  if (query.isPending) return <AppSkeleton className="h-96" />;
  if (query.isError) return <AppErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <DeployPanel chatbot={query.data} origin={origin} />;
}
