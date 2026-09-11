"use client";

import { CircleAlert, CircleCheck, ExternalLink, Plug, Settings2, TestTube, Unplug } from "lucide-react";
import { useMemo, useState } from "react";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppBadge } from "@/components/ui/app-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppCard, AppCardContent, AppCardFooter, AppCardHeader } from "@/components/ui/app-card";
import { AppChip } from "@/components/ui/app-chip";
import { AppConfirmDialog } from "@/components/ui/app-dialog";
import { AppRelativeTime } from "@/components/ui/app-relative-time";
import { AppSkeleton } from "@/components/ui/app-skeleton";
import { AppText } from "@/components/ui/app-typography";
import { ConfigureIntegrationDialog } from "@/features/integrations/components/configure-integration-dialog";
import { IntegrationStatusBadge } from "@/features/integrations/components/integration-status-badge";
import { INTEGRATION_CATEGORY_LABELS } from "@/features/integrations/constants";
import { useDisconnectIntegrationMutation, useTestIntegrationMutation } from "@/features/integrations/mutations";
import { useIntegrationsQuery } from "@/features/integrations/queries";
import { INTEGRATION_DEFINITIONS, INTEGRATIONS, type IntegrationDefinition } from "@/features/integrations/registry";
import { INTEGRATION_CATEGORIES, type Integration, type IntegrationProvider } from "@/features/integrations/types";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";
import { canEdit, canManage } from "@/features/workspaces/roles";
import { useSearchParamState } from "@/hooks/use-search-param-state";

const FILTER_KEYS = ["category"] as const;

interface CatalogEntry {
  definition: IntegrationDefinition;
  integration: Integration | null;
}

/** Connected first, then anything available, with "coming soon" last. */
function rank(entry: CatalogEntry): number {
  if (entry.integration) return 0;
  return entry.definition.status === "available" ? 1 : 2;
}

function IntegrationCard({
  entry,
  onConfigure,
  onDisconnect,
  onTest,
  testing,
}: {
  entry: CatalogEntry;
  onConfigure: () => void;
  onDisconnect: () => void;
  onTest: () => void;
  testing: boolean;
}) {
  const { membership } = useWorkspace();
  const { definition, integration } = entry;
  const Icon = definition.icon;
  const comingSoon = definition.status === "coming_soon";
  const editable = canEdit(membership.role) && !comingSoon;

  return (
    <AppCard className="flex h-full flex-col">
      <AppCardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
            <Icon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{definition.name}</h3>
            <p className="text-caption text-foreground-muted">{INTEGRATION_CATEGORY_LABELS[definition.category]}</p>
          </div>
        </div>
        {comingSoon ? <AppBadge tone="neutral">Coming soon</AppBadge> : integration ? <IntegrationStatusBadge status={integration.status} /> : null}
      </AppCardHeader>

      <AppCardContent className="flex flex-1 flex-col gap-3">
        <AppText size="sm" tone="secondary">
          {definition.description}
        </AppText>

        {integration && integration.configuredSecretFields.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {integration.configuredSecretFields.map((key) => {
              const field = definition.secretFields.find((candidate) => candidate.key === key);
              return (
                <li key={key}>
                  <AppBadge tone="neutral" size="sm" icon={<CircleCheck aria-hidden />}>
                    {`${field?.label ?? key} stored`}
                  </AppBadge>
                </li>
              );
            })}
          </ul>
        ) : null}

        {integration?.lastTest ? (
          <p className="flex items-start gap-1.5 text-xs text-foreground-muted">
            {integration.lastTest.ok ? (
              <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
            ) : (
              <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
            )}
            <span>
              <span className="font-medium text-foreground-secondary">
                {integration.lastTest.ok ? "Last test passed" : "Last test failed"}
              </span>{" "}
              <AppRelativeTime value={integration.lastTest.checkedAt} />
              {integration.lastTest.message ? <span className="block">{integration.lastTest.message}</span> : null}
            </span>
          </p>
        ) : null}
      </AppCardContent>

      <AppCardFooter className="flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          {editable ? (
            <AppButton
              size="sm"
              variant={integration ? "secondary" : "primary"}
              onClick={onConfigure}
              leadingIcon={integration ? <Settings2 aria-hidden /> : <Plug aria-hidden />}
            >
              {integration ? "Configure" : "Connect"}
            </AppButton>
          ) : null}
          {editable && integration && definition.testable ? (
            <AppButton size="sm" variant="secondary" onClick={onTest} loading={testing} leadingIcon={<TestTube aria-hidden />}>
              Test connection
            </AppButton>
          ) : null}
          {integration && canManage(membership.role) ? (
            <AppButton size="sm" variant="ghost" onClick={onDisconnect} leadingIcon={<Unplug aria-hidden />}>
              Disconnect
            </AppButton>
          ) : null}
        </div>
        <a
          href={definition.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 rounded-xs text-xs font-medium text-foreground-muted underline underline-offset-4 hover:text-foreground focus-ring"
        >
          Docs
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">for {definition.name} (opens in a new tab)</span>
        </a>
      </AppCardFooter>
    </AppCard>
  );
}

function CatalogSkeleton() {
  return (
    <div aria-hidden className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-3">
            <AppSkeleton className="size-10 rounded-md" />
            <div className="flex flex-col gap-1.5">
              <AppSkeleton className="h-3.5 w-32" />
              <AppSkeleton className="h-2.5 w-20" />
            </div>
          </div>
          <AppSkeleton className="h-3 w-full" />
          <AppSkeleton className="h-3 w-2/3" />
          <AppSkeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
}

export function IntegrationsCatalog() {
  const [params, setParams] = useSearchParamState(FILTER_KEYS);
  const query = useIntegrationsQuery();
  // Only the provider is held in state; the entry is derived on every render so
  // an open dialog always reflects the latest server state rather than a
  // snapshot taken when the button was clicked.
  const [configuringProvider, setConfiguringProvider] = useState<IntegrationProvider | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<IntegrationProvider | null>(null);
  const disconnectMutation = useDisconnectIntegrationMutation();
  const testMutation = useTestIntegrationMutation();

  const category = INTEGRATION_CATEGORIES.find((value) => value === params.category);

  const entries = useMemo(() => {
    const byProvider = new Map((query.data ?? []).map((integration) => [integration.provider, integration]));
    return INTEGRATION_DEFINITIONS.map((definition) => ({
      definition,
      integration: byProvider.get(definition.id) ?? null,
    }))
      .filter((entry) => !category || entry.definition.category === category)
      .sort((a, b) => rank(a) - rank(b) || a.definition.name.localeCompare(b.definition.name));
  }, [query.data, category]);

  const entryFor = (provider: IntegrationProvider | null): CatalogEntry | null =>
    provider
      ? {
          definition: INTEGRATIONS[provider],
          integration: (query.data ?? []).find((item) => item.provider === provider) ?? null,
        }
      : null;

  const configuring = entryFor(configuringProvider);
  const disconnecting = entryFor(disconnectingProvider);

  if (query.isPending) return <CatalogSkeleton />;
  if (query.isError) {
    return (
      <AppCard padding="md">
        <AppErrorState error={query.error} onRetry={() => void query.refetch()} size="sm" />
      </AppCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by category">
        <AppChip selected={!category} onClick={() => setParams({ category: undefined })}>
          All
        </AppChip>
        {INTEGRATION_CATEGORIES.map((value) => (
          <AppChip
            key={value}
            selected={category === value}
            onClick={() => setParams({ category: category === value ? undefined : value })}
          >
            {INTEGRATION_CATEGORY_LABELS[value]}
          </AppChip>
        ))}
      </div>

      {entries.length === 0 ? (
        <AppCard padding="md">
          <AppEmptyState
            size="sm"
            title="No integrations in this category"
            description="Choose another category to see what else you can connect."
            action={
              <AppButton variant="secondary" size="sm" onClick={() => setParams({ category: undefined })}>
                Clear filters
              </AppButton>
            }
          />
        </AppCard>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.definition.id}>
              <IntegrationCard
                entry={entry}
                testing={testMutation.isPending && testMutation.variables === entry.definition.id}
                onConfigure={() => setConfiguringProvider(entry.definition.id)}
                onDisconnect={() => setDisconnectingProvider(entry.definition.id)}
                onTest={() => testMutation.mutate(entry.definition.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {configuring ? (
        <ConfigureIntegrationDialog
          definition={configuring.definition}
          integration={configuring.integration}
          open
          onClose={() => setConfiguringProvider(null)}
        />
      ) : null}

      <AppConfirmDialog
        open={Boolean(disconnecting)}
        onClose={() => setDisconnectingProvider(null)}
        onConfirm={() => {
          if (!disconnectingProvider) return;
          disconnectMutation.mutate(disconnectingProvider, { onSettled: () => setDisconnectingProvider(null) });
        }}
        title={`Disconnect ${disconnecting?.definition.name ?? ""}?`}
        description="The stored credentials are deleted and cannot be recovered. Anything relying on this connection stops working immediately."
        confirmLabel="Disconnect"
        destructive
        loading={disconnectMutation.isPending}
      />
    </div>
  );
}
