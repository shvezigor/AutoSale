# PostgreSQL boundary checklist

Build a small matrix: actor -> authorized tenant -> runtime database role -> transaction/context -> operation -> policy -> result. Check table owner, superuser and BYPASSRLS behavior; FORCE RLS subjects an ordinary table owner, not superusers or BYPASSRLS roles. Check role inheritance and membership rather than only the login role's name.

For selected operations inspect USING, WITH CHECK, command/role applicability and permissive/restrictive composition. RLS normally defaults to denial when enabled without an applicable policy, but whole-table operations and privileged paths need separate treatment. Do not broaden a row-access review into destructive TRUNCATE tests.

For context propagation, distinguish authenticated authorization from storing a tenant variable. A client-controllable session setting is not by itself a trusted identity. Verify transaction ownership, rollback paths, pool release/reset and worker lifecycle. Parameterized SQL prevents some injection; it does not establish tenant ownership.

For relations/batches: ensure foreign keys and parent lookups cannot cross boundaries; examine mixed A/B ID inputs, affected-row behavior and atomicity expectations. Cache/search/export results can leak after a correctly scoped database read if their own identity or authorization is wrong.

Primary references: [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html), [SET](https://www.postgresql.org/docs/current/sql-set.html), [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html). Check the deployed version and relevant view/function semantics before asserting exact behavior. These links support the audit method; package creation did not run a database or prove a buyer's configuration.
