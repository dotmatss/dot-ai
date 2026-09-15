"use client";

import { MessageCircleQuestion } from "lucide-react";

import { AppAlert } from "@/components/ui/app-alert";
import { AppCard, AppCardContent, AppCardHeader, AppCardTitle } from "@/components/ui/app-card";
import { AppStat } from "@/components/ui/app-stat";
import { CoverageMeter } from "@/features/intelligence/components/coverage-meter";
import { containmentRate, coverageRate, escalationRate, formatRate, isKnowledgeGap } from "@/features/intelligence/metrics";
import type { Topic } from "@/features/intelligence/types";

/**
 * The summary panel above a topic's conversations: what this topic costs, how
 * well it is documented, and the questions themselves.
 */
export function TopicOverview({ topic }: { topic: Topic }) {
  const coverage = coverageRate(topic);
  const ungrounded = Math.max(0, topic.conversationCount - topic.groundedCount);

  return (
    <div className="flex flex-col gap-6">
      {isKnowledgeGap(topic) ? (
        <AppAlert tone="warning" title="Your knowledge base does not cover this">
          {ungrounded.toLocaleString("en")} of {topic.conversationCount.toLocaleString("en")} conversations here were
          answered with no supporting document, so the model answered from its own weights and nobody can check what it
          said. Drafting an article is the fastest way to close that.
        </AppAlert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <AppStat label="Conversations" value={topic.conversationCount.toLocaleString("en")} />
        <AppStat
          label="Contained"
          value={formatRate(containmentRate(topic))}
          visual={
            <p className="text-xs text-foreground-muted">
              {topic.escalatedCount.toLocaleString("en")} escalated ({formatRate(escalationRate(topic))})
            </p>
          }
        />
        <AppStat
          label="Answered from knowledge"
          value={formatRate(coverage)}
          visual={<CoverageMeter value={coverage} size="sm" />}
        />
      </div>

      <AppCard variant="bordered">
        <AppCardHeader>
          <AppCardTitle className="flex items-center gap-2">
            <MessageCircleQuestion className="size-4 text-foreground-subtle" aria-hidden />
            What people asked
          </AppCardTitle>
        </AppCardHeader>
        <AppCardContent>
          {topic.examples.length === 0 ? (
            <p className="text-sm text-foreground-muted">No questions recorded for this topic yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {topic.examples.map((example, index) => (
                // The question text is the only stable thing about an example;
                // two identical questions are genuinely the same row to a
                // reader, so the index disambiguates them.
                <li key={`${index}-${example}`} className="flex gap-2 text-sm text-foreground-secondary">
                  <span aria-hidden className="select-none text-foreground-subtle">
                    —
                  </span>
                  <span className="min-w-0 break-words">{example}</span>
                </li>
              ))}
            </ul>
          )}
        </AppCardContent>
      </AppCard>
    </div>
  );
}
