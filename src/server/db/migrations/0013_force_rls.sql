-- 0013_force_rls
--
-- ENABLE ROW LEVEL SECURITY does not apply policies to the table's owner, and
-- the application connects as the role that ran the migrations in most local
-- and small deployments. The workspace isolation policies added in 0001 (and by
-- later feature migrations) were therefore inert for exactly the connection the
-- application uses: the explicit `workspace_id = $n` filters in repository SQL
-- were doing all the work, with no defence in depth behind them.
--
-- FORCE ROW LEVEL SECURITY applies the policies to the owner as well. The
-- policies are written to pass when `app.workspace_id` is unset, so migrations,
-- the seed script and any cross-workspace maintenance still work; only code
-- running inside `withWorkspace()` is constrained, which is the intent.
--
-- This is written as a loop over whatever currently has RLS enabled so it stays
-- correct no matter which feature migrations have run. New tenant tables should
-- enable AND force RLS in their own migration.

DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', target.relname);
  END LOOP;
END $$;
