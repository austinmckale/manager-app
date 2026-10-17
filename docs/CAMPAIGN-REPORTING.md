# Campaign scorecards and Ryan's reports

Deployed October 16, 2026 as `dpl_DYV8nKBVi97KuyhfrjstTuDtfUW1` at https://app.rhipros.com. Owner/admin dashboard: `/marketing/performance`, linked from Marketing as **Ad results & reports**. Ryan uses **Reports** on his existing `/send-photos/[token]` page, with no additional account.

## What works

Owners/admins can enter campaign statistics from Meta/Google exports and lead records, preview results, save immutable snapshots, reopen them, and save new versions. Each row records campaign/platform IDs, source reference, attribution settings and account timezone. Reporting dates and a data-as-of timestamp are explicit. Money is USD; convert and document any non-USD source before entry. Blank is unavailable; a measured zero stays zero.

The scorecard includes ad spend, impressions, clicks, platform conversion counts, verified inquiries, qualified leads, estimates, booked jobs, attributed collected revenue, and a target CPQL. It calculates CTR, CPC, CPQL and collected-revenue ROAS only with valid denominators and available data. Platform conversions are never added across accounts as unique leads. Business totals require confirmation that leads, jobs and payments have each been assigned once to campaigns. Qualified-lead criteria are required. Recommendations compare measured CPQL with the entered target and never change budgets.

Lead outcomes refer to the cohort acquired during the entered reporting period, as known on the data date; do not mix this with unrelated jobs/payments arriving that week. Collected revenue is not estimated contract value or profit. Conversion lag and the platform's attribution settings can make numbers differ between sources.

Reports can be copied as text, exported to CSV, or printed/saved to PDF by the browser. CSV export escapes formula-like text. Source and attribution labels travel with the export. No report numbers are seeded into production.

## Sharing

After saving, select Ryan's active upload link and create a private report link. The link references the immutable snapshot and is scoped to that invite and organization. Ryan sees it in his Reports list. **Open owner email draft** prepares a mailto draft addressed only to `austinmck17@gmail.com`. It does not send mail, and it does not address Ryan. Sharing a snapshot exposes its aggregate figures, campaign names, sources and commentary to anyone holding that private link, so keep personal lead details out of commentary. Disabling/expiring the upload capability blocks the reports too.

Storage uses existing ActivityLog actions `marketing.scorecard.saved` and `marketing.scorecard.shared`. No Prisma migration or Cursor publishing models were deployed. Read endpoints require a valid signed invite and an org-owned shared snapshot. Save/share APIs require authenticated owner/admin access and same-origin requests. Public upload tokens cannot create or edit reports.

## Not connected

Buffer is not configured in this app. Ryan does not connect Buffer merely by opening his upload link. Facebook/Google business account authorization and any Buffer API credential still need their own setup. Automatic ad-stat imports, offline conversion imports, scheduled client email, SMS, live campaign control and the finalize/client-choice publishing workflow are not claimed by this scorecard.

Cursor's separate `/marketing/results` implementation remains in the working source and was not bundled into this isolated release. It currently returns missing platform data and its email transport does not send. This additive scorecard is independently usable while those integrations are completed.

## Validation

44 isolated checks pass (7 scorecard, 13 intake/delivery, 24 marketing), plus focused ESLint, TypeScript and the Vercel production build. Local browser validation used clearly marked DEMO ONLY values: $200 spend, 4 qualified leads, $50 CPQL, 1 booked job and $1,000 collected revenue = 5x collected ROAS. These were not saved or shared in production. Live checks confirmed the Reports link and public empty report list return 200, owner dashboard requires sign-in, and unknown reports return 404. No real email, post, ad or budget change occurred.
