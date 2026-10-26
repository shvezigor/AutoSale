# Marketplace skill source

This directory owns distributable agent-skill products. It is separate from `.codex/skills/`, which owns repository-specific operating instructions. Do not include internal runbooks, production evidence, third-party installed skills or secrets in marketplace archives.

## Privacy-Aware Session Analysis 1.0.0

- Source: `privacy-aware-session-analysis/`.
- Origin: generalized from `.codex/skills/user-session-analysis/SKILL.md`; the internal skill remains the project-specific entry point.
- Distribution: ZIP with one top-level `privacy-aware-session-analysis/` folder. Include only its Markdown files. Keep evaluation workspaces and listing records outside the ZIP.
- Validation: frontmatter/resource/archive checks plus independent fictional behavioral scenarios. See `validation/` for prompts and results.
- Marketplace: Agensi; submission status and listing copy are maintained in `agensi-listing.md`.

## Additional prepared packages 1.0.0

| Package | Origin | Deliverable | Distribution state |
|---|---|---|---|
| [Repository Feature Map](repository-feature-map/SKILL.md) | `.codex/skills/feature-knowledge/` | Existing owner/contract/test map and reuse decision | Local package; not uploaded |
| [Evidence-Led Product Planning](evidence-led-product-planning/SKILL.md) | `.codex/skills/product-management/` | Decision brief, narrow PRD or validation plan | Local package; not uploaded |
| [Docker Compose Release Planner](docker-compose-release-planner/SKILL.md) | `.codex/skills/production-deployment/` | Readiness and recovery handoff; no live execution | Local package; not uploaded |

The internal skills remain the project-specific entry points. [Prepared listing copy](prepared-listings.md) owns prices/submission state for the additional packages; [fictional validation](validation/prepared-skills/results.md) owns observed checks and limits. These products do not add application behavior or enable recording, experiments or deployment.

## Marketplace images

All four skills have matching square PNG card icons in [marketplace-assets/icons](marketplace-assets/icons/README.md), with prompts, file hashes and verification notes. These listing assets stay outside the Markdown distribution ZIPs. Image preparation does not change the recorded submission/publication status.

Packaging (Python standard library, run from repository root; output outside Git). Set `source` to the desired skill folder and match its output filename; include only that folder's Markdown files:

```python
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
source = Path('products/agent-skills/privacy-aware-session-analysis')
output = Path.home() / 'Downloads' / 'privacy-aware-session-analysis-1.0.0.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob('*.md')):
        archive.write(path, Path(source.name) / path.relative_to(source))
```
