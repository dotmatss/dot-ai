-- 0020_chatbot_agent
--
-- Lets a chatbot deploy an existing agent instead of carrying a second copy of
-- the same AI configuration.
--
-- Until now `chatbots` and `agents` were parallel AI workers: each with its own
-- `instructions`, `model_config` and collection links. This adds the optional
-- edge between them, so an agent can be the worker and a chatbot can be the
-- channel it is deployed on.
--
-- ADDITIVE, AND DELIBERATELY SO
-- -----------------------------
-- `agent_id` is NULLABLE and defaults to NULL, which is exactly what every
-- existing row gets. A chatbot with `agent_id IS NULL` keeps using its own
-- columns and behaves precisely as it did before this migration. Nothing is
-- backfilled, nothing is dropped, and `chatbots.instructions`,
-- `chatbots.model_config` and `chatbot_collections` all stay: they are the
-- live configuration for every legacy chatbot and the fallback for any chatbot
-- that is later unlinked.
--
-- WHY THE FOREIGN KEY IS COMPOSITE
-- --------------------------------
-- A plain `agent_id uuid REFERENCES agents(id)` would happily accept an agent
-- belonging to a DIFFERENT workspace. The application checks ownership before
-- writing, but "the application checks it" is the assurance every tenant leak
-- was also given, so the boundary is put where it cannot be forgotten:
--
--   FOREIGN KEY (agent_id, workspace_id) REFERENCES agents (id, workspace_id)
--
-- A chatbot can therefore only ever point at an agent in its OWN workspace -
-- the database will not represent anything else. This needs a UNIQUE key on
-- `agents (id, workspace_id)` to reference; it is redundant with the primary
-- key by construction, and exists solely to be a legal FK target.
--
-- The default MATCH SIMPLE is what keeps legacy rows valid: when any column of
-- a composite foreign key is NULL the constraint is not checked, so a chatbot
-- with no agent is unconstrained while one with an agent is fully constrained.
--
-- WHY ON DELETE RESTRICT
-- ----------------------
-- The alternatives are both worse for a live deployment:
--
--   SET NULL - deleting an agent would silently revert a public chatbot to its
--              old instructions mid-traffic. A behaviour change nobody asked
--              for is the one outcome a deployment must never have.
--   CASCADE  - deleting an agent would delete the customer's chatbot, its embed
--              key and its conversations.
--
-- RESTRICT makes it an explicit decision: unlink the chatbot (or point it at
-- another agent) and then delete. `agent-service.ts` turns the resulting
-- constraint violation into a 409 that names the chatbots still using it, and
-- blocks archiving a referenced agent for the same reason.
--
-- Deleting a WORKSPACE still cascades cleanly. Both `agents` and `chatbots`
-- cascade from `workspaces`, and the referencing chatbot row is removed as
-- part of the same cascade, so RESTRICT never fires. This was verified against
-- PostgreSQL before choosing it rather than assumed.
--
-- NO NEW RLS POLICY
-- -----------------
-- This adds a column to a table that already has RLS enabled and forced, with
-- its `chatbots_workspace_isolation` policy in place. No new table means no new
-- policy, and the composite key above means the column cannot reference a row
-- outside the workspace the policy already pins.

-- Redundant with agents_pkey; exists only so the composite FK below has a
-- unique constraint to reference.
ALTER TABLE agents
  ADD CONSTRAINT agents_id_workspace_id_key UNIQUE (id, workspace_id);

ALTER TABLE chatbots
  ADD COLUMN agent_id uuid;

ALTER TABLE chatbots
  ADD CONSTRAINT chatbots_agent_id_workspace_id_fkey
  FOREIGN KEY (agent_id, workspace_id) REFERENCES agents (id, workspace_id)
  ON DELETE RESTRICT;

-- Answers "which chatbots deploy this agent?", which is asked on every attempt
-- to archive or delete one. Partial: the overwhelming majority of rows are
-- legacy chatbots with no agent, and they are never the answer.
CREATE INDEX chatbots_agent_id_idx ON chatbots (agent_id) WHERE agent_id IS NOT NULL;
