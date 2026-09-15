-- 0022_agent_execution_workflow_run
--
-- Links an agent execution to the workflow run that caused it.
--
-- A workflow may now run an agent (`agent.run`, migration-free on the workflow
-- side: the node type lives in the registry and the definition is jsonb). The
-- agent's turn is recorded in `agent_executions` exactly as a delegated turn
-- is, so the whole tree - workflow run → agent execution → any agents that
-- agent delegated to - is reconstructable from two indexed lookups.
--
-- Nullable, because most executions are started by a person in the playground
-- or by a supervisor, not by a workflow. SET NULL on delete for the same reason
-- `conversation_id` is: the record of what ran outlives the thing that ran it.
--
-- No new RLS: this is a column on a table whose policy is already in force.

ALTER TABLE agent_executions
  ADD COLUMN workflow_run_id uuid REFERENCES workflow_runs(id) ON DELETE SET NULL;

-- "Which agents did this run execute?", asked from the run detail page.
CREATE INDEX agent_executions_workflow_run_idx
  ON agent_executions (workflow_run_id, started_at)
  WHERE workflow_run_id IS NOT NULL;
