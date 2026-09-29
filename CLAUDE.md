ENSURE FILES ARE NOT TRUNCATED BEFORE COMMITING. 
KEEP FEATURES AND THEIR CODE EFFICIENT AND SEGMENTED BY PAGE

ENSURE ALL CONTEXT IS IN PLACE BEFORE EXECUTING COMPLEX TASKS. 
## Prod / Sandbox repos
This code lives in two Lovable repos that share history: production (`classicitbb/warehouse-wizard`, `C:\classicitbb\warehouse-wizard`) and sandbox (`classicitbb/warehousewizard-sandbox`, `C:\classicitbb\warehousewizard-sandbox`). New features go in the sandbox and prod gets hotfixes only. Follow docs/REPO_SYNC.md for "sync status", "sync prod into sandbox", "promote sandbox to prod" and "hotfix prod" (`scripts/repo-sync.sh status | pull-prod | promote`). Never copy `.env`, the Supabase client, or project refs between repos. Never delete migrations. Keep docs/REPO_SYNC.md and the script current whenever the process changes.
