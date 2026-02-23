# Cream-of-the-crop daily features for a contracting job management app

## Executive summary

If you want the simplest day-to-day system (and not a “Swiss‑army knife” you won’t use), the winning pattern across Jobber, Housecall Pro, Buildertrend, and CompanyCam is: **one job hub + three daily capture actions + one daily scoreboard**.

- **Daily capture actions (field):** start/stop time (optionally GPS-stamped), snap receipts tied to jobs, snap jobsite photos organized by stage (before/during/after) and area. citeturn2search1turn8search0turn8search18turn17search12turn17search34  
- **Daily job hub (office + field):** schedule, assignments, job notes, photos, costs, invoice status in one place. citeturn17search14turn8search1turn8search3turn17search28  
- **Daily scoreboard (owner):** “Are we making money and are jobs moving?” (margin, labor hours, expenses posted, invoices sent/paid, jobs on schedule). Competitors emphasize job costing/profitability and reporting/insights as the core management lens. citeturn2search2turn8search3turn17search28turn11view3

Everything else becomes optional and should only be built if it reduces daily friction.

For your custom build, the **cream-of-the-crop** version is:

1. **Jobs + Schedule (Today/This Week)**
2. **Time tracking + labor cost**
3. **Expenses + receipt photo capture**
4. **Job photos + tagging + shareable gallery link**
5. **Invoice + payment status (QuickBooks-first)**
6. **Job costing + margin + 5 KPI targets**
7. **Offline capture queue for receipts/photos**
8. **RLS roles so the system stays safe as you add people** citeturn0search3turn10search0turn10search9turn16search5

## Daily-use feature set benchmarked from top tools

This section translates competitor capability into “what you’ll actually use every day.”

### What the top tools treat as “daily drivers”

| Daily driver | Why it’s “cream-of-crop” | Competitor evidence | Your app implementation decision |
|---|---|---|---|
| Time tracking (mobile clock-in/out) | Payroll, job costing, productivity—used daily in the field | Housecall Pro marketing and resources emphasize GPS-enabled time tracking and employee time tracking. citeturn2search1turn2search8 | Build a one‑tap timer + job selector + optional GPS stamp |
| Receipt capture tied to job expenses | Prevents margin blindness and end-of-month scramble | Jobber explicitly supports logging expenses and attaching receipt photos. citeturn8search0turn8search16 | Build “Add expense” with receipt photo, category, vendor, amount |
| Jobsite photo documentation | Reduces disputes, creates portfolio content “for free” | CompanyCam emphasizes jobsite photo organization with tags/timelines and sharing; Housecall Pro sells jobsite photo tracking. citeturn17search12turn17search23turn8search18 | Build “Add photos” with stage (before/after), area, tags, client-visible toggle |
| Job costing / profitability view | Why you do all the capturing in the first place | Housecall Pro and Jobber both market job costing/profitability; Buildertrend job costing budget is a central hub. citeturn8search3turn2search2turn17search28 | Build job P&L: labor + expenses vs revenue, margin % |
| Client visibility (share link / portal-lite) | Reduces texting photos, improves trust, sells future work | Buildertrend client portal highlights sharing schedule/photos/financials; CompanyCam emphasizes live timeline links. citeturn17search0turn17search23turn17search32 | Build shareable gallery link per job (tokenized) + basic portal page |
| Invoice/payment status | Cash collection is daily reality, even if payment processing isn’t | Jobber client hub supports payments; QuickBooks integrations are common in SaaS. citeturn18search9turn18search3turn5search1 | Launch with invoice PDF + “paid/unpaid” + “paid method”; integrate sync later |

### What *looks* impressive but is usually not daily value

These are the “bells and whistles” you can safely skip until you feel pain:

- **AI assistants** (Jobber markets AI chat/voice; CompanyCam markets AI features on higher plans). Useful later, but rarely your daily bottleneck when restarting. citeturn11view3turn17search2turn17search16  
- **Marketing automation and advanced proposal tooling** (nice-to-have once you scale). citeturn11view3turn17search3  
- **Deep CRM scoring** (you need “lead → estimate,” not a sales platform, initially).

## Lean architecture and data model for daily operations

### Backend choice: Supabase stays the best fit for “simple daily ops + strong security”

Supabase is positioned as a Postgres development platform including Authentication and Storage, with authorization handled via SQL Row Level Security policies. That combination is exactly what you need to keep the app simple while still safe as you add employees and client sharing. citeturn16search5turn10search4turn0search3turn0search19

If you later want to run everything “on your own server,” Supabase can be self-hosted (Docker), but it adds operational overhead; their docs explicitly frame self-hosting as a fit for control/compliance needs rather than speed. citeturn16search0turn16search4

### “Cream-of-crop” schema (minimum tables that cover daily reality)

This is the smallest schema that still supports job costing, receipt/photo capture, sharing, and KPI targets.

| Table | Why it exists (daily use) |
|---|---|
| `orgs`, `org_members`, `profiles` | Multi-user team with roles and labor rates |
| `clients` | Who you’re working for (invoices, jobs) |
| `jobs` | The hub: everything attaches here |
| `job_assignments` | “Who’s on this job today” |
| `job_schedule_events` | “Today/This week” calendar blocks |
| `time_entries` | Timer + payroll + labor cost |
| `expenses` | Materials/sub expenses; ties to job |
| `file_assets` | Photos/receipts metadata tied to job; drives portfolio + share |
| `galleries`, `gallery_items`, `share_links` | Curated + shareable gallery links |
| `invoices`, `payments` | Billing + paid status |
| `kpi_defs`, `kpi_targets`, `kpi_snapshots` | Daily/weekly scoreboard |

### RLS design kept simple (so you don’t fight it daily)

You want security that doesn’t leak data, without complicated permission management UI.

- **Owner/Admin:** full org access  
- **Worker:** access only assigned jobs + their own time entries + expenses/photos they created (optionally all job assets for assigned jobs)  
- **Public share link:** a token grants read-only access to *only* client-visible assets for that job/gallery

Supabase docs emphasize how `auth.uid()` works (and that it returns null when unauthenticated), which is the base for these policies. citeturn10search0turn10search7

## Lean UI flows and offline capture that you’ll actually use

### The only screens you need for daily use

| Screen | What you do there | Why it survives “daily use” test |
|---|---|---|
| Today | See assigned jobs + start timer | Removes “where am I supposed to be?” friction |
| Job Detail (the hub) | Photos, receipts, time, schedule, invoice status, margin | One place to manage the job |
| Timer | Start/pause/stop; pick job; optional GPS | Fast payroll + costing capture |
| Add Expense | Amount/category/vendor + receipt photo | Prevents lost receipts |
| Photos | Before/After + area tags + client-visible toggle | Documents work + creates portfolio content |
| Invoice | Generate PDF, mark sent, mark paid | Cashflow reality |
| KPI Dashboard | 5 numbers + red/yellow/green vs targets | Daily “is business healthy?” |
| Share Link Page | Client sees photos timeline/gallery | Reduces texting and creates social-ready link |

### Offline behavior (only for what matters)

You don’t need “offline mode everywhere.” You need offline for:

- **receipt capture**
- **photo capture**
- (optionally) **timer start/stop**

Implementation: store pending captures in IndexedDB and retry upload when online. Supabase docs explain standard uploads and recommend resumable uploads for larger files for reliability. citeturn10search9turn10search2

## The Cursor build prompt for the cream-of-the-crop system

Cursor is best used when the prompt is strict, acceptance-test driven, and scoped. Cursor supports Agents/Cloud Agents and semantic search/indexing to iterate quickly on a real repo. citeturn6search5turn6search1turn6search4turn6search0turn15view1

Below is the **exhaustive but lean** prompt: it includes setup, migrations, tests, offline pipeline, and QuickBooks sync options—but only what supports daily operations.

```text
You are Cursor acting as a senior full-stack engineer building a production-ready v1 “cream-of-the-crop” contracting job management app.

PRIMARY GOAL
Build the simplest daily-usable system for running a contracting business:
- “Today” schedule
- Job hub
- Time tracking (optional GPS stamp)
- Expense + receipt photo capture
- Job photos (before/after) with tags + client-visible toggle
- Shareable gallery link
- Invoice PDF + paid status tracking
- Job costing + margin
- KPI dashboard with targets
- Offline capture queue for receipts/photos

STRICT SCOPE RULES (KEEP IT SIMPLE)
- Do NOT build marketing tools, deep CRM automation, AI assistants, complex permission UIs, or fancy analytics.
- If a feature is not used weekly, it must be a hidden admin-only page or skipped.
- Every screen must be mobile-first and usable with one hand.

TECH STACK REQUIREMENTS
- Next.js (App Router) + TypeScript + Tailwind.
- React Query for data fetching.
- Zod for validation.
- Supabase: Postgres + Auth + Storage + RLS policies.
- Prisma for schema/migrations + seed.
- PDFs: implement a stable invoice/estimate PDF generator (choose one approach and keep it simple).
- CSV export endpoints.

PROJECT STRUCTURE
/apps/web  (Next.js App Router)
/packages/shared (zod schemas, types, constants)
/packages/db (prisma schema, migrations, seed)
/scripts (export scripts, rls test scripts)

AUTH + SECURITY (NON-NEGOTIABLE)
- Use Supabase Auth for login.
- All tables have org_id and RLS enabled.
- Roles: owner, admin, worker.
- Workers can only access jobs assigned to them.
- Public share links are tokenized and only expose client-visible assets.
- Never expose service-role keys to the client.

DATA MODEL (MINIMUM TABLES)
Implement the following tables with uuid PKs and created_at/updated_at:
- orgs(id, name)
- profiles(id, user_id, display_name, labor_rate, labor_rate_loaded, default_role)
- org_members(id, org_id, user_id, role, is_active)
- clients(id, org_id, name, email, phone, billing_address_json, notes)
- jobs(id, org_id, client_id, title, status, address_json, tags_text_array, start_date, end_date)
- job_assignments(id, org_id, job_id, user_id)
- job_schedule_events(id, org_id, job_id, start_at, end_at, notes)
- time_entries(id, org_id, job_id, user_id, start_at, end_at, hourly_rate_snapshot, gps_start_json, gps_end_json, notes)
- expenses(id, org_id, job_id, created_by_user_id, amount, category, vendor, purchased_at, notes, receipt_asset_id)
- file_assets(id, org_id, job_id, uploader_user_id, kind(photo|receipt|doc),
    storage_bucket, storage_path, bytes, content_type,
    stage(before|during|after), area, tags_text_array,
    is_client_visible, is_portfolio, captured_at, gps_json)
- galleries(id, org_id, job_id, title, description)
- gallery_items(id, org_id, gallery_id, file_asset_id, sort_order)
- share_links(id, org_id, job_id, gallery_id nullable, token, expires_at nullable, allow_download bool)
- invoices(id, org_id, job_id, client_id, status(draft|sent|paid), subtotal, tax, total, due_date, sent_at)
- payments(id, org_id, invoice_id, amount, method(cash|check|ach|card|other), paid_at, external_ref nullable)
- kpi_defs(id, kpi_key unique, name, unit, direction)
- kpi_targets(id, org_id, kpi_key, period(weekly|monthly), target_value, effective_start)
- kpi_snapshots(id, org_id, kpi_key, period_start, period_end, actual_value, computed_at)

JOB COSTING + KPIS (DAILY SCOREBOARD)
Compute on the job page:
- Labor cost = sum(time_entries hours * hourly_rate_snapshot)
- Expense cost = sum(expenses amount)
- Revenue = sum(invoice totals where status in (sent, paid))
- Profit = revenue - (labor + expenses)
- Margin % = profit / revenue (handle divide by zero)
KPIs (start with 5):
1) Revenue last 7 days
2) Gross margin % last 30 days
3) Unbilled jobs count (jobs not invoiced)
4) Unpaid invoices total
5) Labor hours last 7 days vs target

RLS POLICIES (IMPLEMENT FULL COVERAGE)
Create SQL migration(s) that:
- Enables RLS on every table.
- Defines helper functions: is_org_member(org_id), org_role(org_id), is_job_assignee(job_id).
Policies:
- Org members can read org-scoped tables.
- Only owner/admin can insert/update/delete org-scoped “admin” objects (org_members, kpi_targets, etc.).
- Workers can:
  - read assigned jobs
  - insert time_entries for themselves on assigned jobs
  - insert expenses/photos for assigned jobs
  - read assets on assigned jobs (or at least their own uploads)
- share_links are readable by anyone only through a server endpoint that validates token and returns sanitized content.

STORAGE
- Buckets: job-assets and receipts (or a single bucket job-assets).
- Storage path convention: org/{orgId}/job/{jobId}/{kind}/{assetId}
- Upload flow:
  1) create draft file_asset row (or reserve id)
  2) upload file to storage with path including assetId
  3) finalize file_asset metadata

OFFLINE CAPTURE (MUST WORK)
- Implement IndexedDB queue:
  - Stores pending photo/receipt blobs + metadata (jobId, kind, stage, category, amount).
- When online:
  - Upload -> create DB rows -> mark as synced
- UI:
  - badge showing pending count
  - “retry all” button
  - “delete pending” per item

UI PAGES (MOBILE FIRST)
- /login
- /today (assigned jobs + start timer)
- /jobs (filter: today/this week/all)
- /jobs/[id] (job hub; tabs: Overview, Photos, Time, Expenses, Invoice)
- /jobs/[id]/share (create share link, toggle allow_download)
- /clients + /clients/[id]
- /invoices/[id] (PDF preview + mark sent/paid)
- /dashboard (KPIs + targets)
- /settings (org members, labor rates, KPI targets)

PDF + CSV EXPORT
- PDFs:
  - invoice PDF (simple, branded, readable)
  - estimate PDF (optional v1 if time)
- CSV endpoints:
  - time entries
  - expenses
  - job profitability summary

QUICKBOOKS WORKFLOW (DON’T OVERBUILD)
Phase 1 (launch):
- Add fields to mark invoice paid/unpaid + payment method.
- Add CSV export compatible with QuickBooks import or manual entry.
Phase 2 (after launch):
- Implement QuickBooks Online OAuth + minimal sync:
  - push invoices
  - push payments (optional)
  - store external_ref ids
- Build a “Sync now” button + sync logs table.

STRIPE WORKFLOW (OPTIONAL)
- If payments are needed quickly without heavy integration:
  - implement "Payment Link URL" field on invoice
  - allow attaching Stripe Payment Link URL
- Full Stripe integration is out of scope for v1 unless explicitly requested.

MIGRATIONS + SEED
- Prisma schema + migrations committed
- Seed script creates:
  - demo org + demo users
  - 3 clients
  - 5 jobs
  - KPI defs + targets
  - example invoices/expenses/time entries

TESTS (MINIMUM QUALITY BAR)
- Unit tests for costing functions.
- Integration test script that:
  - creates org/user/job
  - verifies worker cannot read unassigned job
  - verifies worker can create time entry on assigned job
- Basic e2e smoke test for:
  - login
  - start timer
  - add expense with receipt upload

DELIVERABLES
- Working app with above pages
- README with setup, env vars, Supabase steps, deploy steps (Vercel/Netlify)
- “Launch checklist” doc for your team to start using it next week
```

### Payment handling guidance (simple, daily-use aligned)

If you want the least friction:

- **Week-one:** invoices + “paid/unpaid” + payment method; let QuickBooks stay the accounting source of truth. The QuickBooks Online Accounting API and Payments API exist for later integration when it becomes worth the effort. citeturn5search9turn5search27turn5search15  
- **Fastest pay-link option without deep integration:** Stripe Payment Links (shareable links) if you want customers to pay online immediately; Stripe documents Payment Links as shareable URLs and publishes the standard pricing structure. citeturn18search1turn18search5turn18search0  
- **QuickBooks Payments option:** QuickBooks publishes its payment rates; you can adopt it when you want payments to “live inside the accounting ecosystem.” citeturn5search3turn5search28

If you want, I can rewrite the Cursor prompt as a literal “task-by-task checklist” (each task one Agent run) so you can execute it like a build script.