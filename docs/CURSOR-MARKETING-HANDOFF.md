# Cursor task: connect the RHI Pros marketing workspace

Work in `C:\Users\Alivia\Projects\Manager App\manager-app`.

## Business goal

This is Alivia's marketing workspace, used by her only. Ryan sends her job photos and notes outside the app. She uploads them once and uses them to market RHI Pros through the website, Facebook, Instagram, Google Business Profile, Google Ads and Meta Ads. Do not design a new workflow that requires Ryan to operate the app. Do not promise increased revenue or fabricate campaign results.

## Work split — avoid collisions

Codex is finishing the capture/review/draft/export foundation. Cursor owns the external publishing connections and reporting described below. Existing changes are uncommitted. Inspect `git status` and diffs before touching anything. Do not reset, discard, reformat or overwrite another person's work.

**Codex owns these files during the current work:**

- `src/components/file-capture.tsx`
- `src/lib/client/offline-upload.ts` and `src/lib/client/prepare-photo.ts`
- `src/app/(app)/capture/page.tsx` and `src/app/api/uploads/route.ts`
- `src/components/marketing-job-review.tsx`
- `src/app/(app)/marketing/page.tsx` and `src/app/api/marketing/route.ts`
- `src/lib/marketing.ts`, `src/lib/marketing-review.ts`, `src/lib/client/marketing-export.ts`
- `src/app/(app)/marketing/saved/`, `src/lib/saved-marketing.ts`, `src/lib/marketing-example.ts`, `src/components/saved-marketing-packs.tsx`
- Urgent intake frontend: `src/lib/field-intake.ts`, `src/components/crew-photo-intake.tsx`, `src/components/intake-link-manager.tsx`, `src/app/send-photos/`, `src/app/api/field-intake/`, `src/app/api/marketing/intake/`, `src/app/(app)/marketing/intake/`, and the corresponding middleware exemptions. See `docs/RYAN-UPLOAD-READY.md`. Do not duplicate or overwrite these.
- `src/lib/portfolio-publish.ts`, `src/lib/revalidate-site.ts`
- `src/components/app-shell.tsx`, `src/components/quick-actions-fab.tsx`, `src/app/manifest.ts`
- The legacy portfolio action in `src/app/(app)/actions.ts` and job photo links.

Other pre-existing local edits include `today/page.tsx`, `auth-session-warmup.tsx` and `nav-prefetch.tsx`; preserve them too.

**Cursor should add new files under:**

- `src/lib/publishing/` — provider adapters, OAuth, token handling, retry logic.
- `src/app/api/publishing/` — account connection, callbacks, publishing, status.
- `src/app/(app)/marketing/connections/` — connection settings.
- `src/components/publishing/` — reusable connection/publish controls.
- `src/lib/marketing-reporting/`, `src/app/api/cron/marketing-report/`, `src/app/(app)/marketing/results/` — reporting.
- `docs/marketing-connections.md`, focused test scripts, and new Prisma models/migrations if needed. Do not apply migrations to production.

Keep the initial integration UI in the new subpages. Document the small follow-up changes needed in Codex-owned files rather than editing them concurrently. Coordinate package.json/package-lock edits separately; Codex added `heic2any`.

## Existing foundation — inspect actual code

- `/capture` accepts batches of job photos, optional notes, area and before/during/finished stage. There is an unsorted-photo inbox.
- `/marketing` groups photos by job, lets Alivia select photos, assign them, edit descriptions/stage, archive them, save drafts and publish suitable photos through the existing website portfolio feed.
- Drafts include Facebook/Instagram caption, Google Business Profile update, Meta primary text/headline, Google Search ad headlines/descriptions, graphic headline, landing URL and selected asset IDs. The canonical Zod schema is in `src/lib/marketing.ts`.
- Draft snapshots currently live in organization-scoped ActivityLog entries named `marketing.draft.saved`. No new foundation database migration is required.
- `/marketing/saved` is the reusable content library. Each save preserves a new snapshot with original inputs, photo notes and edited public copy. `draftId` returned by the save endpoint is the ActivityLog id and can identify the exact version approved for a platform. `/marketing?draftId=...` reopens that version with organization checks. Preview-only packs use browser local storage, explicitly labeled as device-only, and never stand in for production persistence.
- Downloadable ZIP includes photos, social/ad copy, UTM links and square/portrait/landscape graphics when the source format is supported. This is export, not direct posting or ad launch.
- Website publishing uses Supabase `job-assets` and `site-public`, then an authenticated website revalidation webhook. Do not expose the private bucket or replace existing curated homepage/service/town galleries.
- The website checkout currently being used by Codex is `C:\Users\Alivia\Documents\ChatGPT\RHIPros`; another copy exists under Projects. Do not edit or deploy either without checking which checkout is authoritative.

## Cursor phase 1 — direct organic publishing

Implement connections for Facebook Pages, Instagram professional accounts and Google Business Profile locations using the current official APIs. Check official documentation for eligible account types, permissions, quotas, app review and verification requirements. Do not assume a connector is usable before its permissions are granted.

Build an owner/admin-only Connections page that clearly distinguishes Connected, Missing configuration, Expired authorization, Pending platform approval and Error. Use OAuth/state validation, secure server-side credentials, least-necessary scopes, org isolation and token refresh. Never expose tokens to client props, logs or reports. Include disconnect/revoke behavior.

Build provider adapters and an authenticated publish API accepting a job ID, an existing saved draft identifier, selected asset IDs and explicit destinations. Revalidate asset ownership and the exact approved content on the server. Do not accept arbitrary remote image URLs from the browser. Instagram needs publicly reachable media for ingestion: use a controlled, limited public-media lifecycle, not blanket public access to job storage.

Persist per-destination delivery records with provider post IDs, timestamps, errors, attempt counts and an idempotency key. A Facebook success must not hide a Google failure. Retrying a request must not duplicate an already successful post. Distinguish accepted, processing and actually published responses; poll where the provider requires it. Provide a retry path for failures. Manual publish first; add scheduling only when delivery persistence is reliable.

Use mocked providers for tests. Do not publish real posts during development.

## Cursor phase 2 — weekly results

Create `/marketing/results` showing published posts, failed deliveries, attributable website leads and provider metrics when connected. Include reporting period, last refresh time and source. Missing data must read “Not connected” or “Unavailable,” never zero. Distinguish quote submissions, phone-click events, actual calls and booked jobs. Do not label a lead as revenue.

Add a weekly report generator and protected cron endpoint. Generate a preview first. Keep sending disabled until an explicit recipient and delivery channel are configured. Reuse existing app notification/email patterns if appropriate; don't send real email or Discord messages while testing. Make repeated cron runs idempotent for the reporting week. Ad spend and cost per qualified lead require actual ad account data; don't estimate them as if measured.

## Cursor phase 3 — paid ads

After organic publishing works, add Google Ads and Meta Ads account connections and campaign draft creation. Keep content preparation separate from launch. Require explicit account, destination URL, service area, objective, budget, schedule and approval of the exact campaign before any spending action. No automatic budget increases or campaign launch. If required access/app approval is missing, retain usable export and show the precise missing step.

## Validation and handoff

- Read repository instructions and installed Next.js docs. This app uses Next 16.4.2; don't assume older APIs.
- Follow existing auth and `canManageOrg` patterns; no worker publishing permissions. Check every job, asset, connection and delivery belongs to the authenticated organization.
- Test unauthorized access, cross-org IDs, OAuth state mismatch, expired tokens, partial multi-platform failure, retry deduplication, cron deduplication and provider rate limits.
- Run TypeScript, focused lint, meaningful tests and a production build. Don't upgrade unrelated dependencies or “fix” pre-existing edits.
- Never print secrets or dump `.env` files. List required environment variable names and account setup steps without their values.
- No real posting, ad spend, production migrations or deployment during this task. Deliver reviewable code, local preview, test results, remaining external account requirements and exact integration steps for the Codex-owned editor.
