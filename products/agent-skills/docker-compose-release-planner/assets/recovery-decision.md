# Recovery decision

1. Which failure signal has actually been observed, in which environment and revision?
2. Is the incident still growing, and what existing containment procedure is authorized?
3. Can the prior application safely read/write the current schema and storage format? Cite evidence.
4. What writes, jobs and provider callbacks happened after the recovery point? Which are unknown?
5. Is application rollback sufficient, or is forward repair/data restore required?
6. Which tested runbook applies, who decides, and what authorization is still required?
7. If restoring, what data could be lost and how will queued/provider side effects be reconciled?
8. Which health, browser, persisted-state and downstream checks establish recovery?

If a required answer is unknown, state the blocker rather than constructing an unsafe command sequence. A backup existing is distinct from a demonstrated recovery path.
