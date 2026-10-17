# Content review and owner approval

Open https://app.rhipros.com/marketing/saved and select **Review & approve**.
The workflow is owner-only, with the same account restriction as the dashboard.

1. Inspect every selected photo, the original submitted receipt notes, recording
   and raw transcript. Original media and receipt notes are not overwritten.
2. Edit corrected notes, public location, copy, headlines and landing page. Save
   an immutable new draft version. The previous version is marked superseded and
   cannot be approved or exported through this workflow.
3. Request local checks. The standalone worker picks up queued reviews, and also
   checks up to the 50 most recent saved versions that do not already have a review.
   Labeled tests are skipped by automatic discovery. Review status refreshes while
   queued/running; the page can be closed while processing continues.
4. Resolve blockers by saving another version and checking again. Warnings need
   an owner resolution note. Confirm facts, the destination and photo permissions,
   then approve the exact version and download the approved pack.

The reviewer is a separate Qwen/Ollama call, not a separate model. It sees the
original receipt notes, raw transcription, corrected notes, all selected-photo
descriptions and the first four actual images. The screen exposes the coverage
limit and requires human inspection of every photo. Shared model blind spots
remain possible. There is no automatic transcript correction or assertion that
model agreement proves truth. Claude/Codex subscription reviews are not connected.

Private evidence and public copy are separated in the review prompt. Text
findings must identify a public field and quote an exact fragment from it before
they can block approval. Unmatched quotes become explicitly unverified warnings;
duplicate findings are removed. An initial test caught the model confusing private
test notes with public copy, so this evidence check is enforced in code.

Visual observations (category `images`) are advisory warnings requiring an owner
resolution. A single exterior photo cannot disprove details explicitly dictated
in the recording. The initial visual test incorrectly demanded that lighting and
ceiling details appear in that exterior photo; its findings remain visible for
human confirmation. Factual, privacy and copy blockers still block approval,
including privacy findings about visible photo content. All photos still require
the owner's explicit inspection and permission confirmation.

The review transport uses native Node HTTP with a ten-minute deadline and a
256 KiB response limit, avoiding fetch's shorter header timeout during slow CPU
image processing. `INTAKE_REVIEW_CPU_ONLY=1` is an optional worker-process setting
for CPU inference with four threads and 384px images; normal mode uses 768px.
The verification script sets it only for its own process. The worker normally
continues using the downloaded local model and GPU when available. Busy hardware
can make inference take several minutes; no time guarantee is implied.

An SHA-256 hash covers the full draft plus original notes/transcripts, selected
assets, their stages/descriptions and update times. Reviews and approvals bind to
that hash. A source change invalidates the current review and approval. Serializable
transactions protect save/approve races. The reviewer rechecks the hash before
persisting results; changed input fails closed. It has no publishing tools.

Server checks reject missing copy, off-site landing URLs, duplicate Google
headlines, contact emails, unfinished transcription, blockers, stale hashes,
superseded versions, missing owner confirmations and unresolved warnings.
The media endpoint checks owner authentication and the selected draft's own
organization/submission before serving a recording; callers cannot supply keys.

The review, approval and supersession history uses ActivityLog records. No Prisma
migration or publishing table is required. API: `/api/marketing/review`.
Workspace: `/marketing/review/[draftId]`. Demo-only example:
http://127.0.0.1:3107/marketing/review/example; demo save/check/approve are disabled.

Approval is internal. It does not publish, spend, send messages or release a
client pack. Existing timed intake packs now default to `ownerApproved: false`
and are excluded from client listings, pack/media reads and outgoing email
eligibility until a separate explicit release workflow is connected. No UI in
this change sets the pack release flag. This deliberately closes automatic
timer-based client release; website photo publishing remains its existing
separate owner permission flow. The new approval is not yet a gate on every
possible future publishing connector; those connectors remain excluded from the
isolated live release.

Local reviewer failures are stored on the review record, do not approve anything,
and can be retried explicitly. There is no paid AI fallback. The worker's status
file also records reviewed/reviewFailed booleans. One PC is supported; shared
leases and backup-PC failover still require a separate implementation.

Checks include permission/origin/preview restrictions, evidence hash changes,
blocked approvals, immutable save/supersession, required warnings/confirmations,
idempotent approvals, and denial of unapproved timed client packs. Live inference
is tested separately with labeled fixtures; no real client content is approved
or published during verification.

Verification: 61 isolated checks pass. Live owner page returned 200, stale approval
returned 409, anonymous mutation redirected to sign-in. Qwen3.5:4b completed a local
review of the existing labeled voice/photo fixture: one image checked, two visual
warnings under the owner-confirmation policy, no approved/released content. CPU
inference was slow while the PC was busy; there is no claim of instant results.
