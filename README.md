# FieldFlow Manager (MVP)

Mobile-first job management web app for small contractors (remodel + insurance work).

Tech stack:
- Next.js (App Router) + TypeScript
- Prisma + PostgreSQL (Supabase recommended)
- Supabase Auth + Supabase Storage
- PWA support (installable on iOS/Android)

## Current Status

Working preview with auth disabled for speed (demo mode):
- `http://localhost:3001/dashboard`
- `http://localhost:3001/jobs`

Implemented core flows:
- Jobs dashboard/list/detail tabs
- Customers
- Time tracking views + timer actions
- Expenses + receipt capture UI
- Estimates/change orders/invoices/payments workflow (MVP)
- Portfolio view + ZIP export helper
- Share links + lightweight client portal pages
- CSV exports (time, expenses, profitability)
- PDF endpoints (estimate/invoice/change order)
- Offline-friendly upload queue client utility

## Setup

### 1) Install

```bash
npm install
```

### 2) Environment

Copy `.env.example` to `.env.local` and fill values:

```env
DATABASE_URL="postgresql://..."
NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."
NEXT_PUBLIC_APP_URL="http://localhost:3001"
SUPABASE_STORAGE_BUCKET="job-assets"
```

### 3) Prisma

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

### 4) Supabase Storage

Create bucket:
- Name: `job-assets` (or value from `SUPABASE_STORAGE_BUCKET`)

Recommended policies for MVP:
- Authenticated users can upload/read/write their org assets
- Public read for client-share files only if you need direct public URLs

### 5) Run App

```bash
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Open:
- `http://localhost:3001`

## Demo Mode (Current Default)

For rapid preview, auth is temporarily bypassed and demo identity is used (`Owner/Admin`).

What this means:
- You can open app routes immediately without magic-link login
- Pages render from demo-safe data paths when DB is unavailable
- Form actions are no-op-safe in demo mode

## Key Routes

- Dashboard: `/dashboard`
- Jobs: `/jobs`
- Job Detail: `/jobs/[jobId]`
- Customers: `/customers`
- Time: `/time`
- Reports: `/reports`
- Portfolio: `/portfolio`
- Target Settings: `/settings/targets`
- Share Link: `/share/[token]`
- Client Portal: `/portal/[token]`

## Exports

- Time CSV: `/api/export/time-entries`
- Expenses CSV: `/api/export/expenses`
- Job Profitability CSV: `/api/export/job-profitability`

## PDF Endpoints

- Estimate PDF: `/api/pdf/estimate/[id]`
- Invoice PDF: `/api/pdf/invoice/[id]`
- Change Order PDF: `/api/pdf/change-order/[id]`

## Build/Test Commands

```bash
npm run lint
npm run build
```

## Future Roadmap

1. Scheduling + dispatch board
2. SMS reminders (appointments, overdue invoices)
3. QuickBooks sync (customers, invoices, payments)
4. Online payments (card/ACH links)
5. Review request automation (Google/Facebook)
6. Stronger RLS + org isolation hardening
7. Full image annotation persistence and before/after composer UX polish
8. Production auth restore + role-based route guards

## Notes

- Prisma is pinned to `6.x` currently for schema compatibility.
- Before production launch, restore real auth flows and disable demo bypass.
- Deep research implementation checklist: `docs/deep-research-follow-through.md`.
