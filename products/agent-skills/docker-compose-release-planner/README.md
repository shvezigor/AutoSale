# Docker Compose Release Planner

Version 1.0.0. Prepare a go/no-go release plan and operator handoff for an existing Docker Compose application. Includes release-record and recovery-decision templates, a readiness method and fictional worked example.

Example request: "Assess this proposed Compose release using sanitized runbook and migration evidence. Identify backup, compatibility and browser-acceptance gaps. Produce a go/no-go operator plan without executing commands."

Requires an agent capable of reading Markdown and supplied sanitized deployment evidence. Optional authorized read-only repository/host tools belong to the host agent. No deployment scripts, infrastructure account, API key or external connector is bundled. This package does not execute production operations, guarantee recovery or replace environment-specific runbooks. English instructions; output follows the user's language. Tested on fictional planning cases with Codex only, not on live infrastructure.

Copyright 2026 Igor Shvez. All rights reserved. No open-source license is granted by this package. Marketplace purchases and access are subject to the applicable marketplace terms; this notice does not override those terms.
