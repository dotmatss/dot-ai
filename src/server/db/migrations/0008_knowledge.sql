-- 0008_knowledge
-- Chunk store for the RAG pipeline.
--
-- A knowledge source is split into overlapping, roughly token-sized chunks;
-- those chunks — not the whole document — are what retrieval ranks and what the
-- model is grounded on. Chunks are derived data: they are replaced wholesale
-- whenever a source is reprocessed, and cascade away with the source, the
-- knowledge base or the workspace.
--
-- `embedding` is a plain double precision[] rather than a pgvector column so
-- the schema works on a stock PostgreSQL. Retrieval today ranks with full-text
-- search (see the GIN index below); the column stores vectors produced by the
-- EmbeddingProvider so a vector index can be introduced later without
-- re-ingesting content.

CREATE TABLE knowledge_chunks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_id         uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  position          integer NOT NULL,
  content           text NOT NULL,
  token_count       integer NOT NULL DEFAULT 0,
  embedding         double precision[],
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Retrieval scans one knowledge base at a time and reads chunks in document
-- order when scores tie.
CREATE INDEX knowledge_chunks_kb_position_idx ON knowledge_chunks(knowledge_base_id, position);

-- PostgreSQL does not index foreign key columns automatically: without this,
-- replacing a source's chunks and cascading a source delete both seq-scan.
CREATE INDEX knowledge_chunks_source_idx ON knowledge_chunks(source_id, position);

CREATE INDEX knowledge_chunks_workspace_idx ON knowledge_chunks(workspace_id);

-- Keyword retrieval: the expression must match the one used by
-- retrieveKnowledge() exactly for the index to be usable.
CREATE INDEX knowledge_chunks_content_fts_idx ON knowledge_chunks USING gin (to_tsvector('english', content));

-- ---------------------------------------------------------------------------
-- Row Level Security (defense in depth) — same shape as 0001_initial.sql
-- ---------------------------------------------------------------------------
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- When app.workspace_id is unset (system jobs, migrations) the policy is permissive
-- for the table owner; when set, rows are restricted to that workspace.
CREATE POLICY knowledge_chunks_workspace_isolation ON knowledge_chunks USING (
  current_setting('app.workspace_id', true) IS NULL
  OR current_setting('app.workspace_id', true) = ''
  OR workspace_id = current_setting('app.workspace_id', true)::uuid
) WITH CHECK (
  current_setting('app.workspace_id', true) IS NULL
  OR current_setting('app.workspace_id', true) = ''
  OR workspace_id = current_setting('app.workspace_id', true)::uuid
);
