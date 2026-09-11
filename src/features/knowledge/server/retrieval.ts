import "server-only";

import { query } from "@/server/db/client";
import type { RetrievedSource } from "@/types/ai";

/**
 * Retrieval boundary for RAG.
 *
 * Ranks indexed chunks with PostgreSQL full-text search: `plainto_tsquery`
 * parses the question, `ts_rank_cd` applies cover-density ranking (which
 * rewards passages where the terms appear close together and cover more of the
 * query) and `ts_headline` produces the snippet the model and the UI both see.
 * The `to_tsvector('english', content)` expression matches the GIN index from
 * migration 0008 exactly, so this is an index scan.
 *
 * SCOPE IS ALWAYS A SET OF COLLECTIONS
 * ------------------------------------
 * There is no "search everything" mode, and that is the security property the
 * whole Collections model exists to provide: an agent answers from the
 * collections it was given and from nothing else. In particular, Unorganized
 * documents (`collection_id IS NULL`) are never retrievable. They are indexed
 * and searchable in the UI, but until someone files them they are outside every
 * agent's reach — which is what makes "this bot can only answer from HR
 * Policies" a statement about the data rather than about the prompt.
 *
 * A NULL can only enter `collectionIds` by mistake, and SQL's `NULL = ANY(...)`
 * would quietly evaluate to NULL rather than raising, so nulls are stripped
 * before the query is built rather than trusted to fail safely.
 *
 * The vector store plugs in behind this same signature: callers (the chatbot
 * chat pipeline, agents, the knowledge test panel) never depend on how
 * retrieval is implemented.
 */

const HEADLINE_OPTIONS = "MaxWords=60, MinWords=25, StartSel=, StopSel=, MaxFragments=1";

interface RetrievalRow {
  id: string;
  title: string;
  uri: string | null;
  snippet: string;
  rank: string | number;
}

export async function retrieveKnowledge(
  workspaceId: string,
  collectionIds: ReadonlyArray<string | null | undefined>,
  queryText: string,
  limit = 4,
): Promise<RetrievedSource[]> {
  const ids = [...new Set(collectionIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0 || !queryText.trim()) return [];

  const rows = await query<RetrievalRow>(
    `WITH q AS (
       -- plainto_tsquery ANDs every lexeme, so "how do I get a refund" would
       -- only match a passage containing both "get" and "refund". OR-ing the
       -- lexemes it parsed keeps PostgreSQL's stemming and stop-word handling
       -- while letting ts_rank_cd decide how much of the query a passage has to
       -- cover — which is what makes question-shaped queries usable.
       SELECT replace(plainto_tsquery('english', $3)::text, ' & ', ' | ')::tsquery AS tsq
     ),
     chunk_hits AS (
       SELECT kc.id, ks.name AS title, ks.uri,
              ts_headline('english', kc.content, q.tsq, '${HEADLINE_OPTIONS}') AS snippet,
              ts_rank_cd(to_tsvector('english', kc.content), q.tsq) AS rank
       FROM knowledge_chunks kc
       JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.workspace_id = kc.workspace_id
       CROSS JOIN q
       WHERE kc.workspace_id = $1
         AND kc.collection_id IS NOT NULL
         AND kc.collection_id = ANY($2::uuid[])
         AND to_tsvector('english', kc.content) @@ q.tsq
     ),
     -- A source that has been ingested but not yet chunked still answers, so a
     -- collection attached mid-import gives grounding instead of silence. The
     -- test is per source rather than per collection: a document whose chunking
     -- failed should fall back to its own text even when its neighbours indexed
     -- cleanly.
     source_hits AS (
       SELECT ks.id, ks.name AS title, ks.uri,
              ts_headline('english', ks.content, q.tsq, '${HEADLINE_OPTIONS}') AS snippet,
              ts_rank_cd(to_tsvector('english', ks.content), q.tsq) AS rank
       FROM knowledge_sources ks
       CROSS JOIN q
       WHERE ks.workspace_id = $1
         AND ks.collection_id IS NOT NULL
         AND ks.collection_id = ANY($2::uuid[])
         AND ks.content IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM knowledge_chunks kc
           WHERE kc.workspace_id = ks.workspace_id AND kc.source_id = ks.id
         )
         AND to_tsvector('english', ks.content) @@ q.tsq
     )
     SELECT * FROM (SELECT * FROM chunk_hits UNION ALL SELECT * FROM source_hits) hits
     ORDER BY hits.rank DESC, hits.title
     LIMIT $4`,
    [workspaceId, ids, queryText, limit],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: row.snippet,
    uri: row.uri,
    score: Number(row.rank),
  }));
}
