import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCard } from "@/components/ui/app-card";
import { AI_MODEL_STATUS_META, formatCostPerMtok } from "@/features/platform/ai-constants";
import { isModelOffered } from "@/features/platform/ai-types";
import { ModelCapabilityGrid } from "@/features/platform/components/model-capability-grid";
import { listAiModels } from "@/features/platform/server/ai-registry-repository";
import { formatNumber } from "@/lib/format/number";
import { requirePlatformAccess } from "@/server/auth/platform-dal";

/**
 * The completion-model catalogue.
 *
 * Cards rather than a table: a model carries a six-way capability matrix and
 * two prices, and flattening that into columns produces a row nobody can read
 * at a glance. This is the one screen in the plane where density loses to
 * comprehension, because the question is per-model rather than comparative.
 */
export default async function AdminAiModelsPage() {
  await requirePlatformAccess();
  const models = await listAiModels();

  return (
    <>
      <PageHeader
        title="AI models"
        description="What each model can do, what the platform offers it for, and what it costs. Availability can never exceed capability."
      />

      {models.length === 0 ? (
        <AppEmptyState
          title="No models registered"
          description="Register a provider first, then add the models it exposes. Until routing is connected, customer-facing model choices still come from the per-feature lists."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {models.map((model) => {
            const offered = isModelOffered(model);
            return (
              <AppCard key={model.id} padding="md" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{model.displayName}</span>
                    <span className="text-xs text-foreground-muted">
                      {model.providerName} &middot; <code>{model.providerModelId}</code>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Two badges, because a model can be Active and still not
                        offered: its provider may be disabled, or its
                        availability list may be empty. */}
                    <AppBadge tone={AI_MODEL_STATUS_META[model.status].tone} size="sm">
                      {AI_MODEL_STATUS_META[model.status].label}
                    </AppBadge>
                    {offered ? null : (
                      <AppBadge tone="neutral" variant="outline" size="sm">
                        Not offered
                      </AppBadge>
                    )}
                  </div>
                </div>

                <ModelCapabilityGrid capabilities={model.capabilities} availableFor={model.availableFor} />

                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <div className="flex gap-1.5">
                    <dt className="text-foreground-muted">Context</dt>
                    <dd className="tabular-nums">
                      {model.contextWindow === null ? "—" : formatNumber(model.contextWindow)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-foreground-muted">In / Mtok</dt>
                    <dd className="tabular-nums">{formatCostPerMtok(model.inputCostPerMtok)}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-foreground-muted">Out / Mtok</dt>
                    <dd className="tabular-nums">{formatCostPerMtok(model.outputCostPerMtok)}</dd>
                  </div>
                </dl>

                {model.providerEnabled ? null : (
                  <p className="text-sm text-warning">Its provider is disabled, so this model is unusable.</p>
                )}
                {model.notes ? <p className="text-sm text-foreground-muted">{model.notes}</p> : null}
              </AppCard>
            );
          })}
        </div>
      )}

      <p className="text-sm text-foreground-muted">
        A dash means no price is recorded. It is deliberately not shown as $0.00, because &ldquo;unknown&rdquo; and
        &ldquo;free&rdquo; are different facts and conflating them under-reports spend.
      </p>
    </>
  );
}
