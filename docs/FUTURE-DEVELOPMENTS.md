# Future developments and progress

Last updated: October 18, 2026, 6:30 PM Eastern. This is the handoff for the next model. Product boundaries stay in [MARKETING-VISION-AND-ROADMAP.md](MARKETING-VISION-AND-ROADMAP.md). This file says what is done, what this commit includes, and how to finish the rest without breaking the rules.

A code push is not a deployment. The live site is https://app.rhipros.com and follows GitHub `master` only after Vercel deploys. The installed worker folder is `C:\Users\Alivia\Projects\Manager App\manager-app-marketing-20261018` (a clean export of commit `c4ab712`; see its RELEASE-COMMIT.txt), not this git tree. It replaced `manager-app-marketing-hybrid-20261017` on October 18, 2026 at 6:06 PM Eastern, after that folder crashed 86 cycles in a row because two files were never copied into it. A website deploy does not update the worker folder. To update it, build a new release folder from `master`, run `node --import tsx scripts/worker-preflight.ts` inside it, then point the task at it with `scripts/install-marketing-worker.ps1 -WorkerRoot <folder>`. Do not hand-copy single files into a live release. Do not restart the worker unless a restart is required. Do not click the desktop shortcut `RHI AI` while working. It toggles the live scheduled task `RHI Pros Local Marketing Worker`.

## Do not do these unless the owner asks again

- The app never emails or texts Ryan by itself. Outbound email and SMS from the app stay off. Owner decision, October 18, 2026: the inbox's "Email this note to Ryan" button is a `mailto:` link that opens the owner's own mail app addressed to `rhisolutions316@gmail.com`; the owner presses send. `ryanran321@gmail.com` is not a destination. The only email address that may ever be used is `austinmck17@gmail.com`, and even that stays off until the owner chooses to send. The only SMS number is `6104514099`.
- Do not set `MARKETING_PUBLISH_MODE=live`. Do not create, queue, or publish a Buffer post unless the owner asks for that exact action. A private Buffer draft is a real object in Buffer.
- Models (owner decision, October 18, 2026): `qwen3.5:4b` reads notes and photos; `qwen3.5:9b` writes, fixes, fact-checks and rewrites captions (`INTAKE_OLLAMA_WRITER_MODEL` in the worker's `.env.marketing-ai.local`). Measured on this RTX 3070 8 GB: both run 100% on the GPU at 8K context, and the 9B uses about 7.5 of 8 GB. Do not go larger than 9B on this card.
- Do not build ads spend controls, Search Console pulls, Joist, a second Ryan portal, or native Facebook as part of finishing the organic post. Buffer is the only organic posting path.
- Do not send Discord messages for agent status. Discord is for real upload and draft events.
- Do not apply production Prisma migrations. Do not print `.env` secrets. Do not commit `tmp/`.

## Progress already on GitHub

`97a8a99` and `47ce036` are on `origin/marketing/workspace` and `origin/master`.

- Desktop shortcut shows a Windows message box titled RHI local AI. Off refuses to disable the task when a status file says `processing`. It stops `qwen3.5:4b`, `qwen3.5:9b` and `qwen2.5vl:3b`. Reading the installed worker folder's status file is included in this commit. Origin will have that script change after the push.
- Processing and review shows whether the stored worker check-in is older than 5 minutes. The website cannot see the GPU.
- Caption suggestions show in the AI assist panel, the Facebook and Google fields, and the preview. Save uses that visible text.
- The ChatGPT bundle downloads photos through `/api/marketing/review/media?draftId=&photoId=`. Import fills the text boxes, reorders existing photos, and can show a short "Improve:" note. Branch `marketing/write-fix-loop` adds forgiving imports and edited-photo uploads (see MARKETING-AI-WORKFLOW.md). They go live after that branch merges and Vercel deploys.
- The inbox shows a short note to Ryan pointing him to app.rhipros.com (no private upload link) and an "Email this note to Ryan" button that opens the owner's mail app (on branch `marketing/write-fix-loop`). The app sends nothing.
- "Check all captions with AI" on the review page saves any unsaved edits (including a ChatGPT/Claude import), queues the AI check of every caption, and shows suggested fixes with Accept / Accept all (on branch `marketing/write-fix-loop`; needs the worker release built from it).

## Included in this commit

These inbox, review, results, and worker-status edits are included in this commit. After the push, origin will have them.

- Inbox status now adds a sentence when the stored check-in is older than 5 minutes: local AI may be off or the PC may be asleep. File: `src/app/(app)/marketing/page.tsx`.
- Approval asks for a 10-character note only for a non-cosmetic AI warning. Photo notes such as "verification purposes" do not require it. The same rule is in `needsResolutionNote` (`src/lib/content-review.ts`), the API (`src/app/api/marketing/review/route.ts`), and `approveDisabled` in `src/components/content-review-editor.tsx`.
- Ad-line warnings and photo notes are collapsed on the review page. File ids are shown as "this photo". Real blockers stay open.
- Saving a review can keep a subset or a new order of photos already on that version. It still rejects a photo that was not on the version. That is what lets the ChatGPT photo order save.
- "Rewrite the post" queues one caption revision for Facebook and Google Business only. It does not approve or post. If the local worker is off, the text will not change until that PC runs.
- "Fix the copy checks" no longer fills empty ad lines with "Request an estimate." Fallbacks are photo labels such as "See the photos."
- Results shows stored Buffer delivery rows. It does not call Buffer. A private draft is labeled as not a published post. File: `src/app/(app)/marketing/results/page.tsx`.
- The pause script also checks `manager-app-marketing-hybrid-20261017\.vercel\marketing-worker-service\status.json` before it turns the task off.

## How a later model finishes the real post

The milestone is one real Ryan upload becoming one owner-approved Buffer draft, then a post the owner chooses inside Buffer. The open draft that says "testing testing" is a voice-memo test. Do not publish it.

1. Confirm the live site is on the latest `master` deploy. A push is not proof the site updated.
2. Confirm the installed worker folder is running the same generation and caption code as this git tree, or copy the needed scripts into that folder without restarting a healthy worker unless required. `INTAKE_OLLAMA_MODEL` stays unset or `qwen3.5:4b`, and `INTAKE_OLLAMA_WRITER_MODEL=qwen3.5:9b`.
3. On the worker PC, the owner clicks `RHI AI` only when they want local AI on for drafts or off for games. The message box is the proof. `ollama ps` with no rows means the models are not loaded. A stale website check-in does not prove that.
4. Ryan's own iPhone Google login at https://app.rhipros.com is still unproven. Do not build a second portal. One upload path until a confirmed post.
5. When the owner asks, create one private Buffer test draft from https://app.rhipros.com/marketing/buffer and look in https://publish.buffer.com under Drafts for "RHI Pros integration test". Do not queue it. Instagram was not in the saved channel list. Recheck channels before assuming Instagram is connected.
6. After a real approved send, the results page should show that Buffer row. It already lists stored rows. It does not yet import Buffer analytics. Do not invent metrics.

## Still not built

- One-shot rewrite does not auto-apply, auto-save, or auto-approve. "Rewrite the post" only queues the local model (now the 9B). New uploads go through a write, fact-check and fix loop before anything is held. If that still cannot produce a postable caption, the owner uses Ask ChatGPT or Claude.
- The checks wall is shorter, not gone. Privacy, empty Facebook or Google Business, bad landing hosts, and unsupported work claims stay blockers.
- Cloud heartbeat monitoring while the PC is off. Discord cannot wake a sleeping PC. Do not build a Discord on/off button.
- No token or GPU dashboard. Do not add one.
- P4 in the roadmap: one weekly results page with real Buffer outcomes, then read-only Google Ads, Meta ads, and Search Console. No spend token. A live campaign change is a later package with its own approval and a ceiling.
- Joist estimate learning and a second Ryan entry are later, after the single upload path posts once.
- Reviewed website placement and customer review requests are later. They do not block the first Buffer post.

## To do (owner list, October 18, 2026 evening)

Ordered by what gets Ryan posting soonest. Each item is its own piece of work.

1. **Merge and deploy `marketing/write-fix-loop`.** Then build a new worker release from `master`, run the preflight and point the task at it. The current release already has the write loop and the 9B writer; the merge adds forgiving ChatGPT/Claude imports and edited-photo uploads to the live site.
2. **Previous jobs: turn the 24 website projects into saved marketing packs** so past work can be posted between new uploads. The projects are already stored (`marketing.website.project`, `src/lib/website-projects.ts`, `src/lib/website-project-catalog.ts`, `/api/marketing/website-project`). Brainstorm, nothing decided yet:
   - A Marketing tab named **Past jobs** (other names: Previous jobs, Job library, Portfolio posts). One card per project with its best photo, town, service and when it was last posted.
   - Each project becomes a draft through the same pipeline: the published website description is the source note and the website photos are the photos, then the write loop, checks and owner approval. Label the generator `website` and keep the link to the project page.
   - An evergreen rule: when no new upload has come in for 7 days, suggest one past job. Skip anything posted in the last 90 days, and match the season (decks and patios in spring, interiors in winter).
   - Post formats to try: "From the project files", a detail-shot carousel, project of the month, and before/after only where real before photos exist.
   - Skip retired or hidden website projects (the website's `retiredProjects.ts` and `showInGallery: false`). Never invent details the website does not state.
   - Photos must be FileAssets on a job to pass the save and Buffer checks. Some projects already have `assetIds`; the rest need their website images imported once.
3. **Write in Ryan's voice.** Give the writer two or three of Ryan's approved posts and his own phrases from voice notes as examples, and learn from the edits the owner makes before approving.
4. **Prove the website lead path.** No website lead has reached the app since the October 16 intake fix. Send one quote request marked TEST from rhipros.com and confirm it shows on Leads.
5. **Joist import** (separate from finishing the first organic post). Pull estimates and invoices from Joist once the owner is signed in to Joist in a browser tab Claude can use.
6. **App speed.** Production logs show the app running in `iad1`, although `vercel.json` asks for `pdx1` next to the database. Find out why the region is not applied.
7. **Ryan's day-to-day helpers:** photo reminders on job days, review-request texts after a job, and AI drafts for estimates and customer replies (needs an AI key in Vercel).
8. **Optional Hybrid mode.** Add `OPENAI_API_KEY` (a billing account) to the worker's `.env.marketing-ai.local` for stronger photo reading and writing; voice stays local.
9. **Results.** Read real Buffer outcomes into Results once posts go out. Do not invent metrics.
10. **Small fixes:** the browser tab still says "FieldFlow Manager". Delete the old worker folder `manager-app-marketing-hybrid-20261017` once the new release has run a few days. Keep `manager-app-intake-release-20261016-152445`: the new release links to its Python packages for voice transcription.

## Verify

```powershell
node --test scripts/check-content-review.mjs scripts/check-publishability.mjs
```

Inbox: http://localhost:3000/marketing shows the Ryan note and, when the check-in is old, the 5-minute sentence. Review page: ad notes and photo notes are closed; a real warning still asks for a note. Do not click `RHI AI`.
