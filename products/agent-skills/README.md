# Marketplace skill source

This directory owns distributable agent-skill products. It is separate from `.codex/skills/`, which owns repository-specific operating instructions. Do not include internal runbooks, production evidence, third-party installed skills or secrets in marketplace archives.

## Privacy-Aware Session Analysis 1.0.0

- Source: `privacy-aware-session-analysis/`.
- Origin: generalized from `.codex/skills/user-session-analysis/SKILL.md`; the internal skill remains the project-specific entry point.
- Distribution: ZIP with one top-level `privacy-aware-session-analysis/` folder. Include only its Markdown files. Keep evaluation workspaces and listing records outside the ZIP.
- Validation: frontmatter/resource/archive checks plus independent fictional behavioral scenarios. See `validation/` for prompts and results.
- Marketplace: Agensi; submission status and listing copy are maintained in `agensi-listing.md`.

Packaging (Python standard library, run from repository root; output outside Git):

```python
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
source = Path('products/agent-skills/privacy-aware-session-analysis')
output = Path.home() / 'Downloads' / 'privacy-aware-session-analysis-1.0.0.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob('*.md')):
        archive.write(path, Path(source.name) / path.relative_to(source))
```
