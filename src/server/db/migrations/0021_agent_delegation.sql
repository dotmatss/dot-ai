-- 0021_agent_delegation
--
-- Supervisor agents: an agent that may delegate a task to other agents in its
-- own workspace, and a record of every execution so the delegation can be
-- bounded and traced.
--
-- A SUPERVISOR IS A CAPABILITY, NOT A SUBCLASS
-- --------------------------------------------
-- `agents.can_delegate` is a flag on the existing table. There is no separate
-- supervisor entity, no type enum and no inheritance: a supervisor is an agent
-- that has been granted one extra capability, so every route, policy and test
-- that already works on agents keeps working unchanged. The UI presents
-- "Standard" and "Supervisor"; storage stays a boolean.
--
-- `delegation_config` holds the per-agent limits (depth, delegations, deadline,
-- token budget). It is jsonb for the same reason `model_config` is, but it is
-- NOT trusted: `delegationConfigSchema` parses it on read and clamps every
-- value to the hard ceilings in `features/agents/delegation-limits.ts`. Nothing
-- a customer can write into this column can raise a limit beyond those.
--
-- CROSS-WORKSPACE DELEGATION IS UNREPRESENTABLE
-- ---------------------------------------------
-- Both sides of `agent_delegations` use the composite foreign key introduced
-- for chatbots in 0020:
--
--   FOREIGN KEY (supervisor_agent_id, workspace_id) REFERENCES agents (id, workspace_id)
--   FOREIGN KEY (child_agent_id,      workspace_id) REFERENCES agents (id, workspace_id)
--
-- One `workspace_id` column serves both, so a grant whose two agents live in
-- different workspaces cannot be written at all - the database has no row shape
-- for it. Application checks are still there, but they are the second line.
--
-- Self-delegation is refused by a CHECK rather than by the runtime, because
-- "an agent may not delegate to itself" is a property of the data, and the
-- cheapest place to make a cycle impossible is the shortest cycle.
--
-- WHY A SEPARATE EXECUTION TABLE
-- ------------------------------
-- `workflow_runs` records a run of a *definition*; this records a run of an
-- *agent*, carries a parent/child tree, and is what the depth, delegation-count
-- and budget limits are enforced against. Overloading either table with the
-- other's columns would leave most of them null on most rows.
--
-- Child executions deliberately do NOT create conversations. A delegated task
-- is not something the user started a thread about, and one conversation per
-- child would fill the inbox with fragments. The tree lives here; the single
-- user-facing conversation stays the supervisor's.

ALTER TABLE agents
  ADD COLUMN can_delegate boolean NOT NULL DEFAULT false,
  ADD COLUMN delegation_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Delegation grants
-- ---------------------------------------------------------------------------
CREATE TABLE agent_delegations (
  supervisor_agent_id uuid NOT NULL,
  child_agent_id      uuid NOT NULL,
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Revoking without forgetting. A disabled grant keeps the configuration a
  -- person made, and is refused at delegation time like a missing one.
  enabled             boolean NOT NULL DEFAULT true,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (supervisor_agent_id, child_agent_id),

  CONSTRAINT agent_delegations_no_self_delegation
    CHECK (supervisor_agent_id <> child_agent_id),

  CONSTRAINT agent_delegations_supervisor_fkey
    FOREIGN KEY (supervisor_agent_id, workspace_id) REFERENCES agents (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT agent_delegations_child_fkey
    FOREIGN KEY (child_agent_id, workspace_id) REFERENCES agents (id, workspace_id) ON DELETE CASCADE
);

-- "Which supervisors may call this agent?", asked when an agent is archived or
-- deleted. The forward direction is served by the primary key.
CREATE INDEX agent_delegations_child_idx ON agent_delegations (child_agent_id);

-- ---------------------------------------------------------------------------
-- Executions
-- ---------------------------------------------------------------------------
CREATE TYPE agent_execution_status AS ENUM ('running', 'succeeded', 'failed', 'timed_out', 'refused');

CREATE TABLE agent_executions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Nulled rather than cascaded, like mcp_tool_calls.agent_id: the record of
  -- what ran must outlive the configuration that ran it.
  agent_id            uuid REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id     uuid REFERENCES conversations(id) ON DELETE SET NULL,

  -- The tree. `root_execution_id` is the row's own id on a root execution, so
  -- "every execution in this request" is one indexed equality either way.
  root_execution_id   uuid NOT NULL,
  parent_execution_id uuid REFERENCES agent_executions(id) ON DELETE CASCADE,

  -- Every agent from the root to this one, inclusive. Cycle detection is a
  -- membership test against this array, which is why it is stored rather than
  -- recomputed by walking parents.
  agent_path          uuid[] NOT NULL,
  depth               integer NOT NULL DEFAULT 0,

  status              agent_execution_status NOT NULL DEFAULT 'running',

  -- What was delegated, and what came back. Null on a root execution, whose
  -- input is the conversation.
  input_task          text,
  output              text,
  error               text,

  -- True when the turn asked for an MCP tool that stopped for a person. The
  -- execution still succeeded; the action did not happen yet.
  requires_approval   boolean NOT NULL DEFAULT false,

  -- Budget is enforced against the sum of these across one root execution.
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,

  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,

  CONSTRAINT agent_executions_depth_non_negative CHECK (depth >= 0)
);

-- The execution tree for one request, and the workspace's recent history.
CREATE INDEX agent_executions_root_idx ON agent_executions (root_execution_id, started_at);
CREATE INDEX agent_executions_workspace_idx ON agent_executions (workspace_id, started_at DESC);
CREATE INDEX agent_executions_agent_idx ON agent_executions (agent_id, started_at DESC)
  WHERE agent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Same cast-safe predicate and the same FORCE as 0015 and 0017: nullif() first,
-- because PostgreSQL does not guarantee OR short-circuiting, and FORCE because
-- the application usually connects as the table owner.
DO $$
DECLARE
  predicate constant text :=
    $p$(
       nullif(current_setting('app.workspace_id', true), '') IS NULL
       OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
     )$p$;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_delegations', 'agent_executions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING %s WITH CHECK %s',
      t || '_workspace_isolation',
      t,
      predicate,
      predicate
    );
  END LOOP;
END $$;

-- `updated_at` is maintained by the same trigger every other table uses.
CREATE TRIGGER agent_delegations_set_updated_at
  BEFORE UPDATE ON agent_delegations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
