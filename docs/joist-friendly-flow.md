# Joist-Friendly Lead Flow

## Recommended operating flow
1. Capture all inbound leads via webhook (`/api/leads/intake`) from website/text/call tools.
2. Send estimates/invoices from Joist (your existing process).
3. Export Joist CSV regularly (daily or weekly).
4. Upload CSV on `/leads` under `Joist CSV Import`.
5. Leads are auto-created/updated and staged for conversion.
6. Convert won leads to jobs in app and run ops from there.

## Why this works
- Keeps Joist where your team already sells.
- Keeps operations/costing/time/photos in one system.
- Gives real lead-to-win KPI based on actual dispositions.

## Import behavior
- Reads common Joist CSV fields: client name, phone, email, address, status, estimate/invoice number, title/description.
- Uses `joist:<estimate-or-invoice-number>` as `externalRef` for updates.
- Maps Joist status to lead stage:
  - approved/accepted/paid/completed -> WON
  - declined/lost/cancelled -> LOST
  - sent/viewed/pending/open/draft -> ESTIMATE_SENT
  - other -> CONTACTED

## Import cadence
- Minimum: once per week.
- Better: end of day.
- Best: automate CSV export handoff and upload in office closeout routine.
