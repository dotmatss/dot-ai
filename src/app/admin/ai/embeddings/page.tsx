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
import { AI_MODEL_STATUS_META, formatCostPerMtok } from "@/features/platform/ai-constants";
import { listEmbeddingModels } from "@/features/platform/server/ai-registry-repository";
import { formatNumber } from "@/lib/format/number";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * The embedding registry.
 *
 * A table rather than cards, unlike the completion models: embedding entries
 * are compared on one axis that matters far more than the rest - dimensions -
 * and a table is what makes a mismatch obvious at a glance.
 */
export default async function AdminAiEmbeddingsPage() {
  await requirePlatformAccess();
  const models = await listEmbeddingModels();

  return (
    <>
      <PageHeader
        title="Embedding models"
        description="A separate registry, because dimensions must match vectors that are already stored."
      />

      <AppAlert tone="info" title="Dimensions are not editable">
        A dimension count is the width of every vector already written with that model, not a description of it.
        Changing the embedding model for existing content is a re-embedding job, so a registry entry is replaced rather
        than re-dimensioned.
      </AppAlert>

      <AppTableContainer>
        <AppTable>
          <AppTableHeader>
            <AppTableRow>
              <AppTableHead>Model</AppTableHead>
              <AppTableHead>Provider</AppTableHead>
              <AppTableHead>Dimensions</AppTableHead>
              <AppTableHead>Max input</AppTableHead>
              <AppTableHead>Cost / Mtok</AppTableHead>
              <AppTableHead>Status</AppTableHead>
            </AppTableRow>
          </AppTableHeader>
          <AppTableBody>
            {models.length === 0 ? (
              <AppTableMessageRow colSpan={6}>
                No embedding models registered. Knowledge processing still resolves its provider through{" "}
                <code>getEmbeddingProvider()</code>, which returns the deterministic mock until a hosted provider is
                selected.
              </AppTableMessageRow>
            ) : (
              models.map((model) => (
                <AppTableRow key={model.id}>
                  <AppTableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{model.displayName}</span>
                      <span className="text-xs text-foreground-muted">
                        <code>{model.providerModelId}</code>
                      </span>
                    </div>
                  </AppTableCell>
                  <AppTableCell>
                    <span className={model.providerEnabled ? undefined : "text-foreground-muted"}>
                      {model.providerName}
                      {model.providerEnabled ? "" : " (disabled)"}
                    </span>
                  </AppTableCell>
                  <AppTableCell className="tabular-nums">{formatNumber(model.dimensions)}</AppTableCell>
                  <AppTableCell className="tabular-nums">
                    {model.maxInputTokens === null ? "—" : formatNumber(model.maxInputTokens)}
                  </AppTableCell>
                  <AppTableCell className="tabular-nums">{formatCostPerMtok(model.costPerMtok)}</AppTableCell>
                  <AppTableCell>
                    <AppBadge tone={AI_MODEL_STATUS_META[model.status].tone} size="sm">
                      {AI_MODEL_STATUS_META[model.status].label}
                    </AppBadge>
                  </AppTableCell>
                </AppTableRow>
              ))
            )}
          </AppTableBody>
        </AppTable>
      </AppTableContainer>
    </>
  );
}
