# Launch Checklist (Staging -> Field)

## Environment
- Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Create storage bucket `job-assets`.
- Set `NEXT_PUBLIC_APP_URL`.

## Database
- Run `npm run prisma:generate`.
- Run migrations with `npx prisma migrate deploy` in staging/prod.
- Run `npm run prisma:seed` only for non-production demo data.

## Auth/Roles
- Disable demo bypass in staging/production.
- Verify owner/admin/worker accounts exist.
- Verify workers only see assigned jobs.

## Storage + Offline
- Test photo capture online and offline.
- Verify queued uploads show pending/failed states and retry works.
- Verify receipt image attaches to expense.

## Operations Flow Smoke Test
- Today -> open scheduled job in 2 taps.
- Start/stop timer on job.
- Add expense (vendor + amount) and receipt.
- Add before/during/after photos with metadata.
- Mark job completed only after closeout requirements pass.

## Reporting
- Export CSV for time entries, expenses, profitability.
- Validate one row in each export against source records.

## Release
- Run `npm run lint` and `npm run build`.
- Tag release and publish deployment URL.
