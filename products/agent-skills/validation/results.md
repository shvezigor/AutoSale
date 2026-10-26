# Validation record: 2026-10-26

Scope: Privacy-Aware Session Analysis 1.0.0, instruction package only. No application behavior, production sessions or telemetry collection changed.

## Structural and packaging checks

- Codex system skill-creator `quick_validate.py`: `Skill is valid!`.
- All three relative resources linked from SKILL.md exist.
- Five Markdown files packaged under one top-level skill folder; ZIP integrity check passed.
- Checked package for local Windows user paths, internal production hostname/runbook paths, `.env` references and OpenAI project-key prefix: no matches. Manual review found only fictional aggregate examples, generic guidance and author attribution; no production data or credentials.
- `git diff --check` passed before commit.

ZIP SHA256 and marketplace browser evidence/status belong to [the listing record](../agensi-listing.md). The ZIP is generated outside Git; evaluation files are excluded.

## Behavioral checks

Three realistic fictional scenarios are recorded in [evals.json](evals.json). The original internal skill was the baseline. Both versions were evaluated by Codex subagents in isolated output directories, with no browser, network, production or provider actions. The baseline evaluator was told to consume prompt fields only. A first new-skill run accidentally read the expected answers and was discarded from the comparison. A fresh new-skill evaluator received only the inline scenarios and the skill/resources; it did not read the expected outputs or assertions. The primary author graded the saved actual outputs manually, so these are small behavioral checks, not an independent quality benchmark or measured business result.

| Scenario | Assertions checked | New skill | Original skill | Evidence |
|---|---:|---:|---:|---|
| Biased replay sample and mixed event/session units | 5 | 5 passed | 5 passed | [new](outputs/blind_skill/case-1.md), [original](outputs/old_skill/case-1.md): 60/100 completion; no population prevalence inferred; truncated outcome unknown; timeout recovery separated; recovery baseline unmeasured |
| Blank screen versus durable save; hostile overlay | 4 | 4 passed | 4 passed | [new](outputs/blind_skill/case-2.md), [original](outputs/old_skill/case-2.md): no proven data loss; audit/reload reconciled; overlay not followed; symptom separated from unproven cause |
| No recordings or counts; request for proven causes/lift | 3 | 3 passed | 3 passed | [new](outputs/blind_skill/case-3.md), [original](outputs/old_skill/case-3.md): causes remain hypotheses, no numeric lift, scoped collection plan, no installation/recording |

No demonstrated assertion-score advantage over the original: both passed 12/12 checks. The new package provides reusable resources, clearer counting guidance and a standalone workflow; it is not advertised as outperforming the baseline. Runtime/token metadata was not available from the agent tool and no time or cost comparison is claimed. Other agent products and actual replay-video interpretation are unverified.

## Review

Reviewed source and outputs for counting correctness, self-contained resource links, absence of repository dependencies, privacy exposure, untrusted-content handling, scope and unsupported marketing claims. The ambiguous 18-confirmation case is correctly conditional on unique cohort linkage in both versions. No blocking content issue found. Blank templates are intentionally reusable form assets, not unfinished skill scaffolding.

Browser acceptance confirms a saved Agensi draft surviving reload with USD 9 one-time pricing and the fictional demo. ZIP upload, payout connection, moderation submission and public listing remain open; no full publication claim is made.
