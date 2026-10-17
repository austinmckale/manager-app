# Local processing and owner alerts

Ryan uploads to the hosted app and private storage. The Windows task named
`RHI Pros Local Marketing Worker` runs independently of the Codex desktop app
while this Windows user is signed in and the PC is awake. Locking the screen is
fine. The worker checks about once a minute; draft discovery waits for 15 minutes
without a new photo. This is an intake settling window, not an AI runtime promise.

The owner turned GPU on. Default local runs use the GPU, 1280px images, and JPEG
quality 90. CPU-only remains available only when `INTAKE_AI_CPU_ONLY` or
`INTAKE_REVIEW_CPU_ONLY` is exactly `1`, and then images are 768px. Original
uploads stay unchanged. All three Ollama stages respect that setting: photo
analysis, draft writing and independent review. Only existing downloaded models
are used; there is no paid or hosted fallback. Actual performance still depends
on PC load. New recordings and new drafts are processed before older draft reviews.

Each failed recording backs off for five then ten minutes, stops after three
failed attempts, and remains saved. One bad recording does not stop subsequent
recordings. The owner can retry failed recordings at `/marketing/delivery`.
Retries preserve source media and require the authenticated owner and matching
organization.

Draft generation uses the same pattern. Each submission has one
`marketing.generation.job` ActivityLog row with `queued`, `running`, `completed`,
or `failed`. Ordinary rescans upsert that row and do not create another job or
draft. A failed attempt waits five minutes, then ten, and stops after three.
The stored error is the fixed sentence “Local draft generation could not
complete. The submission remains saved.” A worker restart finds a `running` job,
puts it back in `queued`, and keeps the same submission id. One failed
generation job does not stop the next submission. This does not implement
two-PC leasing. No database migration is required.

`MARKETING_ALERTS_DISCORD_WEBHOOK_URL` is a server-only secret. It is stored in the
ignored local production environment and Vercel production environment, never in
source code or client props. Only HTTPS Discord webhook endpoints are accepted.

The cloud upload route queues and attempts one owner notification when the first
photo in a submission is received. This works even when the processing PC is off.
The local worker also reconciles receipts and saved packs from the last two days,
dispatches queued alerts, and sends one alert per processing-failure incident and
one recovery alert. A draft-ready alert means a draft was saved for owner review;
it does not mean approved, released to Ryan, emailed or published.

Alerts use durable ActivityLog records (`marketing.owner.alert`) with atomic
claims and provider-confirmed message IDs. Failed deliveries retry up to five
attempts. An HTTP timeout can have reached Discord; a later retry can duplicate
that notification. Raw provider errors, webhook secrets, photos, source notes,
transcripts and capability links are excluded from messages and local status.
Discord mentions are disabled. Messages link to authenticated owner pages.

Enable notifications for this channel in the Discord mobile app to receive phone
push notifications. Discord accepting a message does not prove phone delivery.
SMS and email remain disabled. A separate cloud heartbeat monitor is still needed
to proactively report a powered-off or disconnected processing PC; this worker
cannot notify while its own machine is off. Failed alert records can be inspected
in the database; this version has no owner-facing alert retry button.

Checks cover failure isolation/backoff, generation restart recovery, CPU settings,
owner-only retries, webhook destination validation, event deduplication, retry
persistence and one-time worker failure/recovery alerts. Generation status is an
ActivityLog row, so no Prisma migration is required and none is applied.

Recovery example, using one submission id `20000000-0000-4000-8000-000000000002`:
claim sets `running` and `attempts` 1; stopping before save leaves that row and
the photo receipt in place; the next worker start queues the same row without a
new id; the following claim uses `attempts` 2; after save the row is
`completed`, and another scan does not write a second draft.
