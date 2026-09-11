"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Search, SearchX } from "lucide-react";
import { useForm } from "react-hook-form";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppFormField } from "@/components/forms/form-field";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard } from "@/components/ui/app-card";
import { AppInput } from "@/components/ui/app-input";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppOverline } from "@/components/ui/app-typography";
import { KnowledgeLifecycle } from "@/features/knowledge/components/knowledge-lifecycle";
import { DEFAULT_RETRIEVAL_LIMIT } from "@/features/knowledge/constants";
import { useKnowledgeSearchMutation } from "@/features/knowledge/mutations";
import { useKnowledgeBaseQuery } from "@/features/knowledge/queries";
import { knowledgeSearchFormSchema, type KnowledgeSearchFormValues } from "@/features/knowledge/schemas";
import type { RetrievedSource } from "@/types/ai";

function ResultCard({ result, rank }: { result: RetrievedSource; rank: number }) {
  return (
    <AppCard padding="md" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AppBadge tone="neutral" variant="outline" size="sm">
            #{rank}
          </AppBadge>
          <p className="truncate text-sm font-medium text-foreground">{result.title}</p>
        </div>
        <p className="text-xs tabular-nums text-foreground-muted">
          <span className="sr-only">Relevance score </span>
          score {(result.score ?? 0).toFixed(4)}
        </p>
      </div>
      <p className="text-sm leading-6 text-foreground-secondary">{result.snippet}</p>
      {result.uri ? (
        <a
          href={result.uri}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex w-fit items-center gap-1 text-xs text-foreground-muted hover:text-foreground focus-ring rounded-xs"
        >
          <span className="truncate">{result.uri}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </AppCard>
  );
}

function ResultsRegion({ mutation }: { mutation: ReturnType<typeof useKnowledgeSearchMutation> }) {
  if (mutation.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <AppSkeleton className="h-24" />
        <AppSkeleton className="h-24" />
      </div>
    );
  }
  if (mutation.isError) {
    return <AppErrorState error={mutation.error} onRetry={() => mutation.reset()} retryLabel="Dismiss" size="sm" />;
  }
  if (!mutation.data) {
    return (
      <AppEmptyState
        size="sm"
        icon={<Search aria-hidden />}
        title="Run a query to see what would be retrieved"
        description="This uses exactly the retrieval your chatbots and agents use, so the passages listed here are the ones the model would be given."
      />
    );
  }
  if (mutation.data.results.length === 0) {
    return (
      <AppEmptyState
        size="sm"
        icon={<SearchX aria-hidden />}
        title="No passages matched"
        description="Nothing in this knowledge base matches those words. Try the wording your customers would use, or add a source that covers the topic."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <AppOverline className="block">
        {mutation.data.results.length} passage{mutation.data.results.length === 1 ? "" : "s"} retrieved
      </AppOverline>
      {mutation.data.results.map((result, index) => (
        <ResultCard key={result.id} result={result} rank={index + 1} />
      ))}
    </div>
  );
}

export function KnowledgeTestPanel({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const baseQuery = useKnowledgeBaseQuery(knowledgeBaseId);
  const mutation = useKnowledgeSearchMutation(knowledgeBaseId);
  const form = useForm<KnowledgeSearchFormValues>({
    resolver: zodResolver(knowledgeSearchFormSchema),
    defaultValues: { query: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate({ query: values.query, limit: DEFAULT_RETRIEVAL_LIMIT });
  });

  const isEmptyBase = baseQuery.data?.chunkCount === 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <AppFormField
            label="Test query"
            labelHidden
            className="flex-1"
            error={form.formState.errors.query?.message}
          >
            {(field) => (
              <AppInput
                {...field}
                {...form.register("query")}
                placeholder="How do I request a refund?"
                leadingIcon={<Search aria-hidden />}
              />
            )}
          </AppFormField>
          <AppButton type="submit" loading={mutation.isPending}>
            Search
          </AppButton>
        </form>

        {isEmptyBase ? (
          <AppAlert tone="warning" title="Nothing is indexed yet">
            Add a source and let it finish processing; until then retrieval has nothing to rank.
          </AppAlert>
        ) : null}

        <div role="region" aria-live="polite" aria-label="Retrieval results">
          <ResultsRegion mutation={mutation} />
        </div>
      </div>

      <KnowledgeLifecycle className="lg:border-l lg:border-border lg:pl-8" />
    </div>
  );
}
