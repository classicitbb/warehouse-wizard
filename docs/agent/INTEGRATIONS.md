# Integrations and Connector Contract

| Service | Purpose | Verification | Write boundary |
|---|---|---|---|
| GitHub | Source control and review | Verified repository access | Feature branches/PRs within task scope |
| Vercel | Hosting | Project `warehouse-wizard` linkage verified | Preview first; production approval boundary |
| Supabase | Database/auth/storage/functions as used by code | Repository configuration detected | Verify project/account before writes |
| Lovable | Project editing/generation workflow | MCP connector reachable 2026-09-02, but exposes only design-import and new-project tools — no migration, project-message, or diff capability in this session | Review generated diffs; verify publish path |
| Supabase CLI | Applying migrations locally | `npx supabase --version` → 2.116.0 on 2026-09-02; project not linked | Linking and `db push` against the production project remain an approval gate |

Add every real external service when verified. Access to one service does not imply access to another.

## Rules

- Prefer installed/authenticated MCP, then approved CLI/SDK, then controlled browser interaction.
- Verify the target project/account with a harmless read before writes.
- Store credential values only in approved secret systems.
- Use least privilege, idempotency, bounded retries, audit context, and reconciliation for automated writes.
- Production deployments/data, auth/security, credentials, billing, external messages, and destructive actions remain approval gates unless explicitly authorized.
