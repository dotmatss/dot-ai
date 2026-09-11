-- 0017_mcp_tool_calls
--
-- Model Context Protocol, phase 2: the execution record.
--
-- 0015 deliberately did not create this table, because phase 1 executed
-- nothing and an always-empty audit table reads as though calls were being
-- recorded. Phase 2b executes tools, so the record now exists.
--
-- One table serves two purposes, and that is deliberate rather than thrifty:
--
--  1. The audit log. Every decision about a tool call is written here,
--     including the refusals — a call that was blocked because a grant had gone
--     stale is exactly the event an operator needs to see, and a log that only
--     records successes cannot answer "did anything try".
--  2. The approvals queue. A call that stops for a person is the same row in
--     `awaiting_approval`, later moved to `denied`, or to `running` and then
--     `executed`/`failed` once a person says yes. A separate queue table would
--     mean two sources of truth for one call.
--
-- The two status columns are not redundant:
--
--  * `resolution` is the permission decision, from the same vocabulary the
--    pure resolver in src/features/mcp/grants.ts returns. It says WHY.
--  * `status` is the lifecycle. It says WHAT HAPPENED.
--
-- Keeping them apart is what lets "refused because the grant was stale" and
-- "refused because the server was switched off" stay distinguishable after the
-- fact, without parsing a message.

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- The lifecycle.
--
-- `running` is written BEFORE the call leaves, so a process that dies mid-call
-- leaves a record saying we attempted something and never learned the outcome.
-- Recording that as 'failed' would be a lie in an audit log, and recording
-- nothing at all is worse: for a destructive tool, "no row" and "did not run"
-- must not look the same.
--
-- `failed` means we called the tool and the call did not complete (network,
-- protocol, timeout). A tool that ran and reported a business error is
-- 'executed' with is_error = true, because it did run and may have had effects.
CREATE TYPE mcp_call_status AS ENUM (
  'refused',
  'awaiting_approval',
  'denied',
  'running',
  'executed',
  'failed',
  'expired'
);

-- Mirrors MCP_RESOLUTION_STATUSES. Kept as an enum rather than text so a
-- status this application does not know cannot be written.
CREATE TYPE mcp_resolution_status AS ENUM (
  'resolved',
  'not_granted',
  'not_attached',
  'stale_grant',
  'approval_required',
  'server_unavailable',
  'unknown_tool'
);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
CREATE TABLE mcp_tool_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Nullable on purpose: a call for a server this workspace does not have is
  -- still worth recording, and there is no row to point at.
  mcp_server_id     uuid REFERENCES mcp_servers(id) ON DELETE SET NULL,

  -- Which agent asked, and in which conversation. Both survive the agent being
  -- deleted as NULL, because the audit record must outlive the configuration.
  agent_id          uuid REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,

  -- The reference as the model asked for it, plus the parsed tool name. Both,
  -- because the reference is what was requested and the name is what was
  -- looked up, and a mismatch between them is itself diagnostic.
  tool_ref          text NOT NULL,
  tool_name         text NOT NULL,

  status            mcp_call_status NOT NULL,
  resolution        mcp_resolution_status NOT NULL,

  -- The classification and the pin in force at decision time. Copied rather
  -- than joined: a grant can be changed or revoked afterwards, and the record
  -- must say what was true when the call was decided.
  risk_class        mcp_risk_class,
  approved_hash     text,

  -- What the model asked for. Customer data in the customer's own row, bounded
  -- by MCP_LIMITS.maxArgumentBytes before it gets here.
  arguments         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What came back. Bounded and truncated before storage; `result_bytes` is
  -- the size before truncation so the log does not misreport it.
  result            jsonb,
  result_bytes      integer,
  result_truncated  boolean NOT NULL DEFAULT false,

  -- The server's own error flag. Distinct from `status = 'failed'`.
  is_error          boolean NOT NULL DEFAULT false,

  -- Sanitised. Never an endpoint URL (which can itself carry a token), never a
  -- credential, never a raw response body.
  error_message     text,

  duration_ms       integer,

  -- Who ran the turn, and who decided an approval. Different people.
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at        timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A call that stopped for a person must name the tool it would have run, or
  -- the queue cannot describe what it is asking about.
  CONSTRAINT mcp_tool_calls_awaiting_needs_server
    CHECK (status <> 'awaiting_approval' OR mcp_server_id IS NOT NULL),

  -- A decision has a decider and a time, or it has neither. Half a decision is
  -- an audit record nobody can rely on.
  CONSTRAINT mcp_tool_calls_decision_is_complete
    CHECK ((decided_at IS NULL) = (decided_by IS NULL)),

  -- Only an executed call may carry a duration or a result: recording either
  -- against a refusal would imply we called something we did not.
  CONSTRAINT mcp_tool_calls_only_executed_has_result
    CHECK (status IN ('executed', 'failed') OR (result IS NULL AND duration_ms IS NULL))
);

-- The audit view: most recent first, per workspace.
CREATE INDEX mcp_tool_calls_workspace_idx ON mcp_tool_calls(workspace_id, created_at DESC);

-- The queue. Partial, because the pending set is tiny next to the log and this
-- is the query a person's screen polls.
CREATE INDEX mcp_tool_calls_pending_idx
  ON mcp_tool_calls(workspace_id, created_at)
  WHERE status = 'awaiting_approval';

CREATE INDEX mcp_tool_calls_server_idx ON mcp_tool_calls(mcp_server_id, created_at DESC);
CREATE INDEX mcp_tool_calls_conversation_idx ON mcp_tool_calls(conversation_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE TRIGGER mcp_tool_calls_set_updated_at
  BEFORE UPDATE ON mcp_tool_calls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Same cast-safe predicate and the same FORCE as 0015: nullif() first, because
-- PostgreSQL does not guarantee OR short-circuiting, and FORCE because the
-- application usually connects as the table owner.
DO $$
DECLARE predicate constant text :=
  $p$(
     nullif(current_setting('app.workspace_id', true), '') IS NULL
     OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
   )$p$;
BEGIN
  EXECUTE 'ALTER TABLE mcp_tool_calls ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE mcp_tool_calls FORCE ROW LEVEL SECURITY';
  EXECUTE format(
    'CREATE POLICY %I ON public.mcp_tool_calls USING %s WITH CHECK %s',
    'mcp_tool_calls_workspace_isolation',
    predicate,
    predicate
  );
END $$;
