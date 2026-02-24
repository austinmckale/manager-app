# Exhaustive Rebuild + Design Upgrade Plan (Construction Ops)

## Objective
Convert the current prototype into a field-usable construction operations system where the default workflow is:

`Lead Intake -> Dispatch/Today -> Jobsite Capture (Time/Receipts/Photos) -> Cost Visibility -> Invoice Follow-up`

## Product Principle
- Optimize for crew behavior, not admin flexibility.
- Every critical action must be reachable in <= 2 taps from the active job context.
- System should surface exceptions, not force manual hunting.

## Phase 0: Scope Freeze (Done)
- Keep core scope: leads, jobs, time, expenses/receipts, photos/files, invoicing status, KPI dashboard, exports.
- Avoid low-value feature sprawl until operational reliability is stable.

## Phase 1: Workflow Foundation (Implemented)
- Added lead intake workflow (`/leads`) for website forms, phone calls, text messages.
- Added lead stage pipeline: `NEW -> CONTACTED -> SITE_VISIT_SET -> ESTIMATE_SENT -> WON/LOST`.
- Added conversion flow from lead to customer + job.
- Replaced misleading estimate win KPI with lead-to-win KPI.
- Added Team operations workflow (`/team`) with checklist assignment by ongoing jobs.
- Added stronger closeout invariants (after photos, no open punch list, non-draft invoice exists).
- Improved offline upload observability (pending/failed states + retry).

## Phase 2: Ops-Centric UX Redesign (Next)
- Build true dispatch board as primary page for owner/admin:
  - crew/day view
  - job blocks
  - unassigned jobs
  - quick reassignment
- Convert job detail into role-aware job run sheet:
  - Foreman mode (time, receipts, photos, checklist)
  - Office mode (schedule, costing, invoice state, approvals)
- Replace generic forms with camera-first and timer-first modules.

## Phase 3: Data Integrity + Security Hardening
- Reinstate production auth flow fully (remove bypass from staging/prod).
- Enforce role and org boundaries through Supabase RLS policies.
- Add migration discipline (`prisma migrate deploy`) for staging/prod only.
- Add smoke tests for worker assignment constraints and cross-org access protection.

## Phase 4: Financial Control Loop
- Add ready-to-invoice queue:
  - completed work with missing invoice
  - overdue invoices with reminder status
- Add approval flow for time entries and pay period lock.
- Add job variance panels:
  - labor variance
  - materials variance
  - total budget variance

## Phase 5: Field Reliability
- Expand offline upload telemetry:
  - retry_count
  - last_error_code
  - last_attempt_at
- Add sync health page for admins.
- Add device-level sync warnings when queue remains failed > threshold.

## KPI Framework (Operationally Honest)
- Keep: gross margin %, labor % revenue, materials % revenue, outstanding AR, avg days to pay.
- Replace estimate win with lead-to-win based on actual lead disposition.
- Add response-time KPI: `% leads contacted in 24h`.

## Release Acceptance Criteria
1. Worker sees only assigned jobs and can clock time/submit expenses/photos.
2. Lead can be created from call/text/web in under 30 seconds.
3. Lead conversion creates customer + job reliably.
4. Closeout cannot complete when required artifacts are missing.
5. Dashboard KPIs map directly to real database records (no mock-only calculations).
6. CSV exports match on-screen totals for time, expenses, profitability.

## Implementation Notes
- Completed in this upgrade pass:
  - `/leads` intake + pipeline + conversion
  - KPI refactor to lead-to-win
  - `/team` assignment workflow
  - closeout enforcement hardening
  - offline queue status/retry UI
- Remaining high-impact work:
  - dispatch board
  - auth/RLS hardening
  - invoice-ready queue and collections automation
