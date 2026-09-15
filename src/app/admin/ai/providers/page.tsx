import { KeyRound } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableMessageRow,
  AppTableRow,
} from "@/components/ui/app-table";
import { AI_PROVIDER_KIND_LABELS } from "@/features/platform/ai-constants";
import { listAiProviders } from "@/features/platform/server/ai-registry-repository";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * The provider registry.
 *
 * Credentials are reported as a state, never as a value: the summary type this
 * page renders has no field an API key could travel in.
 */
export default async function AdminAiProvidersPage() {
  await requirePlatformAccess();
  const providers = await listAiProviders();

  const enabledWithoutCredential = providers.filter((p) => p.enabled && !p.credentialConfigured);

  return (
    <>
      <PageHeader
        title="AI providers"
        description="Upstream providers the platform can reach. Credentials are stored server-side and are never shown again."
      />

      {enabledWithoutCredential.length > 0 ? (
        <AppAlert tone="warning" title="Enabled without a stored credential">
          {enabledWithoutCredential.map((p) => p.name).join(", ")} {enabledWithoutCredential.length === 1 ? "is" : "are"}{" "}
          enabled but {enabledWithoutCredential.length === 1 ? "has" : "have"} no credential here. That is valid when
          authentication happens at a gateway in front of the provider, and a misconfiguration otherwise.
        </AppAlert>
      ) : null}

      <AppTableContainer>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Provider</AppTableHead>
              <AppTableHead>Kind</AppTableHead>
              <AppTableHead>Credential</AppTableHead>
              <AppTableHead>Models</AppTableHead>
              <AppTableHead>Status</AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {providers.length === 0 ? (
              <AppTableMessageRow colSpan={5}>
                No providers are registered yet. The application still resolves its gateway from environment
                configuration until routing is connected.
              </AppTableMessageRow>
            ) : (
              providers.map((provider) => (
                <AppTableRow key={provider.id}>
                  <AppTableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{provider.name}</span>
                      <span className="text-xs text-foreground-muted">{provider.slug}</span>
                    </div>
                  </AppTableCell>
                  <AppTableCell>{AI_PROVIDER_KIND_LABELS[provider.kind]}</AppTableCell>
                  <AppTableCell>
                    {provider.credentialConfigured ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <KeyRound aria-hidden className="size-3.5 text-success" />
                        Configured
                      </span>
                    ) : (
                      <span className="text-sm text-foreground-muted">Not set</span>
                    )}
                  </AppTableCell>
                  <AppTableCell className="tabular-nums">
                    {provider.modelCount} / {provider.embeddingModelCount} embedding
                  </AppTableCell>
                  <AppTableCell>
                    <AppBadge tone={provider.enabled ? "success" : "neutral"} size="sm">
                      {provider.enabled ? "Enabled" : "Disabled"}
                    </AppBadge>
                  </AppTableCell>
                </AppTableRow>
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>

      <p className="text-sm text-foreground-muted">
        Managed through <code>POST/PATCH/DELETE /api/admin/ai/providers</code>. A provider cannot be deleted while
        models reference it.
      </p>
    </>
  );
}
