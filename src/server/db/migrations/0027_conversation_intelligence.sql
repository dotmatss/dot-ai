-- 0027_conversation_intelligence
--
-- Conversation Intelligence: what people actually asked, whether the assistant
-- could answer it, and what is missing from the knowledge base.
--
-- WHAT THIS IS FOR
-- ----------------
-- `conversations` and `messages` (migration 0005) already hold every exchange.
-- What they cannot answer is the question every buyer of a chatbot has on day
-- thirty: *is this thing working, and what should I feed it next?* Reading a
-- thousand transcripts by hand is the only way to find that out today.
--
-- These tables hold the derived layer that makes it a query instead: one row of
-- signals per conversation, clustered into topics, with the provenance of the
-- run that produced them.
--
-- WHY DERIVED DATA GETS ITS OWN TABLES
-- ------------------------------------
-- The alternative is to compute this on the fly from `messages`. It does not
-- survive past a demo: grounding is a property of every assistant message in
-- the thread, clustering is O(conversations x topics) over embedding vectors,
-- and a topic label costs a model call. None of that belongs in a page render.
--
-- Nothing here is a source of truth. Every column is recomputable from
-- `conversations` and `messages`, so the whole set is safe to truncate and
-- rebuild, and a deleted `conversations` row cascades its insight away.
--
-- WHY THE CENTROID CARRIES ITS EMBEDDING CONFIG
-- ---------------------------------------------
-- Same reason `knowledge_documents.embedding_config` exists (migration 0008):
-- a centroid produced by one embedding model is meaningless against vectors
-- from another, and the failure is silent - every similarity just drifts. The
-- config travels with the vector so a provider change invalidates the topic
-- rather than quietly mixing two vector spaces.
--
-- WHY VECTORS ARE double precision[] AND NOT pgvector
-- ---------------------------------------------------
-- Consistency with `knowledge_chunks.embedding`, and the same reasoning: the
-- extension is not assumed present, the clustering pass is bounded and runs in
-- the service rather than the database, and storing the vectors now lets an
-- index be added later without a backfill.

CREATE TYPE conversation_outcome AS ENUM ('contained', 'handed_off', 'escalated', 'unresolved');
CREATE TYPE analysis_run_status AS ENUM ('running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- Topics
-- ---------------------------------------------------------------------------

CREATE TABLE conversation_topics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Written by the model, then editable by a human. A topic nobody has labelled
  -- yet carries its own first question as a placeholder, never an empty string:
  -- an unlabelled row still has to be readable in a list.
  label              text NOT NULL,
  summary            text,
  -- Running mean of its members' question vectors, L2-normalized on write.
  centroid           double precision[] NOT NULL,
  embedding_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Counters maintained by the analysis run. They are a cache of
  -- `conversation_insights`, recomputed wholesale rather than incremented, so a
  -- partial run cannot leave them permanently skewed.
  conversation_count integer NOT NULL DEFAULT 0,
  contained_count    integer NOT NULL DEFAULT 0,
  grounded_count     integer NOT NULL DEFAULT 0,
  escalated_count    integer NOT NULL DEFAULT 0,
  -- `labeled_size` is the conversation_count at the moment the label was
  -- written. A run relabels a topic once it has grown meaningfully past that,
  -- which is what stops a model call per topic per run.
  labeled_at         timestamptz,
  labeled_size       integer NOT NULL DEFAULT 0,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The list is always "biggest topics in this workspace first". `id` breaks
-- ties, or a topic can appear on two pages of the list, or on none.
CREATE INDEX conversation_topics_workspace_size_idx
  ON conversation_topics(workspace_id, conversation_count DESC, id DESC);
CREATE INDEX conversation_topics_workspace_seen_idx
  ON conversation_topics(workspace_id, last_seen_at DESC NULLS LAST);

CREATE TRIGGER conversation_topics_set_updated_at
  BEFORE UPDATE ON conversation_topics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-conversation signals
-- ---------------------------------------------------------------------------

CREATE TABLE conversation_insights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topic_id           uuid REFERENCES conversation_topics(id) ON DELETE SET NULL,
  -- The opening user message, trimmed. This is what gets embedded and what the
  -- topic list shows as an example, so it is stored rather than re-derived.
  question           text NOT NULL,
  embedding          double precision[],
  outcome            conversation_outcome NOT NULL,
  -- True when at least one assistant reply in the thread cited a knowledge
  -- source. The single most useful signal here: an ungrounded answer is one the
  -- model produced from its own weights, which is what a knowledge gap looks
  -- like from the outside.
  grounded           boolean NOT NULL DEFAULT false,
  user_message_count integer NOT NULL DEFAULT 0,
  source_count       integer NOT NULL DEFAULT 0,
  -- Cosine similarity to the topic centroid at assignment time. Kept so a weak
  -- assignment stays visible instead of being indistinguishable from a
  -- confident one.
  topic_similarity   double precision,
  -- When the CONVERSATION happened, not when it was analyzed. The two are
  -- different questions and conflating them makes a topic's "last seen" read
  -- as the time of the last run - which, since every run re-analyzes its whole
  -- window, would be "just now" for every topic forever.
  conversation_at    timestamptz NOT NULL,
  analyzed_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One insight per conversation. The analysis upserts on this key, which is what
-- makes a re-run idempotent rather than duplicating every row.
CREATE UNIQUE INDEX conversation_insights_conversation_idx
  ON conversation_insights(conversation_id);
CREATE INDEX conversation_insights_workspace_analyzed_idx
  ON conversation_insights(workspace_id, analyzed_at DESC);
-- Ordered by conversation time: the topic detail shows what people asked most
-- recently, which is not the same as what was analyzed most recently.
CREATE INDEX conversation_insights_topic_idx
  ON conversation_insights(topic_id, conversation_at DESC);
-- Serves the "ungrounded conversations in this workspace" scan behind the
-- knowledge-gap view; partial because grounded rows are not what it looks for.
CREATE INDEX conversation_insights_workspace_gap_idx
  ON conversation_insights(workspace_id, analyzed_at DESC)
  WHERE grounded = false;

CREATE TRIGGER conversation_insights_set_updated_at
  BEFORE UPDATE ON conversation_insights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Run provenance
-- ---------------------------------------------------------------------------

-- Every number on the Intelligence page is exactly as old as the run that
-- produced it. Without this table the page would have to present derived
-- figures as though they were live, which is the same dishonesty as a workflow
-- diagram implying a step executed.
CREATE TABLE conversation_analysis_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status                 analysis_run_status NOT NULL DEFAULT 'running',
  window_start           timestamptz,
  window_end             timestamptz,
  conversations_analyzed integer NOT NULL DEFAULT 0,
  topics_created         integer NOT NULL DEFAULT 0,
  topics_labeled         integer NOT NULL DEFAULT 0,
  tokens_in              integer NOT NULL DEFAULT 0,
  tokens_out             integer NOT NULL DEFAULT 0,
  -- A human-readable reason, never a provider payload: this is rendered.
  error                  text,
  started_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  finished_at            timestamptz
);

CREATE INDEX conversation_analysis_runs_workspace_started_idx
  ON conversation_analysis_runs(workspace_id, started_at DESC);
-- At most one run in flight per workspace, enforced by the database rather than
-- by a check-then-insert in the service, which races with itself.
CREATE UNIQUE INDEX conversation_analysis_runs_one_active_idx
  ON conversation_analysis_runs(workspace_id)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE conversation_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_topics FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_topics_workspace_isolation ON conversation_topics
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

ALTER TABLE conversation_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_insights FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_insights_workspace_isolation ON conversation_insights
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

ALTER TABLE conversation_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_analysis_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_analysis_runs_workspace_isolation ON conversation_analysis_runs
  USING (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    nullif(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
