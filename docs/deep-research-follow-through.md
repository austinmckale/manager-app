# Deep Research Follow-Through Plan

This checklist translates `deep-research-report.md` into concrete implementation work and daily usage behavior.

## 1) Daily Operating Model (Implemented)

- `Today` page is default entry point (`/today`)
- One floating `+` action menu for daily capture:
  - start/stop time
  - add expense/receipt
  - capture photos
  - invoice/estimate shortcuts
- Job Hub is a single ordered workflow page (`/jobs/[jobId]`) instead of heavy tab switching.

## 2) Jobs + Schedule (Implemented)

- Added schedule and assignment data model:
  - `JobAssignment`
  - `JobScheduleEvent`
- Added schedule + crew section to Job Hub:
  - assign worker to job
  - create schedule event block
- Jobs list now supports operation view filters:
  - `today`
  - `week`
  - `all`

## 3) Time + Labor Cost (Implemented)

- Start/stop timer and manual entries
- Hourly rate snapshot on each entry
- Timesheet filtering by worker/job/date range
- Dashboard includes labor trend and margin visibility

## 4) Expenses + Receipt Capture (Implemented)

- Expense quick entry with required vendor + amount
- Receipt image capture/upload tied to expense
- Missing receipts surfaced on Today attention panel

## 5) Photos + Sharing (Implemented)

- Photo capture with stage/area/tags/client-visible controls
- Portfolio mode and ZIP export helper
- Share links and client portal links

## 6) Billing + Costing (Implemented)

- Estimate/change order/invoice/payment workflow
- PDF endpoints for estimate/invoice/change order
- Job costing summary with cost-health indicators
- Closeout checklist gating before completion status

## 7) KPI Scoreboard (Implemented)

Manager scoreboard focuses on:
- gross margin %
- estimate win rate
- unbilled jobs
- unpaid invoices total
- labor hours (last 7 days)

## 8) Reporting Exports (Implemented)

CSV exports:
- time entries
- expenses
- job profitability

## 9) Immediate Follow-Through (Next)

1. Wire real Supabase auth back in and remove demo mode.
2. Add migration files for new models (`JobAssignment`, `JobScheduleEvent`).
3. Add RLS policies matching owner/admin/worker and tokenized share access.
4. Add intake flow for Joist estimate documents (upload -> AI extract -> review -> create job).
5. Add launch ops report (`daily exceptions` list: overdue tasks, missing receipts, unsent invoices).

## 10) Weekly Adoption Routine

Use this to enforce behavior change with your team:

Daily (AM):
- open `/today`
- check assigned jobs and schedule blocks
- start timers before field work

Daily (PM):
- upload receipts/photos before clock-out
- update task statuses/punch list
- confirm invoice/estimate actions for active jobs

Weekly:
- review `/dashboard` KPI trends against targets
- export reports for accounting handoff
- close out completed jobs with checklist
