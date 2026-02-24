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
    id: "workflow",
    title: "Core Workflow Completion",
    items: [
      { id: "workflow-webhook", title: "Wire website form intake to /api/leads/intake (production webhook)." },
      { id: "workflow-joist-map", title: "Finalize Joist CSV mapping + duplicate handling." },
      { id: "workflow-joist-convert", title: "Add one-click Joist estimate -> lead/job conversion flow." },
      { id: "workflow-payroll-lock", title: "Add weekly payroll lock/approve states before payout." },
      { id: "workflow-reminders-send", title: "Send real attendance reminders (SMS/email), not logs only." },
    ],
  },
  {
    id: "security",
    title: "Production Hardening",
    items: [
      { id: "security-auth", title: "Restore full auth UX and remove temporary bypass behavior." },
      { id: "security-rbac", title: "Audit and enforce role permissions on every page/action." },
      { id: "security-storage", title: "Replace public bucket approach with tighter Storage policies/signed URLs." },
      { id: "security-rotate", title: "Rotate all exposed keys/tokens and update env secrets." },
    ],
  },
  {
    id: "finance-integrations",
    title: "Finance + Integrations",
    items: [
      { id: "fin-qbo", title: "Implement QuickBooks sync (customers, invoices, payments)." },
      { id: "fin-home-depot", title: "Add Home Depot receipt ingest workflow + auto tagging." },
      { id: "fin-joist-source", title: "Define Joist source-of-truth sync strategy and conflict resolution." },
    ],
  },
  {
    id: "reporting",
    title: "Reporting + Operations",
    items: [
      { id: "ops-kpi-validate", title: "Validate KPI formulas against live data definitions." },
      { id: "ops-closeout", title: "Enforce closeout checks before moving jobs to Completed/Paid." },
      { id: "ops-backup", title: "Define backup/export schedule and run a restore test." },
    ],
  },
  {
    id: "qa-launch",
    title: "QA + Launch",
    items: [
      { id: "qa-e2e", title: "Run full mobile E2E: lead -> job -> schedule -> time -> expense -> invoice -> payment." },
      { id: "qa-seed", title: "Seed additional realistic test scenarios across all statuses." },
      { id: "qa-deploy", title: "Set up staging + production deploy with separate envs." },
    ],
  },
];

