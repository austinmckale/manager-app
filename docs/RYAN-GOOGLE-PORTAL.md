# Ryan's Google portal

Entry address: https://app.rhipros.com. Choose Continue with Google using either
ryanran321@gmail.com or rhisolutions316@gmail.com. Both identities resolve to the
same existing upload inbox through an organization/job-scoped ActivityLog
`client.portal.access` mapping. No passwords were created or messages sent.

Full dashboard access is restricted to austinmck17@gmail.com and its existing
active owner/admin profile. Other emails are denied regardless of legacy
AUTH_ALLOWED_EMAILS, owner profiles or cached contexts. Automatic owner profile
creation on sign-in is removed. Ryan's two emails remain portal-only. Uncached
manager authentication verifies the user and confirmed email with Supabase.

The OAuth callback and root route send Ryan to `/portal`; manager accounts go to
`/marketing`. Client identity uses server-verified Supabase `getUser()` and a
confirmed email, not client-submitted email or editable user metadata. These two
emails are denied manager authentication even if an older owner profile or owner
context cookie exists. No new Prisma role or database migration was needed.

Google portal membership is the ActivityLog row `client.portal.access`. It stays
valid after the mapped upload invitation expires or is revoked. Both emails read
that same membership, including photos, recordings, transcripts and submission
IDs from every invitation id stored on it. A new 30-day upload invitation is
created only for the signed-in portal when the current one cannot accept uploads.
Shared `/send-photos/` links still fail when expired or revoked. Revoking Google
portal access writes `client.portal.revoked` for that membership and does not
delete the earlier submissions.

The local processing worker still calls
`resolveUploadInvite(uploadInviteToken(inviteId))` before it prepares a
submission. New portal uploads use the fresh invitation, so the current worker
can process them without a code change. It will skip a submission whose
invitation has expired or been revoked. If an expired invitation still needs
processing, the worker's `source()` check has to accept that invitation for the
same organization while the shared link continues to reject it. Do not delete
the original ActivityLog rows when renewing access.

The portal and login page advertise a token-free manifest starting at `/portal`.
On iPhone, Save as app explains Safari Share -> Add to Home Screen. iOS may ask
for a separate sign-in inside the installed web app. Installation is manual;
offline cold launch and background upload are not implemented.

Both email mappings and Google provider availability were checked in production.
Actual OAuth completion must be tested by Ryan using his own Google account and
iPhone; enabling Google in Supabase alone does not prove his consent flow succeeds.

Manager navigation is Inbox, Drafts, Results, More. More contains photo capture,
upload access, processing/delivery, overview, leads, jobs/Joist, business reports,
team and settings. Duplicate header shortcuts and the floating quick-action menu
are removed. The source files for those older features remain available.

Checks: existing 44 marketing/intake/report checks plus four new portal permission
checks; TypeScript and focused ESLint. Deployment and live checks are recorded in
the conversation. Publishing and outbound delivery remain disabled.
