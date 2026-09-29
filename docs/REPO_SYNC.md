# Production ⇄ Sandbox repo sync

Two Lovable projects, two GitHub repos, one shared git history.

| | Production | Sandbox (beta) |
|---|---|---|
| GitHub | `classicitbb/warehouse-wizard` | `classicitbb/warehousewizard-sandbox` |
| Local clone | `C:\classicitbb\warehouse-wizard` | `C:\classicitbb\warehousewizard-sandbox` |
| Supabase ref | `gxfvxmxplngvxdkpmxgw` | `emuyzymoadmzhnzjprjz` |
| Remotes | `origin` = prod, `sandbox` = sandbox | `origin` = sandbox, `prod` = prod |
| NetSuite | production account | NetSuite sandbox account |

Lovable syncs only `main` of its own repo. Merging a PR into `main` is what
Lovable picks up. **Edge functions are not redeployed by a push**: send a
deploy-only message in that Lovable project after merging.

## Rules

1. **New features are built in the sandbox.** Production takes only hotfixes
   while sandbox work is in flight, so changes flow prod → sandbox often and
   sandbox → prod rarely.
2. **Never copy environment files between repos.** The script keeps these
   per-side: `.env`, `src/integrations/supabase/client.ts`, and every
   occurrence of the Supabase project ref (`supabase/config.toml`,
   `.lovable/mcp/manifest.json`, `supabase/functions/mcp/index.ts`).
3. **Secrets live in each project's Supabase secrets**, never in code:
   NetSuite credentials/account, webhook and queue-runner secrets, API keys.
   Code must read them from env so the same code runs on both sides.
4. **Migrations are forward-only and additive.** New tables/columns and
   `create or replace`, no destructive renames or drops of data in use. Every
   migration written in the sandbox will later run on production data.
5. **Never delete files in `supabase/migrations/`.** The script refuses a sync
   that would.
6. **Edge function `verify_jwt` settings live in `supabase/config.toml`** and
   must match on both sides except for `project_id`.
7. Gate unfinished sandbox features behind a feature flag so they can be
   promoted early and switched on later.

## Tasks (say these to Claude, or run the command)

All commands run from Git Bash in the named clone.

### "Check sync status"
```bash
scripts/repo-sync.sh status
```
Lists commits each side has that the other lacks. Works in either clone.

### "Sync prod into sandbox" (do weekly and after every prod hotfix)
In the **sandbox** clone:
```bash
scripts/repo-sync.sh pull-prod
```
Creates branch `sync/from-prod/<stamp>`, merges `prod/main`, restores the
sandbox's environment files, pushes, and opens a PR on the sandbox repo.
Then:
1. Merge the PR.
2. Apply any new migrations it listed to the sandbox database (a Lovable
   message in the sandbox project: "apply migration `<file>`").
3. If edge functions changed, send the sandbox project a deploy-only message.

### "Promote sandbox to prod"
In the **prod** clone:
```bash
scripts/repo-sync.sh promote
```
or promote just one feature branch: `scripts/repo-sync.sh promote sandbox/feature-x`.
Creates branch `promote/from-sandbox/<stamp>`, merges, restores production's
environment files, lists the new migrations, pushes, and opens a PR on the
prod repo. Before you merge:
1. Run `scripts/repo-sync.sh pull-prod` first, so the sandbox already contains
   everything in prod and the promote has no conflicts.
2. Review every new migration against production data.
3. Set any new Supabase secrets in the **production** project.
4. Merge the PR, apply the migrations to prod, and send the prod Lovable
   project a deploy-only message for edge functions.
5. Turn the feature flag on.

### "Hotfix prod"
Fix on a branch in the prod clone → PR → merge. Then run `pull-prod` in the
sandbox clone so the fix reaches the sandbox too.

### Merge conflicts
If the script stops with conflicts, it leaves you on the sync branch. Resolve
each listed file, `git add` it, then:
```bash
scripts/repo-sync.sh finish "Sync production into sandbox"
```

## Maintaining this document

Update this file in the same PR whenever the sync process, the env-specific
file list (`KEEP_OURS` in `scripts/repo-sync.sh`), project refs, or remotes
change. This file and the script exist in both repos and travel with syncs,
so edit them in one repo and let the next sync carry them across.
