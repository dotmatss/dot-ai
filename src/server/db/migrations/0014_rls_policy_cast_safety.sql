-- 0014_rls_policy_cast_safety
--
-- The workspace isolation policies were written as:
--
--   current_setting('app.workspace_id', true) IS NULL
--   OR current_setting('app.workspace_id', true) = ''
--   OR workspace_id = current_setting('app.workspace_id', true)::uuid
--
-- PostgreSQL does not guarantee the evaluation order of OR branches, so the
-- cast can run even when an earlier branch is already true. That matters
-- because `set_config('app.workspace_id', …, true)` is transaction-local and
-- restores to the empty string (not NULL) at COMMIT: after one withWorkspace()
-- transaction, every later *unscoped* query on that pooled connection could
-- fail with `invalid input syntax for type uuid: ""`. Dashboard aggregates and
-- any maintenance query share the pool with scoped writes, so this was a real
-- source of intermittent 500s rather than a theoretical one.
--
-- The replacement is cast-safe in every branch: nullif() turns the empty string
-- into NULL first, and NULL::uuid is valid. An unset scope yields NULL, which
-- makes the equality NULL (not true), so the explicit IS NULL branch is what
-- allows migrations, the seed script and cross-workspace jobs through.

DO $$
DECLARE target record;
DECLARE predicate constant text :=
  $p$(
     nullif(current_setting('app.workspace_id', true), '') IS NULL
     OR workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
   )$p$;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target.relname || '_workspace_isolation', target.relname);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I USING %s WITH CHECK %s',
      target.relname || '_workspace_isolation',
      target.relname,
      predicate,
      predicate
    );
  END LOOP;
END $$;
