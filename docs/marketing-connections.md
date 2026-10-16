# Marketing connections

Alivia uploads job photos and saves drafts in the marketing workspace. This document covers the direct publishing connections, weekly results, and paused ad drafts added beside that workflow. It does not change photo capture, draft editing, website portfolio publishing, or the export ZIP.

Publishing mode defaults to mock. Nothing is posted to Facebook, Instagram, Google, or an ad account unless `MARKETING_PUBLISH_MODE=live`. Do not set that during local development.

## Status meanings

| Status | Meaning |
| --- | --- |
| Connected | Required app configuration, granted scopes, platform access, and a selected account are all present. |
| Missing configuration | An app credential is absent, or an account still needs to be chosen. |
| Expired authorization | The saved token is past its expiry and could not be refreshed. |
| Pending platform approval | OAuth may have succeeded, but Meta or Google has not granted the permission or API access required to use it. |
| Error | The last provider call failed for a reason other than the states above. |

A connector is not treated as usable just because a token exists.

## Environment variable names

Set these on the server only. Do not put tokens in client props, logs, or reports.

- `MARKETING_TOKEN_ENCRYPTION_KEY` — 32 bytes, base64. Encrypts OAuth tokens at rest.
- `MARKETING_PUBLISH_MODE` — `mock` (default) or `live`.
- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_VERSION` — optional, defaults to `v26.0`.
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_BUSINESS_API_ACCESS` — set to `granted` only after Google approves Basic API Access.
- `GOOGLE_ADS_API_ACCESS` — `test`, `basic`, or `standard` after the Cloud project is approved.
- `GOOGLE_ADS_API_VERSION` — optional, defaults to `v26`.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — optional manager account id, digits only, used only when a manager account calls a client account.
- `GOOGLE_ADS_DEVELOPER_TOKEN` — optional legacy header. Google retired developer tokens on September 9, 2026; access follows the Cloud project.
- `NEXT_PUBLIC_APP_URL` — already used by the app. OAuth redirects are `{APP_URL}/api/publishing/callback/meta` and `{APP_URL}/api/publishing/callback/google`.
- `NEXT_PUBLIC_SUPABASE_URL` — required for the limited public media URL Instagram and Google fetch. Must be `https`.
- `CRON_SECRET` — already used by the schedule digest. The weekly report cron uses the same bearer secret.
- `MARKETING_REPORT_SENDING` — must be `enabled` before a report can be sent.
- `MARKETING_REPORT_RECIPIENT`
- `MARKETING_REPORT_CHANNEL` — `email` or `discord`.
- `MARKETING_REPORT_DISCORD_WEBHOOK_URL` — only read when channel is `discord` and sending is enabled. Email has no transport yet, so an email channel saves the preview and does not send.

## Account setup

### Facebook Page

- Use a Facebook Page. The API does not publish to personal profiles.
- Create a Meta app, add Facebook Login, and set the redirect URI above.
- Request `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`.
- Standard Access works only for people with a role on the app. Alivia can test against the Page she manages if she is an app admin, developer, or tester.
- App Review Advanced Access is required before the app can post for any Page whose admin is not an app role.
- The Page admin needs the CREATE_CONTENT task.
- Posts are uploaded from private job storage. The browser cannot supply an image URL.

### Instagram

- The account must be a professional Instagram account (Business or Creator) linked to the Facebook Page. Personal accounts cannot publish.
- Request `instagram_basic` and `instagram_content_publish` in addition to the Page scopes. Meta's Instagram Login product uses the newer `instagram_business_basic` and `instagram_business_content_publish` names; this app uses Facebook Login because the Page link is required.
- Publishing is two steps: create a media container, wait until `status_code` is `FINISHED`, then call `media_publish`. `IN_PROGRESS` is stored as processing and is not reported as published.
- Images must be JPEG, up to 8 MB. PNG and WebP should go to Facebook or Google, or be exported as JPEG first.
- Instagram fetches the image from a public URL. This app copies only the selected photo to `site-public/marketing-ingest/{org}/{random}` for about two hours, then deletes it. The private `job-assets` bucket is not made public.
- The account can publish 100 API posts per rolling 24 hours. Rate-limit responses are failures, not published posts.

### Google Business Profile

- OAuth scope: `https://www.googleapis.com/auth/business.manage`.
- Enable the Business Profile APIs on the Cloud project, including the My Business API used for local posts.
- Quota starts at 0. Submit the Basic API Access application. Until Google approves it, the connection stays Pending platform approval even after OAuth. Default quota after approval is 300 requests per minute.
- Local posts are created at `https://mybusiness.googleapis.com/v4/accounts/{account}/locations/{location}/localPosts`.
- One photo per post. A `PROCESSING` post is polled. `REJECTED` is a failure.
- Google fetches photo URLs, so the same limited ingest files are used.

### Google Ads

- OAuth scope: `https://www.googleapis.com/auth/adwords`.
- Apply for test, basic, or standard access on the Cloud project's Google Ads API overview. Basic and standard access for new applications need brand verification.
- This app can create a paused Search campaign and a paused budget only after the exact draft is approved. It never sends status `ENABLED` and it has no budget-increase call.
- Creating the paused budget does not start spending while the campaign stays paused. The campaign is still not created at all in mock mode.

### Meta Ads

- Scopes: `ads_read`, `ads_management`, `business_management`, `pages_show_list`, `pages_read_engagement`.
- Advanced Access is required to manage an ad account the app user does not own.
- A paused campaign shell (`status: PAUSED`, objective `OUTCOME_TRAFFIC`) is created only after approval. The ad set, where a budget would actually run, is not created. The budget and schedule stay on the draft in this app.

## Local behavior

- Connections: `/marketing/connections`
- Results: `/marketing/results`
- When preview mode is on (`DEV_BYPASS=1` or no `DATABASE_URL`), Connect returns to the connections page and does not start OAuth. Publish and campaign APIs refuse the request. Accounts are not saved.
- Publish API: `POST /api/publishing/publish` with `jobId`, `draftId`, `assetIds`, and `destinations`. The caption is read from the saved `marketing.draft.saved` activity. Unknown fields, including image URLs, are rejected.
- Each destination has its own delivery row, idempotency key, provider id, attempts, and error. Retrying a published row does not post again. A row that already has a provider id is polled.
- Weekly cron: `GET` or `POST /api/cron/marketing-report` with `Authorization: Bearer <CRON_SECRET>`. The same organization and reporting week (previous completed Monday–Sunday, America/New_York) returns the saved preview and does not send again.
- Reports say Not connected or Unavailable when a source is missing. A real zero from lead or schedule records is a zero. Phone-click events are Unavailable because this app does not store them. Ad spend is not estimated. Cost per qualified lead is not calculated from website leads.
- Quote submissions, logged phone calls, and scheduled jobs are not revenue.

## Database

Migration: `prisma/migrations/20261016190000_marketing_publishing`.

Apply it only to a local database when you are ready. Do not apply it to production as part of this work. `npx prisma generate` refreshes the client without migrating.

## Tests

```powershell
npx tsx --test src/lib/publishing/publishing.test.ts
```

The tests use mocked providers. They do not call Meta, Google, email, or Discord.
