# UI design tooling assessment

Reviewed: 21 October 2026. Scope: development guidance for Sales AITO, not a product redesign.

## Source and method

The user supplied [this LinkedIn post](https://www.linkedin.com/posts/stasbel_12-github-repos-that-make-claude-code-and-share-7518668009083670528-b7pR/) through `https://lnkd.in/p/d8Ui-Uad`. All twelve short links were resolved to their upstream repositories. Repository descriptions and README material were checked against our current source and locally available skills. Star counts and promised time savings are not adoption evidence; no performance benchmark of these tools was performed.

## Decisions

The descriptions below summarize upstream scope. Suitability and adoption decisions are our assessment of this repository.

| Resource / primary source | Fit for Sales AITO | Decision |
|---|---|---|
| [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — UI/UX guidance | Targeted accessibility, responsive layout and interaction checks fit operational screens. A local `ui-ux-pro-max` skill is already available. | Reuse selectively; do not reinstall or regenerate our palette for ordinary changes. |
| [Awesome DESIGN.md](https://github.com/VoltAgent/awesome-design-md) — design-reference collection | Useful references for a future explicit redesign; copied brand files would compete with our established identity. | Reference only; no imported theme. |
| [Open Design](https://github.com/nexu-io/open-design) — collaborative design workspace | A separate environment for prototypes and design collaboration. No present task requires an additional workspace. | Defer installation until a specific collaboration need exists. |
| [Taste Skill](https://github.com/Leonxlnx/taste-skill) — art direction and browser review | Local `design-taste-frontend` is already available and explicitly targets landing pages rather than operational dashboards. | Use for appropriate marketing work within the approved direction. |
| [Impeccable](https://github.com/pbakaus/impeccable) — design guidance, audit and refinement commands | Its explicit audit/critique/polish stages are useful. Broad aesthetic detectors can conflict with deliberate product choices. | Adopt a project-specific audit → correction → browser-evidence process; do not install the CLI or claim its detectors run in CI. |
| [Skills for Designers and Engineers](https://github.com/emilkowalski/skills) — motion and interaction-detail guidance | Useful for a concrete animation problem; not a prerequisite for forms and order processing. | Consult for future motion work; no additional skill installation now. |
| [Hallmark](https://github.com/Nutlope/hallmark) — design generation, themes and review | Theme selection overlaps with existing local design guidance and our established visual contract. | Defer; no automatic restyling. |
| [Google DESIGN.md](https://github.com/google-labs-code/design.md) — structured tokens plus design rationale | Persistent design context is valuable, but duplicating CSS values in another independently maintained file risks drift. | Add a root routing document linked from AGENTS.md. It is not a schema-conformant token file; Google's CLI/linter is not installed. |
| [GSAP Skills](https://github.com/greensock/gsap-skills) — official GSAP usage guidance | Relevant when an interaction actually needs GSAP. The web package currently depends on Next.js and React without an animation library. | Defer until there is a concrete animation requirement. |
| [React Bits](https://github.com/DavidHDev/react-bits) — animated interactive components | Potential marketing inspiration. A component still needs source, accessibility and dependency review before reuse. | No bulk import; evaluate one component against a named need. |
| [Scroll World](https://github.com/oso95/scroll-world) — scroll-driven immersive landing pages | Does not address current workspace tasks. Upstream also lists media-generation services and tooling requirements. | Defer; not part of the current product direction. |
| [Canvas UI](https://github.com/DavidHDev/canvas-ui) — canvas/GPU effects over interactive content | Effects add compatibility and rendering considerations without a demonstrated benefit to order or conversation workflows. | Defer; any later prototype needs a usable fallback and measured mobile behavior. |

## Repository evidence and actual changes

The existing [design system](../frontend/design-system.md) already owned shared action variants and localized form validation. [AGENTS.md](../../AGENTS.md) already required real-browser acceptance. The [marketing spec](../superpowers/specs/2026-09-17-sales-aito-marketing-site-design.md) already defined Autonomous Command and restrained motion. Existing button, form and viewport contracts and Playwright flows provide reusable verification entry points.

The gap was discoverability and a consistent UI review process. This change adds [DESIGN.md](../../DESIGN.md) as an entry point, links it from repository instructions and README, and extends the canonical design system with surface ownership, optional skill selection, accessibility/responsive/state checks and evidence requirements. The feature index links to the current guidance.

No application behavior, CSS, dependencies, global skills or production services change. The local skill inventory is an observation of this development environment, not a guarantee that every contributor has those skills. No third-party source or templates were copied.

## Verification and limits

Verification on 21 October 2026: all local Markdown links in the changed documents resolve; `git diff --check` passes; the web suite passed all 104 files / 489 tests, including the existing shared UI contracts; all workspace package typechecks passed. The bundled pnpm initially attempted a dependency reinstall and stopped because it could not prompt. Verification then used the existing installed dependencies with the per-command `--config.verify-deps-before-run=false` option; dependency manifests and lockfiles were unchanged.

This is documentation-only work, so there is no changed browser flow to deploy or accept. Existing feature acceptance gaps remain open; neither improved instructions nor upstream popularity proves better UI or faster development.

On the next material UI task, use the canonical review process and record concrete findings, corrections and browser evidence in that feature's acceptance record. Reconsider a deferred tool only when it solves a named gap that existing components and guidance do not cover.
