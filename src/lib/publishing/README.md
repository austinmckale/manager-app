# Facebook publishing handoff

The owner UI can use `GET /api/publishing/status?draftId=<saved-draft-uuid>`.
The endpoint requires the authenticated dashboard owner and returns `Cache-Control: no-store`.
Omit `draftId` for setup only. Existing `migrationReady`, `publishMode`, and `connections` fields remain available.

New response fields:

- `tables.connections` and `tables.deliveries`: both publishing tables must exist. An empty table is ready; a missing relation is not.
- `facebook.status`: `SETUP_REQUIRED`, `ACCOUNT_REQUIRED`, `APPROVAL_REQUIRED`, `READY_FOR_SIMULATION`, or `READY_TO_POST`.
- `facebook.canSimulate` / `canPublish`: mutually exclusive. Simulation needs current owner approval and delivery storage, and works without a connected Facebook account or Meta credentials.
- `facebook.approval`: `state`, `draftId`, and, only when approved, the current `approvalHash`. State is `NOT_SELECTED`, `UNAVAILABLE`, `REVIEW_REQUIRED`, or `APPROVED`.
- `facebook.simulationBlockers`, `setupBlockers`, and `liveBlockers`: arrays of `{ code, message }`. Show blockers for the intended action. Missing configuration contains names only.
- `facebook.account`: stored Page id/name/status. `authorizationCheck: "stored_only"` means no Meta API request was made. This is not a fresh token validation or confirmation of app review/access.

Fetch readiness again after changing the selected draft or completing owner review. Readiness is informational: publishing and retry APIs independently recheck the exact owner approval and source evidence.

Submit `POST /api/publishing/publish` with only `jobId`, `draftId`, `assetIds`, and `destinations: ["FACEBOOK_PAGE"]`.
The server loads the approved copy. A simulation returns `mode: "mock"`, result `status: "SIMULATED"`, `providerPostId: null`, and `simulation.text` / `simulation.photos`. Display it as **Simulation — nothing posted**. There is no provider post link.

Results from publish/retry and delivery status now include `requiresManualCheck`. If true, show the supplied error and disable automatic retry. A network interruption, missing feed post id, or server failure can leave Facebook's outcome uncertain. Check the actual Page before intentionally starting a replacement delivery. Do not imply that a failed confirmation means no post exists.

Retry uses `POST /api/publishing/retry` with only `deliveryId`. It cannot change the caption, photos, approval version, or mode. Confirmed photo uploads are mapped to their original asset ids, so partial retries upload remaining photos before attempting the complete feed payload. Legacy/unreadable upload checkpoints require manual checking. Delivery claims and progress writes reject competing attempts. The pre-feed checkpoint survives an interruption after sending a potentially public request.

Verification (all use synthetic data and fake transports):

```powershell
npx tsx --test src/lib/publishing/publishing.test.ts src/lib/publishing/approval.test.ts src/lib/publishing/readiness.test.ts src/lib/publishing/providers/facebook.test.ts
```

Production enablement is a separate step: migration/configuration, connected Page authorization, owner approval of a real draft, deployment, and one explicitly authorized live post checked on Facebook. Passing these tests does not establish live publishing.

## Cursor's next UI step

Keep UI work in the Facebook publishing screen and its display tests. Consume the status endpoint when the saved draft changes, render the relevant blocker messages, and gate the action with `canSimulate` or `canPublish`. Treat a failed readiness request as unavailable rather than ready. Keep approval editing in the existing review screen. Add `requiresManualCheck` to the result display type, retain the returned delivery id, and prevent retries when that flag is true. Use the approved simulation response to display the actual caption and selected photos. Verify blocked setup, stale approval, simulation, confirmed publication, and uncertain publication states using fixtures. Do not connect accounts, change publishing backend/schema/workers, send notifications, deploy, or publish live content as part of that UI package.
