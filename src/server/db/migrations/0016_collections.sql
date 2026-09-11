-- 0016_collections
--
-- Knowledge bases become Collections, and a document no longer has to live in
-- one.
--
-- WHY THE RENAME
-- --------------
-- `knowledge_bases` was doing two jobs at once: it was how people organised
-- their documents, AND it was the retrieval scope, AND it owned the embedding
-- configuration. That conflation is what makes a knowledge platform drift into
-- being a file manager — the grouping a person picks for their own convenience
-- ends up dictating how the content is vectorised.
--
-- A Collection is now only the first of those: a named, logical grouping of
-- documents inside a workspace. Everything about *how* content is indexed moved
-- down onto the document, where the vectors actually live.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not a folder. A folder implies the document physically belongs there,
-- so deleting the folder deletes the contents. A collection is a grouping, so
-- deleting one un-files its documents (see the ON DELETE SET NULL below) and
-- destroys nothing. Deleting documents is its own, explicit action.
--
-- No rows are created or destroyed by this migration. Every knowledge base
-- becomes a collection carrying the same id, so every chatbot and agent
-- attachment, every source and every indexed chunk still points at the same
-- row it did before.

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

ALTER TABLE knowledge_bases         RENAME TO knowledge_collections;
ALTER TABLE chatbot_knowledge_bases RENAME TO chatbot_collections;
ALTER TABLE agent_knowledge_bases   RENAME TO agent_collections;

ALTER TABLE knowledge_sources     RENAME COLUMN knowledge_base_id TO collection_id;
ALTER TABLE knowledge_chunks      RENAME COLUMN knowledge_base_id TO collection_id;
ALTER TABLE chatbot_collections   RENAME COLUMN knowledge_base_id TO collection_id;
ALTER TABLE agent_collections     RENAME COLUMN knowledge_base_id TO collection_id;

ALTER TYPE knowledge_base_status RENAME TO collection_status;

-- ---------------------------------------------------------------------------
-- Unorganized
-- ---------------------------------------------------------------------------
-- A NULL collection_id is the Unorganized bucket: a document that has been
-- uploaded and indexed but not yet filed. It is deliberately NOT a row in
-- knowledge_collections — a sentinel collection would be selectable when
-- attaching knowledge to an agent, and "everything nobody has filed yet" is
-- exactly the scope an agent must never be given by accident.
--
-- Unorganized documents are still ingested, chunked and embedded. They are
-- simply out of every retrieval scope until someone files them, because
-- retrieval scopes by collection id and NULL matches no id.

ALTER TABLE knowledge_sources ALTER COLUMN collection_id DROP NOT NULL;
ALTER TABLE knowledge_chunks  ALTER COLUMN collection_id DROP NOT NULL;

-- Deleting a collection un-files its documents rather than destroying them.
-- This is the whole difference between a collection and a folder, so it is
-- enforced by the foreign key rather than left to application code.
ALTER TABLE knowledge_sources DROP CONSTRAINT knowledge_sources_knowledge_base_id_fkey;
ALTER TABLE knowledge_sources
  ADD CONSTRAINT knowledge_sources_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE SET NULL;

ALTER TABLE knowledge_chunks DROP CONSTRAINT knowledge_chunks_knowledge_base_id_fkey;
ALTER TABLE knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE SET NULL;

-- The join tables keep CASCADE: an attachment to a collection that no longer
-- exists is meaningless, and dropping the row is the correct outcome.
ALTER TABLE chatbot_collections DROP CONSTRAINT chatbot_knowledge_bases_knowledge_base_id_fkey;
ALTER TABLE chatbot_collections
  ADD CONSTRAINT chatbot_collections_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE;

ALTER TABLE agent_collections DROP CONSTRAINT agent_knowledge_bases_knowledge_base_id_fkey;
ALTER TABLE agent_collections
  ADD CONSTRAINT agent_collections_collection_id_fkey
  FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Embedding configuration moves from the collection to the document
-- ---------------------------------------------------------------------------
-- The config records how content was vectorised, so it belongs beside the
-- vectors. Keeping it on the grouping broke in two ways once documents could
-- move: an Unorganized document had no row to read it from, and filing a
-- document into a different collection appeared to change how it was indexed
-- without re-indexing anything.
--
-- Each document inherits the config of the collection it is in today, so no
-- existing document changes its recorded provider or dimensions.

ALTER TABLE knowledge_sources ADD COLUMN embedding_config jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE knowledge_sources ks
   SET embedding_config = kc.embedding_config
  FROM knowledge_collections kc
 WHERE kc.id = ks.collection_id
   AND kc.embedding_config <> '{}'::jsonb;

ALTER TABLE knowledge_collections DROP COLUMN embedding_config;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

ALTER INDEX knowledge_bases_workspace_id_idx  RENAME TO knowledge_collections_workspace_id_idx;
ALTER INDEX knowledge_sources_kb_idx          RENAME TO knowledge_sources_collection_idx;
ALTER INDEX knowledge_chunks_kb_position_idx  RENAME TO knowledge_chunks_collection_position_idx;

-- All Knowledge lists every document in a workspace newest first, across and
-- outside collections. The old index was on workspace_id alone, which left
-- that query sorting the whole tenant's documents on every page.
DROP INDEX knowledge_sources_workspace_idx;
CREATE INDEX knowledge_sources_workspace_created_idx ON knowledge_sources(workspace_id, created_at DESC);

-- Unorganized is a working queue people empty, so it is read far more often
-- than its size suggests. A partial index keeps it an index scan without
-- carrying every filed document.
CREATE INDEX knowledge_sources_unorganized_idx
  ON knowledge_sources(workspace_id, created_at DESC)
  WHERE collection_id IS NULL;

-- ---------------------------------------------------------------------------
-- Triggers and Row Level Security
-- ---------------------------------------------------------------------------
-- Renaming a table carries its policies and triggers across under their old
-- names. tests/unit/rls.integration.test.ts asserts the
-- `<table>_workspace_isolation` convention for every tenant table, so the
-- policies are renamed to match rather than dropped and recreated — the
-- cast-safe predicate from 0014 and the FORCE from 0013 are preserved as they
-- are.

ALTER TRIGGER knowledge_bases_set_updated_at ON knowledge_collections
  RENAME TO knowledge_collections_set_updated_at;

ALTER POLICY knowledge_bases_workspace_isolation ON knowledge_collections
  RENAME TO knowledge_collections_workspace_isolation;
ALTER POLICY chatbot_knowledge_bases_workspace_isolation ON chatbot_collections
  RENAME TO chatbot_collections_workspace_isolation;
ALTER POLICY agent_knowledge_bases_workspace_isolation ON agent_collections
  RENAME TO agent_collections_workspace_isolation;

-- ---------------------------------------------------------------------------
-- Leftover constraint names
-- ---------------------------------------------------------------------------
-- Renaming a table does not rename its constraints. These are cosmetic, but a
-- `knowledge_bases_pkey` violation reported against a table that no longer
-- exists under that name is a genuinely confusing thing to debug at 3am.

ALTER TABLE knowledge_collections RENAME CONSTRAINT knowledge_bases_pkey              TO knowledge_collections_pkey;
ALTER TABLE knowledge_collections RENAME CONSTRAINT knowledge_bases_workspace_id_fkey TO knowledge_collections_workspace_id_fkey;
ALTER TABLE knowledge_collections RENAME CONSTRAINT knowledge_bases_created_by_fkey   TO knowledge_collections_created_by_fkey;

ALTER TABLE chatbot_collections RENAME CONSTRAINT chatbot_knowledge_bases_pkey              TO chatbot_collections_pkey;
ALTER TABLE chatbot_collections RENAME CONSTRAINT chatbot_knowledge_bases_chatbot_id_fkey   TO chatbot_collections_chatbot_id_fkey;
ALTER TABLE chatbot_collections RENAME CONSTRAINT chatbot_knowledge_bases_workspace_id_fkey TO chatbot_collections_workspace_id_fkey;

ALTER TABLE agent_collections RENAME CONSTRAINT agent_knowledge_bases_pkey              TO agent_collections_pkey;
ALTER TABLE agent_collections RENAME CONSTRAINT agent_knowledge_bases_agent_id_fkey     TO agent_collections_agent_id_fkey;
ALTER TABLE agent_collections RENAME CONSTRAINT agent_knowledge_bases_workspace_id_fkey TO agent_collections_workspace_id_fkey;
