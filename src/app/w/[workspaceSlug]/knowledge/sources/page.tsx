import type { Metadata } from "next";
import type { Route } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { KnowledgeSourcesPanel } from "@/features/knowledge/components/knowledge-sources-panel";
import { KNOWLEDGE_SOURCES_PAGE_SIZE } from "@/features/knowledge/constants";
import { parseKnowledgeSourceFilters } from "@/features/knowledge/filters";
import { knowledgeKeys } from "@/features/knowledge/queries";
import { knowledgeScopeParamSchema, toKnowledgeScope } from "@/features/knowledge/schemas";
import { getKnowledgeSources } from "@/features/knowledge/server/knowledge-service";
import { KNOWLEDGE_SCOPE_ALL } from "@/features/knowledge/types";
import { HydrateClient } from "@/lib/query/hydrate";
import { makeQueryClient } from "@/lib/query/query-client";
import { requireWorkspaceAccess } from "@/server/auth/dal";

export const metadata: Metadata = { title: "All knowledge" };

const COPY = {
  all: {
    title: "All knowledge",
    description:
      "Every source in this workspace, filed or not. Use the actions on a row to move a source into a collection.",
  },
  unorganized: {
    title: "Unorganized",
    description:
      "Sources that are indexed but not in a collection. They are fully searchable here, but no agent can retrieve from them until they are filed.",
  },
} as const;

export default async function KnowledgeSourcesPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/knowledge/sources">) {
  const [{ workspaceSlug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireWorkspaceAccess(workspaceSlug);

  // A scope that is not one of the reserved words or a real id is treated as
  // "all" rather than a 404: it is a view selector in a query string, not a
  // resource, and a stale bookmark should still show the user their documents.
  const parsed = knowledgeScopeParamSchema.safeParse(
    Array.isArray(query.scope) ? query.scope[0] : query.scope,
  );
  const scope = parsed.success ? toKnowledgeScope(parsed.data) : KNOWLEDGE_SCOPE_ALL;
  const copy = scope.kind === "unorganized" ? COPY.unorganized : COPY.all;
  const filters = parseKnowledgeSourceFilters(query, KNOWLEDGE_SOURCES_PAGE_SIZE);

  const queryClient = makeQueryClient();
  queryClient.setQueryData(
    knowledgeKeys.sourceList(workspaceSlug, scope, filters),
    await getKnowledgeSources(membership.workspace.id, scope, filters),
  );

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: `/w/${workspaceSlug}/knowledge` as Route }, { label: copy.title }]}
        title={copy.title}
        description={copy.description}
      />
      <HydrateClient queryClient={queryClient}>
        <KnowledgeSourcesPanel scope={scope} />
      </HydrateClient>
    </PageContainer>
  );
}
