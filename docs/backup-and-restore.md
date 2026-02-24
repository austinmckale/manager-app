# Backup and Restore Runbook

This runbook is for long-term retention (1+ years) of:
- PostgreSQL data
- Supabase Storage files (photos, receipts, docs)

## 1) Required Environment

In `.env.local` (or runtime env):

- `DIRECT_URL` (recommended for backup/restore tooling)
- `DATABASE_URL` (fallback if `DIRECT_URL` is not set)
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

Optional backup env vars:

- `BACKUP_OUTPUT_DIR=backups`
- `BACKUP_BUCKETS=job-assets,site-public`
- `BACKUP_DOWNLOAD_FILES=1`
- `BACKUP_DOWNLOAD_CONCURRENCY=3`

## 2) Create Backup

```bash
npm run backup:create
```

Creates a timestamped folder:

`backups/YYYYMMDD-HHMMSS/`

with:
- `database.dump` (pg_dump custom format)
- `storage-manifest.json` (all files indexed)
- `storage-files/...` (downloaded files by bucket/path when enabled)
- `backup-manifest.json` (summary + failures)

## 3) Verify Backup

```bash
npm run backup:verify -- backups/YYYYMMDD-HHMMSS
```

Verification checks:
- database dump exists and is non-empty
- storage manifest exists
- downloaded files exist (if download mode was enabled)
- no recorded failed downloads

## 4) Restore Drill (Test Quarterly)

1. Create an empty restore database.
2. Restore DB:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "<TARGET_DATABASE_URL>" backups/YYYYMMDD-HHMMSS/database.dump
```

3. Restore storage files:
   - Re-upload files from `backups/YYYYMMDD-HHMMSS/storage-files/<bucket>/<path>`
   - Preserve exact bucket names and object paths.
4. Start app against restored env.
5. Validate:
   - jobs/leads/invoices counts
   - random historical job records
   - receipt/photo links open

## 5) Scheduling (Windows Task Scheduler)

Example nightly task action:

Program/script:
- `powershell.exe`

Arguments:
- `-NoProfile -ExecutionPolicy Bypass -Command "cd 'C:\Users\Alivia\Projects\Manager App\manager-app'; npm run backup:create"`

Recommended:
- Run daily off-hours
- Keep 30-90 daily backups + monthly archives
- Copy backups to off-machine cloud storage (not same disk as app host)

## 6) Operational Policy

- Never treat exports as your only backup.
- Keep DB + storage backups together for each timestamp.
- Run restore drill on a schedule; backup without restore test is incomplete.
