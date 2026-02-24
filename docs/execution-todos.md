# Execution To-Dos

## P0 - Live Operations Gaps
- Run a full button/action audit so no control is dead or unclear.
- Add success/error feedback after critical actions (schedule, clock, invoice send, lead save/import, expense save).
- Improve expense traceability from CSV reports back to job/expense/receipt in app.
- Move attendance reminders from log-only to delivered reminders (SMS/email/Discord).
- Add stronger data guardrails for duplicate/invalid lead and time entry submission.

## Lead Intake + Pipeline
- Finalize production website form webhook contract for `/api/leads/intake`.
- Add Google Voice call/text lead ingest flow.
- Define strict lead stage SOP and required lost-reason handling.
- Track response SLA and first-contact KPI with alerts.

## Joist Workflow
- Harden Joist CSV mapping for real-world column variations and duplicates.
- Implement Joist document upload plus AI extraction review flow.
- Add one-click Start Project from Joist estimate/invoice.
- Document Joist as source-of-truth policy for estimate/invoice lifecycle.

## Labor + Payroll Operations
- Finalize worker onboarding with optional Supabase invite/magic-link user creation.
- Enforce late/missed clock policy with owner override reason logging.
- Add payroll-ready weekly export by worker and job.
- Finalize GPS capture consent/compliance policy before enabling broadly.

## Job Finance + Closeout
- Strengthen closeout proof requirements and keep enforcement strict.
- Implement real QuickBooks sync (not only link-out and CSV).
- Add receipt OCR/vendor/category suggestions for faster entry.
- Calibrate cost health thresholds to real company margin expectations.

## Portfolio + Client Portal
- Add link governance: revoke links, custom expiry, access tracking.
- Harden starred-photo website routing via controlled service tags.
- Improve curated gallery and before/after publishing workflow.

## Security + Auth + Ops
- Enable strict auth in production (`AUTH_REQUIRED=1`) and verify protected routes.
- Implement/verify Supabase RLS policies for role-based access.
- Rotate exposed keys/secrets and enforce secret handling process.
- Run backup/restore drill including storage assets.

## QA + Launch Readiness
- Run owner-mobile E2E from lead intake through closeout.
- Expand realistic seed scenarios for edge-case operations.
- Add error monitoring/alerting for server actions and webhooks.
- Keep staging and production fully separated (DB/storage/keys/webhooks).
