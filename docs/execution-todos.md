# Execution To-Dos

## Core Workflow Completion
- Wire website form intake to `/api/leads/intake` in production.
- Finalize Joist CSV mapping and duplicate handling.
- Add one-click Joist estimate to lead/job conversion.
- Add weekly payroll lock/approve states before payout.
- Send real attendance reminders (SMS/email), not log-only.

## Production Hardening
- Restore full auth UX and remove bypass behavior.
- Audit and enforce role permissions on all pages/actions.
- Replace public bucket approach with tighter storage policies/signed URLs.
- Rotate all exposed keys/tokens and update env secrets.

## Finance + Integrations
- Implement QuickBooks sync (customers, invoices, payments).
- Add Home Depot receipt ingest workflow and auto-tagging.
- Finalize Joist source-of-truth sync and conflict handling.

## Reporting + Operations
- Validate KPI formulas using live data.
- Enforce closeout checks before Completed/Paid.
- Define backup/export schedule and run restore test.

## QA + Launch
- Run mobile E2E workflow: lead -> job -> schedule -> time -> expense -> invoice -> payment.
- Add realistic seed scenarios across statuses.
- Set up staging + production deployment with separate envs.

