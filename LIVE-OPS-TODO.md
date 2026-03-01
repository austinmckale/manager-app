# Live Ops TODO

Updated: 2026-02-28

## Done
- [x] Joist PDF worker/runtime crash fix for import pipeline.
- [x] Joist parser improvements for better job name/address extraction.
- [x] Revenue fallback improvements from Joist documents.
- [x] Jobs page text typo fix (`week&apos;s` rendering issue).
- [x] Production schema sync for Discord digest settings columns.
- [x] Import permission crash fix (worker role import flow).
- [x] Upload size/413 mitigation with browser-side pre-processing before server action submit.
- [x] Jobs detail access fix to stop valid job cards opening to 404 (permissions/query mismatch).
- [x] Removed junk imported lead used for bad test data.
- [x] Deployed fixes to Vercel and aliased to `app.rhipros.com`.
- [x] Mobile Joist picker reliability improvement (`Choose Files` explicit trigger + status label).
- [x] Manifest icon asset fix (`/icons/icon-192.png` and `icon-512.png` now real PNG files).
- [x] Worker-triggered schedule action crash guard (no more hard-throw 500 on `/jobs/[id]` for schedule permissions).
- [x] Jobs board controls simplified to always show all active jobs (filter chip stack removed).
- [x] Added quick close-out button per active job card (moves job into closed section without deleting cost/labor/history data).

## In Progress
- [ ] Mobile schedule visit cards cleanup in job hub (time + action buttons alignment and spacing).
- [ ] Attendance/Team roster mobile cleanup (long job names causing control overflow and visual break lines).
- [ ] Attendance schedule board on mobile is not scrollable/readable; add streamlined mobile day view with `This Week / Next Week` toggle. (Implemented, verify on device)
- [ ] Attendance page performance hardening for mobile load stability.
- [ ] Schedule + Crew UX simplification pass (reduce clutter, clearer date + crew presentation per visit).
- [ ] Verify production `/jobs/[id]` digest `3609216865` is fully resolved after deploy.

## Still Needed
- [ ] Ensure Joist import to Jobs never creates generic "Imported Lead" records when the PDF is actionable.
- [ ] Tighten low-confidence fallback so customer/address confidence does not block valid Joist job linking.
- [ ] Verify `rhisolutions_invoice_379.pdf` imports as a clean actionable Job with full extracted details.
- [ ] Confirm Wayne Pace and Felicia job links always open job hub (no intermittent 404).
- [ ] Confirm Joist uploads no longer produce client-side exception in production.
- [ ] Validate dollar/revenue extraction across all Joist sample docs.
- [ ] Confirm duplicate pipeline confusion is resolved (no unnecessary duplicate "Estimate Sent/Joist Import" behavior).
- [ ] Add/verify Discord schedule digest setting flow:
  - [ ] Enabled toggle in Settings.
  - [ ] Digest payload includes crew, location, client, tasks, schedule details, and job notes.
  - [ ] Webhook configured and tested end-to-end.

## Final Go-Live Verification
- [ ] Mobile test: Joist import (choose file -> import -> job created/updated -> open hub works).
- [ ] Mobile test: job schedule cards (buttons aligned, no overlap/overflow).
- [ ] Mobile test: attendance roster (controls fit card, no horizontal overflow artifacts).
- [ ] Production smoke test: Jobs, Leads, Team, Time, Settings all load without app/client/server exceptions.
