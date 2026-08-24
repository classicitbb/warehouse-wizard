# Agent Continuity Entry Point

Before work, read the existing `AGENTS.md` if present, then `docs/agent/PROJECT_KNOWLEDGE.md`, `docs/agent/INTEGRATIONS.md`, and `docs/agent/HANDOFF.md`. Read any project-native status file they name.

Continuity is part of the build:
- Before the final build/check, compare changed code/configuration with the durable context. Add material commands, environment-variable **names**, services, connectors, data sources, constraints, and decisions discovered during the work.
- After verification, update the handoff whenever work is incomplete, blocked, awaiting approval, or intentionally deferred.
- Record one exact executable next action, affected files, tests run, exact failures, environment state, and approval still required.
- If complete, clear stale steps and set `Status: Complete — no active handoff`.
- Never record secret values, tokens, credentials, private keys, private connection strings, customer data, or private infrastructure identifiers.

Operate autonomously for routine reversible work within the authorized repository. Prefer verified MCP connectors, then approved CLI/SDK access, then controlled browser work. Verify connectors with a harmless read. Pause for production deployment, destructive operations, production data writes, credential/permission changes, auth/security changes, billing, public publishing, or access outside the task.
