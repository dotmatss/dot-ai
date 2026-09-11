"use client";

import { Bot, CircleCheck, Cpu, RotateCcw, TriangleAlert, UserMinus, UserPlus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { AppAvatar } from "@/components/ui/app-avatar";
import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { ConversationChannelBadge, ConversationStatusBadge } from "@/features/conversations/components/conversation-badges";
import { LinkContactDialog } from "@/features/conversations/components/link-contact-dialog";
import { CONVERSATION_CHANNEL_META } from "@/features/conversations/constants";
import { useUpdateConversationMutation } from "@/features/conversations/mutations";
import type { Conversation, ConversationStatus } from "@/features/conversations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { formatDateTime } from "@/lib/format/date";
import { formatNumber } from "@/lib/format/number";

const STATUS_ACTIONS: Array<{ status: ConversationStatus; label: string; icon: ReactNode }> = [
  { status: "resolved", label: "Resolve", icon: <CircleCheck aria-hidden /> },
  { status: "open", label: "Reopen", icon: <RotateCcw aria-hidden /> },
  { status: "escalated", label: "Escalate", icon: <TriangleAlert aria-hidden /> },
];

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2.5 last:border-0 last:pb-0 first:pt-0">
      <dt className="shrink-0 text-xs text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

interface ConversationMetadataPanelProps {
  conversation: Conversation;
  /** False for viewers: controls stay visible but inert, and say why. */
  canEdit: boolean;
}

export function ConversationMetadataPanel({ conversation, canEdit }: ConversationMetadataPanelProps) {
  const { membership, user } = useWorkspace();
  const workspaceSlug = membership.workspace.slug;
  const update = useUpdateConversationMutation(conversation.id);
  const [linkOpen, setLinkOpen] = useState(false);

  const assignee = conversation.assignee;
  const assignedToMe = assignee?.id === user.id;
  const sourceHref = conversation.source
    ? (`/w/${workspaceSlug}/${conversation.source.type === "chatbot" ? "chatbots" : "agents"}/${conversation.source.id}` as Route)
    : null;
  const contactLabel = conversation.contact?.name?.trim() || conversation.contact?.email || null;

  return (
    <div className="flex flex-col gap-4">
      <AppCard>
        <AppCardHeader>
          <AppCardTitle>Status</AppCardTitle>
          <ConversationStatusBadge status={conversation.status} size="sm" />
        </AppCardHeader>
        <AppCardContent className="flex flex-col gap-4 pt-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_ACTIONS.filter((action) => action.status !== conversation.status).map((action) => (
              <AppButton
                key={action.status}
                variant="secondary"
                size="sm"
                leadingIcon={action.icon}
                disabled={!canEdit || update.isPending}
                onClick={() => update.mutate({ status: action.status })}
              >
                {action.label}
              </AppButton>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs text-foreground-muted">Assignee</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {assignee ? (
                <span className="flex min-w-0 items-center gap-2">
                  <AppAvatar name={assignee.name} src={assignee.avatarUrl} size="xs" />
                  <span className="truncate text-sm">{assignedToMe ? `${assignee.name} (you)` : assignee.name}</span>
                </span>
              ) : (
                <span className="text-sm text-foreground-subtle">Unassigned</span>
              )}
              <span className="flex gap-2">
                {assignedToMe ? null : (
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leadingIcon={<UserPlus aria-hidden />}
                    disabled={!canEdit || update.isPending}
                    onClick={() => update.mutate({ assignedTo: user.id })}
                  >
                    Assign to me
                  </AppButton>
                )}
                {assignee ? (
                  <AppButton
                    variant="ghost"
                    size="sm"
                    leadingIcon={<UserMinus aria-hidden />}
                    disabled={!canEdit || update.isPending}
                    onClick={() => update.mutate({ assignedTo: null })}
                  >
                    Unassign
                  </AppButton>
                ) : null}
              </span>
            </div>
          </div>

          {canEdit ? null : (
            <p className="text-caption text-foreground-muted">Viewers can read conversations but cannot change them.</p>
          )}
        </AppCardContent>
      </AppCard>

      <AppCard>
        <AppCardHeader>
          <AppCardTitle>Details</AppCardTitle>
        </AppCardHeader>
        <AppCardContent className="pt-3">
          <dl>
            <DetailRow label="Channel">
              <span className="flex items-center justify-end gap-2">
                <ConversationChannelBadge channel={conversation.channel} size="sm" />
              </span>
              <span className="mt-1 block text-caption text-foreground-muted">
                {CONVERSATION_CHANNEL_META[conversation.channel].description}
              </span>
            </DetailRow>
            <DetailRow label="Source">
              {conversation.source && sourceHref ? (
                <Link href={sourceHref} className="inline-flex items-center gap-1.5 rounded-xs hover:underline focus-ring">
                  {conversation.source.type === "chatbot" ? (
                    <Bot aria-hidden className="size-3.5 text-foreground-muted" />
                  ) : (
                    <Cpu aria-hidden className="size-3.5 text-foreground-muted" />
                  )}
                  <span className="truncate">{conversation.source.name}</span>
                </Link>
              ) : (
                <span className="text-foreground-subtle">Not linked</span>
              )}
            </DetailRow>
            <DetailRow label="Contact">
              {conversation.contact ? (
                <span className="flex flex-col items-end gap-1">
                  <Link
                    href={`/w/${workspaceSlug}/crm/${conversation.contact.id}` as Route}
                    className="truncate rounded-xs underline-offset-4 hover:underline focus-ring"
                  >
                    {contactLabel ?? "Unnamed contact"}
                  </Link>
                  {conversation.contact.email && conversation.contact.name ? (
                    <a href={`mailto:${conversation.contact.email}`} className="truncate text-xs text-foreground-muted hover:underline focus-ring rounded-xs">
                      {conversation.contact.email}
                    </a>
                  ) : null}
                  {canEdit ? (
                    <span className="flex gap-2">
                      <AppButton variant="link" onClick={() => setLinkOpen(true)} disabled={update.isPending}>
                        Change
                      </AppButton>
                      <AppButton variant="link" onClick={() => update.mutate({ contactId: null })} disabled={update.isPending}>
                        Unlink
                      </AppButton>
                    </span>
                  ) : null}
                </span>
              ) : canEdit ? (
                <AppButton variant="secondary" size="sm" onClick={() => setLinkOpen(true)} disabled={update.isPending}>
                  Link to contact
                </AppButton>
              ) : (
                <span className="text-foreground-subtle">Not linked</span>
              )}
            </DetailRow>
            <DetailRow label="Messages">
              <span className="tabular-nums">{formatNumber(conversation.messageCount)}</span>
            </DetailRow>
            <DetailRow label="Started">
              <span className="whitespace-nowrap">{formatDateTime(conversation.createdAt)}</span>
            </DetailRow>
            <DetailRow label="Last message">
              {conversation.lastMessageAt ? (
                <AppRelativeTime value={conversation.lastMessageAt} className="whitespace-nowrap" />
              ) : (
                <span className="text-foreground-subtle">None</span>
              )}
            </DetailRow>
          </dl>
        </AppCardContent>
      </AppCard>

      <LinkContactDialog open={linkOpen} onClose={() => setLinkOpen(false)} conversationId={conversation.id} />
    </div>
  );
}
