# Photo-to-marketing workspace

This version is for the owner receiving photos from the crew. Ryan does not need to use the app.

## Use

1. Choose **Add photos** in the app header, or open `/capture`. Pick a job or leave photos in **Unsorted photos**. Choose **Files** to upload several photos received from Ryan. A note and area are optional. Stage defaults to work in progress.
2. Browser-readable photos are resized to a maximum of 2048 px and re-encoded as JPG, without the source metadata. HEIC conversion loads only when native decoding fails. A failed conversion leaves the original untouched on the user's device and reports an error. Keep originals; this app is not an archival backup.
3. Uploads persist to IndexedDB before a network attempt. Pending/failed counts and messages distinguish uploaded photos from device-only copies. Retries preserve the upload ID so a lost success response does not produce a second asset. Retry occurs with the relevant capture screen open/reopened; background upload after closing the app is not promised. The existing service worker remains disabled.
4. Open **Review & create** (`/marketing`). Filter by job or publication/archive status, select photos, and use **Prepare posts & ads**. Edit the starting text, destination URL and headlines. Save drafts to the job or download a text backup.
5. Download a marketing pack: selected photos, Facebook/Instagram caption, Google Business Profile text, Meta ad text/headline, Google Search ad text, draft JSON and UTM links. Browser-friendly first photos also produce square (1080×1080), portrait (1080×1350) and landscape (1200×628) graphics. Review every placement before use. Copy buttons support manual posting. Preparing/exporting never launches a campaign or spends money.
6. To publish to the website, assign photos to a real job, use JPG/PNG/WebP, mark **Finished work**, check public-use permission and descriptions, and publish. Only owner/admin roles can mutate marketing content. Remove public photos before editing, moving or archiving them.

## Website limits

The existing website reads portfolio photos from Supabase. This version publishes to that feed; it does not replace curated homepage features, service galleries, town galleries, or create project stories. Photos remain private until explicitly published. Marketing previews use short-lived signed links to private originals.

The feed flag is updated only after copying the image to `site-public`. Publication actions are awaited and failures are returned visibly, including partial failures. Website revalidation happens after the database change. Removal clears the feed flag before deleting the public copy. Successful storage changes with a failed/missing revalidation connection show a warning; existing website caching can delay visible changes by up to an hour.

Existing variables are reused: `SITE_REVALIDATE_URL`, `SITE_REVALIDATE_SECRET`, `SUPABASE_STORAGE_BUCKET`, and the existing database/Supabase credentials. Website-side configuration remains required, including its public portfolio access policies and `PORTFOLIO_STORAGE_BUCKET=site-public`. No new schema migration is required for this version.

Draft snapshots use organization-scoped `ActivityLog` entries with action `marketing.draft.saved`; archive status is the `marketing:archived` asset tag. Photo moves keep storage keys unchanged. `/marketing/saved` lists snapshot versions. Each version keeps the pack name, original notes, public town/region, service, original photo notes, selected asset IDs and the edited captions/headlines/link. Open & reuse loads a specific organization-scoped snapshot via `draftId`; a subsequent save creates another snapshot and preserves the original. If original photos were moved or removed, text backup remains available. This is reusable content storage, not a recurring repost scheduler or publishing history.

## Results and remaining connections

The seven-day summary is internal app data: new photo assets, published photo assets updated within the period, and quote leads carrying `utmCampaign=job-…` from exported links. It is not an ad-performance report. Social posting APIs, ad creation APIs, actual ad spend, actual calls, booked revenue and scheduled report delivery are not connected by this version. Missing ad data is described, not shown as zero.

Cursor's separate assignment is documented in `docs/CURSOR-MARKETING-HANDOFF.md`. Its integration folders are separate from these foundation files.

## Verify

- `npm run check:marketing`: executes actual draft schema, marketing route and publication service code against isolated database/storage/auth stand-ins. Never posts or publishes real photos.
- `npx tsc --noEmit --incremental false`
- Focused ESLint on changed files; report unrelated pre-existing errors separately.
- `npm run build`
- With a local demo server only (`DEV_BYPASS=1`), `/marketing?example=1` shows two real public photos and approved factual text from the website's Reading patio/pavilion project. Example packs can be saved locally in that browser (up to 50 snapshots); the UI explicitly labels device-only preview persistence. Server-side demo saves/publishes remain rejected. Do not use DEV_BYPASS to enable production access.

Before deploying, test with an authenticated owner account and a non-public test photo in the configured environment. Production credentials and live posting are not exercised by the isolated tests.
