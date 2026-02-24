# Gap vs. Big-Name Field Service / Construction Software

Comparison of FieldFlow Manager to established products (e.g. Procore, Buildertrend, JobNimbus, ServiceTitan, Housecall Pro, CoConstruct). Use this to prioritize what to build next.

---

## What You Already Have

| Area | You have |
|------|----------|
| **Jobs** | Jobs, status, customer, address, budgets, schedule blocks, crew assignments, Joist/scope uploads |
| **Leads** | Pipeline, stages, Joist CSV import, source tracking |
| **Time** | Clock in/out by job, time entries, conflict prevention, payroll-style exports |
| **Team** | Active workers, add/edit/deactivate, assign crew to jobs, attendance + weekly schedule |
| **Money** | Estimates, change orders, invoices, manual payments, expenses by category (incl. Subcontractor), cost health |
| **Documents** | Photos, receipts, documents (e.g. Joist PDFs), share links, client portal (estimates, invoices, schedule, photos, message form) |
| **Tasks** | Punch list / tasks per job, assignee, due date, status |
| **Reporting** | CSV exports (time, expenses, job profitability), Company health KPIs (margin, labor %, materials %, win rate, days to pay) |
| **Integrations** | QuickBooks link (outbound), Joist CSV import |
| **Auth** | Roles (owner/admin/worker), role-based views (Today, attendance) |

---

## Where You’re Missing vs. Big Names

### 1. **Payments & invoicing**

| Gap | What big names do |
|-----|-------------------|
| **Online payments** | Stripe/square: client pays invoice via link (card/ACH). You only have “Add payment” (manual). |
| **Recurring / progress billing** | Scheduled draws, %-complete billing, retainage. You have one-off invoices. |
| **Automated reminders** | Overdue invoice emails/SMS. You have no automated dunning. |

**Suggested next:** Stripe (or similar) for “Pay invoice” link on portal and/or PDF; optional overdue-email job or integration.

---

### 2. **Contracts & e-sign**

| Gap | What big names do |
|-----|-------------------|
| **Contracts** | Job contract/agreement stored and e-signed (DocuSign, etc.). You have estimates/invoices, no contract entity. |
| **E-sign on estimates** | Customer signs estimate/approval in app. You have PDF download only. |

**Suggested next:** DocuSign/HelloSign (or embedded e-sign) for estimate approval and optional contract; store signed PDF on job.

---

### 3. **Subcontractors as first-class entities**

| Gap | What big names do |
|-----|-------------------|
| **Sub roster** | Subcontractors as contacts/vendors: license, insurance, W-9, 1099 tracking. You have “Subcontractor” expense category only. |
| **Sub bids & POs** | Send scope to subs, get bids, issue POs. You have expenses only. |
| **Lien waivers** | Generate/collect lien waivers per job or payment. You have none. |

**Suggested next:** Subcontractor (or “Vendor”) entity with basic info + insurance/expiry; link expenses to subs; optional lien-waiver PDF flow later.

---

### 4. **Compliance & risk**

| Gap | What big names do |
|-----|-------------------|
| **Insurance tracking** | Your COI, subs’ COI; expiry dates and reminders. You have none. |
| **License tracking** | Contractor license # and expiry. You have none. |
| **Safety / OSHA** | Safety docs, incident reports, toolbox talks. You have none. |

**Suggested next:** Org-level “Insurance” and “License” (or one “Compliance” section) with expiry dates and optional reminders.

---

### 5. **Scheduling & dispatch**

| Gap | What big names do |
|-----|-------------------|
| **Visual calendar** | Drag-and-drop calendar (day/week) for jobs and crew. You have list/table and blocks on job. |
| **Route optimization** | Suggested order of jobs by drive time. You have none. |
| **Drag crew** | Assign by dragging crew onto job on calendar. You have checkboxes on Attendance + job hub. |

**Suggested next:** Week view calendar (by job or by crew) with blocks; drag-to-reschedule optional.

---

### 6. **Client communication**

| Gap | What big names do |
|-----|-------------------|
| **In-app messaging** | Thread per job or per customer; client sees in portal. You have one-way “post message” from portal. |
| **SMS/email from app** | Send estimate/invoice or reminder via SMS/email from the product. You have PDF links only. |
| **Appointments** | Client self-books or confirms visit. You have none. |

**Suggested next:** Two-way messages in portal (thread per job); optional “Send invoice by email” with link.

---

### 7. **Mobile**

| Gap | What big names do |
|-----|-------------------|
| **Native app** | iOS/Android app (offline, push, camera). You have responsive web + offline upload queue. |
| **Crew app** | Dedicated field app: today’s jobs, clock, capture, tasks. You have same web app with role-based views. |
| **GPS** | Location at clock-in or job site. You have a setting flag only, no actual GPS. |

**Suggested next:** Keep web-first; add “Add to home screen” and ensure Today + Time + Capture work well on phones; optional GPS capture at clock-in later.

---

### 8. **Reporting & analytics**

| Gap | What big names do |
|-----|-------------------|
| **Custom reports** | User-defined filters (date range, job type, customer) and saved reports. You have fixed CSV exports and Company health. |
| **Dashboards** | Multiple widgets, date range, drill-down. You have one Dashboard + Today. |
| **Benchmarking** | Compare to industry or past periods. You have targets only. |

**Suggested next:** Date range and filters on exports; optional “Compare to last period” on Company health.

---

### 9. **Multi-location / company structure**

| Gap | What big names do |
|-----|-------------------|
| **Locations / divisions** | Jobs and crew scoped to location or division. You have one org. |
| **Franchise / multi-org** | Separate companies under one product. You have single-org. |

**Suggested next:** Only if you need it; otherwise skip.

---

### 10. **Integrations**

| Gap | What big names do |
|-----|-------------------|
| **QuickBooks sync** | Two-way: push invoices/customers or pull data. You have outbound link only. |
| **Accounting sync** | Xero, etc. You have none. |
| **Payment processors** | Stripe, Square in-product. You have none. |

**Suggested next:** Stripe for payments; optional QB sync (export format or API) if you need it.

---

## Suggested priority (to “feel like” big-name software)

1. **Online payments** (Stripe) – invoice pay link + optional portal “Pay now”.
2. **Client messaging** – two-way thread in portal (and/or email send for invoices).
3. **Contracts / e-sign** – estimate approval or contract e-sign, store on job.
4. **Subcontractors** – vendor/sub entity, link to expenses, optional insurance/expiry.
5. **Insurance / license** – org-level compliance with expiry and reminders.
6. **Calendar view** – week view of schedule (by job or crew).
7. **Custom reports** – date range + filters on exports and KPIs.

Everything else (native app, route optimization, multi-location, etc.) can wait until you hit limits with the above.
