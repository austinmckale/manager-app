# Codex integration notes

The marketing editor now reaches the publishing pages:

- More tools includes Account connections (`/marketing/connections`) and Weekly report (`/marketing/results`). The bottom Results tab stays on campaign scorecards at `/marketing/performance`.
- The marketing page status line links to connections and weekly results. Export and website publishing stay in place.
- `saveDraft` returns `{ ok: true, draftId }`. After a save, “Post this version” opens `/marketing/connections?draftId=<id>`. The publish API rereads that saved pack on the server.

## Boundaries that stay as they are

- Website publishing continues to copy approved photos to `site-public` and call the revalidation webhook.
- Instagram and Google Business Profile use a separate `marketing-ingest/` prefix with a short lifetime. Do not make `job-assets` public.
- Workers stay on capture. Publishing checks `canManageOrg`.
- Do not add a path that asks Ryan to operate the marketing pages.
