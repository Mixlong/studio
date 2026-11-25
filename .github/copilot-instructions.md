# Copilot & AI Agent Instructions

Please read and strictly follow `AGENTS.md` in the repository root before making any changes.

Key rules:
- Work in an isolated feature branch; never force-push or modify unrelated uncommitted/untracked files.
- Never commit or log secrets, Bearer/JWT tokens, binding secrets, or raw customer project contents.
- Run TypeScript compilation (`./node_modules/.bin/tsc --pretty false`) and relevant test suites (`npm run verify-mcp`, contract tests) before opening a PR.
- Reference cross-repo issues with `Refs Mixlong/DigiwiseStudio-Admin-Java#<id>` (never auto-close before human acceptance) and update GitHub Project #1 status to `In Review` (`验收 = 待验收`).
