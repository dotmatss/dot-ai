"use client";

import { Bot, Cpu, ExternalLink } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { AppFormActions, AppFormField, AppFormSection } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppButton, AppButtonLink } from "@/components/ui/app-button";
import { AppRadio, AppRadioGroup } from "@/components/ui/app-radio";
import { AppSelect } from "@/components/ui/app-select";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { useUpdateChatbotMutation } from "@/features/chatbots/mutations";
import { useAgentsQuery } from "@/features/agents/queries";
import type { Chatbot } from "@/features/chatbots/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit } from "@/features/workspaces/roles";

type Source = "chatbot" | "agent";

/**
 * Chooses what answers on this channel: the chatbot's own configuration, or an
 * agent it deploys.
 *
 * The inherited list below is exhaustive on purpose. An agent also has tools,
 * memory and structured output, and none of those run in a chatbot channel -
 * saying so here is what stops the picker from implying a capability the
 * runtime does not have. See `chatbot-runtime.ts`.
 */
export function ChatbotAiSourceForm({ chatbot }: { chatbot: Chatbot }) {
  const { membership } = useWorkspace();
  const editable = canEdit(membership.role);
  const update = useUpdateChatbotMutation(chatbot.id);
  const agentsQuery = useAgentsQuery({ pageSize: 100 });

  // Seeded from the saved link. The caller remounts this on `agentId`, so a
  // save (or another tab's) re-seeds it without an effect syncing two copies.
  const [source, setSource] = useState<Source>(chatbot.agentId ? "agent" : "chatbot");
  const [agentId, setAgentId] = useState<string>(chatbot.agentId ?? "");

  const agents = agentsQuery.data?.items ?? [];
  const agentsHref = `/w/${membership.workspace.slug}/agents` as Route;
  const linkedHref = chatbot.agentId ? (`${agentsHref}/${chatbot.agentId}` as Route) : null;

  const nextAgentId = source === "agent" ? agentId : null;
  const dirty = (chatbot.agentId ?? null) !== (nextAgentId || null);
  const incomplete = source === "agent" && !agentId;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (incomplete) return;
    update.mutate({ agentId: nextAgentId || null });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset disabled={!editable} className="min-w-0">
        <AppFormSection
          title="AI configuration"
          description="Where this chatbot's instructions, model and knowledge come from. A chatbot is the channel; an agent is the worker it can deploy."
        >
          <AppRadioGroup legend="Configuration source" legendHidden>
            <AppRadio
              name="ai-source"
              id="ai-source-chatbot"
              value="chatbot"
              checked={source === "chatbot"}
              onChange={() => setSource("chatbot")}
              label="Configure this chatbot independently"
              description="Use the instructions, model and collections set on this chatbot."
            />
            <AppRadio
              name="ai-source"
              id="ai-source-agent"
              value="agent"
              checked={source === "agent"}
              onChange={() => setSource("agent")}
              label="Use an existing agent"
              description="Reuse an agent's instructions, model and knowledge across every channel it is deployed on."
            />
          </AppRadioGroup>

          {source === "agent" ? (
            agentsQuery.isPending ? (
              <AppSkeleton className="h-9 w-full" />
            ) : agents.length === 0 ? (
              <AppAlert
                tone="info"
                title="No agents yet"
                action={
                  <AppButtonLink href={agentsHref} variant="secondary" size="sm">
                    Go to Agents
                  </AppButtonLink>
                }
              >
                Create an agent first, then come back and deploy it here.
              </AppAlert>
            ) : (
              <AppFormField label="Agent" required>
                {(field) => (
                  <AppSelect
                    {...field}
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                    placeholder="Select an agent…"
                    // A delegating agent is refused by the server; showing it
                    // disabled, with the reason, beats offering it and then
                    // reporting a 422 the user has to decode.
                    options={agents.map((agent) => ({
                      value: agent.id,
                      label: agent.canDelegate
                        ? `${agent.name} — delegates, not available in chatbots`
                        : agent.status === "active"
                          ? agent.name
                          : `${agent.name} (${agent.status})`,
                      disabled: agent.canDelegate,
                    }))}
                  />
                )}
              </AppFormField>
            )
          ) : null}

          {chatbot.agentId ? (
            <AppAlert
              tone="info"
              title={`Managed by “${chatbot.agentName ?? "agent"}”`}
              action={
                linkedHref ? (
                  <AppButtonLink href={linkedHref} variant="secondary" size="sm" trailingIcon={<ExternalLink aria-hidden />}>
                    Open agent
                  </AppButtonLink>
                ) : undefined
              }
            >
              Instructions, model and knowledge come from this agent. Its tools, memory and structured output are agent-only
              and do not run in a chat widget. The welcome message, appearance and allowed domains stay with the chatbot.
            </AppAlert>
          ) : null}

          {editable ? (
            <AppFormActions>
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setSource(chatbot.agentId ? "agent" : "chatbot");
                  setAgentId(chatbot.agentId ?? "");
                }}
                disabled={!dirty || update.isPending}
              >
                Discard
              </AppButton>
              <AppButton type="submit" loading={update.isPending} disabled={!dirty || incomplete}>
                Save changes
              </AppButton>
            </AppFormActions>
          ) : null}
        </AppFormSection>
      </fieldset>
    </form>
  );
}

/** Shown in place of configuration a linked agent now owns. */
export function ManagedByAgentNotice({
  chatbot,
  what,
}: {
  chatbot: Pick<Chatbot, "agentId" | "agentName">;
  what: string;
}) {
  const { membership } = useWorkspace();
  if (!chatbot.agentId) return null;
  const href = `/w/${membership.workspace.slug}/agents/${chatbot.agentId}` as Route;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted p-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
        <Cpu aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-foreground">
          {what} is managed by{" "}
          <Link href={href} className="underline underline-offset-4 focus-ring">
            {chatbot.agentName ?? "the linked agent"}
          </Link>
          .
        </p>
        <p className="mt-1 text-xs text-foreground-muted">
          Edit it on the agent to change every channel that deploys it, or switch this chatbot back to its own configuration
          above.
        </p>
      </div>
      <Bot aria-hidden className="ml-auto hidden size-4 shrink-0 text-foreground-subtle sm:block" />
    </div>
  );
}
