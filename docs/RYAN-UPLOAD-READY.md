# Ryan's upload-only frontend

Ryan opens a private link on his phone. **Choose photos**, **Take a photo**, **Record a voice note**, **Send**, and **My uploads**. Town/job name and description also support typing or the phone keyboard's dictation microphone. There is no before/after picker: local AI suggests phases on the owner side and leaves uncertain photos unassigned. Recorded audio is received privately and transcribed on this PC. See `LOCAL-MARKETING-AUTOMATION.md` for the current deployment, local runtime, checks, active processing schedule, and disabled outbound delivery.

## Routes

- Owner: `/marketing/intake` creates, copies and disables upload links.
- Ryan: `/send-photos/[token]`, outside the Manager App shell, no account required.
- Receiver: `POST /api/field-intake`, authenticated solely by a scoped upload capability, not an admin session.
- Inbox: `/marketing`; crew photos are grouped by submission, with the supplied town/job label.

Each link expires after 30 days, accepts up to 300 photos, and can be disabled. It can upload only to its organization's unassigned photo inbox. It cannot list jobs, read photos or publish content. Owner/admin review is still required for website use. Original descriptions/location are retained in the intake receipt metadata and the photo notes.

Phone photos are prepared as JPG before sending. Up to 12 photos per submission are sent one at a time to stay below request size limits. The client stores the unsent batch and notes in IndexedDB, serializes writes, and retains stable photo IDs across retries. Keep the screen open while sending; background upload is not promised. Uploaded photos are neither portfolio-published nor client-visible. Server-side signatures, organization checks, expiry, revocation, byte/size checks and idempotency are enforced independently of the UI.

The link signature uses `FIELD_INTAKE_SECRET` when configured, otherwise the app's existing server-side `SUPABASE_SERVICE_ROLE_KEY`, with an intake-specific HMAC context. No new configuration or schema migration is required. Rotating the signing secret invalidates existing links. Keep the link private; anyone holding it can submit photos until it expires/is disabled.

## Release coordination

Codex owns the new intake files and the marketing queue changes. Cursor's concurrent `src/lib/publishing/`, Prisma models and migrations must not be bundled into this intake-only release before their own checks are complete.

A separate release source was prepared at `C:\Users\Alivia\Projects\Manager App\manager-app-intake-release-20261016-152445`. It contains tracked HEAD plus only Codex's foundation/intake changes, not Cursor's unfinished Prisma changes or the three pre-existing performance edits. It is linked to the existing Vercel manager-app project. It must use that project's production environment variables; no secrets are committed.

Validation: 24 isolated checks passed, including invite signatures, expired/revoked links, cross-organization isolation, public upload scope, quota rejection, retry deduplication, and private/unpublished receipt creation. Phone-browser preview verified two real website photos, note entry, and draft restoration after reload. The isolated release passed a production webpack build. The local Turbopack build encountered a Windows dependency-path issue caused by the temporary shared-dependency junction; that junction and old build output are excluded from the deployment. No data migration is part of this release.

## Deployed October 16, 2026

Production: https://app.rhipros.com. Deployment `dpl_FUnnq9duq5aS2myFp834eQYkv8dK` completed successfully with the default cloud Turbopack build. All 24 checks and the local production webpack build passed. Existing production environment values contained trailing whitespace and literal carriage-return suffixes; these were corrected through the Vercel CLI without changing their substantive values. A fresh environment pull and database connection verified the correction.

A real upload-only invite was created for the default organization under Austin McKale's active admin profile. It expires November 15, 2026. The capability URL is kept in the isolated release's `.vercel/ryan-upload-link.json`, not this source document. Manage or replace links at `/marketing/intake`.

Verified without app login: live upload page 200, icon 200, token-specific manifest 200 with `private, no-store`, exact capability URL as start URL, and invalid manifest 404. A real website sample photo was submitted through the live browser UI and received successfully. The resulting FileAsset `5d1f6cf6-fb36-4f0d-9b26-8c511e15d46d` is in Photo Dump with `isPortfolio=false`, `isClientVisible=false`, unknown stage, and the supplied notes. It is clearly marked TEST; do not publish it again. Do not message Ryan without the user's explicit instruction.

## iPhone Home Screen

The intake page has a first-visit iPhone/iPad invitation with Show me how / Not now, and a persistent Save as app help button after dismissal. Help is hidden when running as a standalone app. Safari requires the person to use Share → Add to Home Screen → Open as Web App (if shown) → Add; a website cannot launch that native installation prompt on iOS.

Each active capability has its own dynamic manifest and start URL, plus RHI Photos title and an accessible 512px camera icon under `/send-photos/`. The saved icon opens the upload page rather than the Manager App dashboard. It uses the same 30-day link expiry and revocation rules. A replacement link requires updating the saved shortcut; this release does not promise offline launch or background sending. Device drafts and the original photos should be kept until successful receipt. Native iOS installation has not been tested on a physical iPhone; the responsive help UI and served manifest/icon were checked in the browser.
