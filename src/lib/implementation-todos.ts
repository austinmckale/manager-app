export type TodoItem = {
  id: string;
  title: string;
  details?: string;
};

export type TodoGroup = {
  id: string;
  title: string;
  items: TodoItem[];
};

export const implementationTodoGroups: TodoGroup[] = [
  {
    id: "p0-live-operations",
    title: "P0 - Live Operations Gaps",
    items: [
      {
        id: "p0-button-audit",
        title: "Run full button and form action audit across all pages.",
        details: "Validate every CTA either mutates data, navigates intentionally, or is removed. No dead/no-op actions.",
      },
      {
        id: "p0-action-feedback",
        title: "Add clear success/error feedback for critical actions.",
        details: "Show post-submit confirmations for schedule save, clock in/out, invoice send, lead create/import, and expense save.",
      },
      {
        id: "p0-job-archive-delete",
        title: "Add archive + delete controls for bad/error jobs.",
        details: "Archive should hide jobs from default boards while keeping history; delete should require explicit confirmation for true mistakes/fallthrough records.",
      },
      {
        id: "p0-share-feature-prune",
        title: "Prune unused share/gallery feature paths from the app.",
        details: "Remove orphaned endpoints/routes and nav references now that share links are not part of operations workflow.",
      },
      {
        id: "p0-expense-traceability",
        title: "Improve expense traceability from reports to source records.",
        details: "Each exported row should be easy to find in app with job link, expense id, and receipt link.",
      },
      {
        id: "p0-attendance-reminders",
        title: "Move attendance reminders from log-only to delivered reminders.",
        details: "Send via SMS/email/Discord with delivery status and retry handling.",
      },
      {
        id: "p0-data-quality-guardrails",
        title: "Add required-field and duplicate guardrails for manual intake and payroll edits.",
        details: "Protect against blank contact leads, impossible time ranges, and accidental duplicate entries.",
      },
    ],
  },
  {
    id: "lead-pipeline",
    title: "Lead Intake + Pipeline",
    items: [
      {
        id: "lead-webhook-prod",
        title: "Finalize production website form webhook to /api/leads/intake.",
        details: "Confirm key header, CORS origins, payload contract, and monitoring alerts.",
      },
      {
        id: "lead-google-voice",
        title: "Add Google Voice call/text lead ingest.",
        details: "Map call/text events into lead records with source, transcript/notes, and dedupe rules.",
      },
      {
        id: "lead-conversion-discipline",
        title: "Formalize lead stage SOP for owner workflow.",
        details: "Define required stage transitions, lost reason taxonomy, and conversion checklist.",
      },
      {
        id: "lead-response-sla",
        title: "Track lead response SLA and first-contact timestamps.",
        details: "Expose KPI tile and alert for leads not contacted within target window.",
      },
    ],
  },
  {
    id: "joist-workflow",
    title: "Joist Workflow",
    items: [
      {
        id: "joist-csv-hardening",
        title: "Harden Joist CSV import mapping and conflict behavior.",
        details: "Support real-world column drift, partial data, and duplicate estimate/invoice references.",
      },
      {
        id: "joist-doc-upload-parse",
        title: "Implement Joist document upload + AI extraction fallback.",
        details: "Allow PDF upload from Joist and auto-fill lead/job draft data with human review before save.",
      },
      {
        id: "joist-one-click-start",
        title: "Add one-click Start Project from Joist estimate/invoice.",
        details: "Create customer, job shell, and baseline financial context from approved Joist record.",
      },
      {
        id: "joist-source-of-truth",
        title: "Define Joist source-of-truth policy for estimates/invoices.",
        details: "Document when Manager App mirrors Joist vs when it can author its own invoice state.",
      },
    ],
  },
  {
    id: "labor-payroll",
    title: "Labor + Payroll Operations",
    items: [
      {
        id: "labor-worker-onboarding",
        title: "Finalize worker onboarding flow for real users.",
        details: "Create profile + optional Supabase invite/magic-link path with role assignment and wage setup.",
      },
      {
        id: "labor-clock-policy",
        title: "Enforce clock policy with late/missed exceptions handling.",
        details: "Capture owner override reason and audit trail for edited/retroactive punches.",
      },
      {
        id: "labor-payroll-export",
        title: "Add payroll-ready weekly summary export per worker/job.",
        details: "Export regular hours, loaded wage snapshot, gross pay, and job allocations.",
      },
      {
        id: "labor-gps-policy",
        title: "Finalize optional GPS capture policy and consent messaging.",
        details: "Only enable if compliance/legal requirements are clear for your state and employees.",
      },
    ],
  },
  {
    id: "job-finance",
    title: "Job Finance + Closeout",
    items: [
      {
        id: "finance-closeout-proof",
        title: "Strengthen closeout proof requirements.",
        details: "Require after photos, no open punch list, and at least one sent invoice before completed state.",
      },
      {
        id: "finance-qbo-sync",
        title: "Implement QuickBooks sync beyond link-out.",
        details: "Sync customers, invoices, payments, and reconciliation status back into Manager App.",
      },
      {
        id: "finance-receipt-ocr",
        title: "Add receipt OCR and vendor/category suggestions.",
        details: "Speed up Home Depot and materials receipts ingestion with editable AI suggestions.",
      },
      {
        id: "finance-cost-health-calibration",
        title: "Calibrate cost health thresholds to real business tolerance.",
        details: "Tune labor/material/total warning bands to your margin expectations per job type.",
      },
      {
        id: "finance-mobile-date-picker",
        title: "Replace expense date picker with a mobile-first calendar input.",
        details: "Use larger tap targets, quick-pick shortcuts (today/yesterday), and a reliable native-friendly fallback for Expense Ledger date selection.",
      },
      {
        id: "finance-mobile-entry-simplify",
        title: "Simplify estimate/change-order quick entry for mobile.",
        details: "Use clearer labels/placeholders and reduce fields shown by default so creating line items is fast on one screen.",
      },
    ],
  },
  {
    id: "portfolio-client-portal",
    title: "Portfolio + Client Portal",
    items: [
      {
        id: "portal-expiry-governance",
        title: "Add link lifecycle controls for portal/share links.",
        details: "Owner controls to revoke links, set custom expiry, and view last access.",
      },
      {
        id: "portfolio-website-routing",
        title: "Harden starred photo to website service-page routing.",
        details: "Validate controlled tags map correctly to site slugs and prevent untagged publishing.",
      },
      {
        id: "portfolio-curation-flow",
        title: "Improve before/after and curated gallery publishing flow.",
        details: "Support selecting exact gallery asset sets and caption generation history.",
      },
    ],
  },
  {
    id: "security-auth-ops",
    title: "Security + Auth + Ops",
    items: [
      {
        id: "security-auth-hard",
        title: "Enable strict auth mode for production.",
        details: "Set AUTH_REQUIRED=1 in production and verify session handling on all protected routes.",
      },
      {
        id: "security-rls-policies",
        title: "Implement and verify Supabase RLS policies.",
        details: "Ensure owner/admin/worker visibility rules are enforced at DB layer, not only app layer.",
      },
      {
        id: "security-secret-rotation",
        title: "Rotate exposed secrets and lock secret handling process.",
        details: "Rotate webhook URLs, API keys, and service role secrets; move all secrets to secure env storage.",
      },
      {
        id: "ops-backup-restore",
        title: "Run backup and restore drill.",
        details: "Test DB backup restore plus file asset survivability so disaster recovery is proven.",
      },
    ],
  },
  {
    id: "qa-launch",
    title: "QA + Launch Readiness",
    items: [
      {
        id: "qa-mobile-e2e",
        title: "Run owner-mobile E2E scenario test.",
        details: "Lead -> job -> crew schedule -> attendance -> time -> expense/receipt -> invoice -> payment -> closeout.",
      },
      {
        id: "qa-seed-realism",
        title: "Expand seed data for realistic multi-job, multi-worker testing.",
        details: "Cover no-show clock-ins, split shifts, change orders, overdue invoices, and portal messages.",
      },
      {
        id: "qa-observability",
        title: "Set up production observability and error alerts.",
        details: "Capture server action failures, webhook failures, and upload queue failures with alerting.",
      },
      {
        id: "qa-environment-split",
        title: "Finalize staging vs production environment separation.",
        details: "Separate Supabase projects, keys, buckets, and webhook endpoints per environment.",
      },
    ],
  },
];
