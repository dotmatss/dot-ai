-- 0010_crm
--
-- The CRM tables (contacts, contact_notes, contact_activities) were created in
-- 0001 together with their RLS policies, so this migration adds no tables and
-- no policies - only the index the contacts list needs.
--
-- The list is ordered by `created_at DESC` because "Created" is a column the
-- user can see, and a newly added contact has to appear at the top. 0001 only
-- indexed (workspace_id, updated_at DESC), which does not serve that ordering,
-- so every page of a busy workspace would sort the whole tenant's rows.
--
-- `id` is appended to break ties: two contacts imported in the same statement
-- share `created_at`, and without a tiebreaker the same row can appear on two
-- pages (or on none) as the planner is free to order equal keys differently
-- between the LIMIT/OFFSET queries.

CREATE INDEX IF NOT EXISTS contacts_workspace_created_idx
  ON contacts(workspace_id, created_at DESC, id DESC);
