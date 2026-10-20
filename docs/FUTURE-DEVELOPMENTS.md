# Future developments and progress

Last updated: October 20, 2026. This is the handoff for the next model. Product boundaries stay in [MARKETING-VISION-AND-ROADMAP.md](MARKETING-VISION-AND-ROADMAP.md). This file says what is done, what this commit includes, and how to finish the rest without breaking the rules.

A code push is not a deployment. The live site is https://app.rhipros.com and follows GitHub `master` only after Vercel deploys. The installed worker folder is `C:\Users\Alivia\Projects\Manager App\manager-app-marketing-20261020-8e7397d` (a clean export of commit `8e7397d`, installed October 20, 2026 at 4:20 PM Eastern; see its RELEASE-COMMIT.txt), not this git tree. The October 19 folder `manager-app-marketing-20261019-532181f` is kept for a few days as the fallback. Releases are clean exports since October 18, when the hand-patched `manager-app-marketing-hybrid-20261017` crashed 86 cycles in a row because two files were never copied into it. A website deploy does not update the worker folder. To update it, build a new release folder from `master`, run `node --import tsx scripts/worker-preflight.ts` inside it, then point the task at it with `scripts/install-marketing-worker.ps1 -WorkerRoot <folder>`. Do not hand-copy single files into a live release. Do not restart the worker unless a restart is required. Do not click the desktop shortcut `RHI AI` while working. It toggles the live scheduled task `RHI Pros Local Marketing Worker`.

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
- The checks wall is shorter, not gone. Privacy, an empty Facebook or Google Business post, a photo that should not be posted, and unsupported claims about a town, offer, date or material stay blockers. Saying RHI Pros did the work in its photos is not a claim to prove (owner direction, October 20, 2026).
- New uploads (the intake writer) still write and fact-check the whole pack, ad lines included, so an ad line the checker dislikes can hold a new upload. The review page, its check and Rewrite with AI cover only the two posted captions. Narrowing the intake audit means changing its `checkedFields` contract (`checkedFieldsMatch` in `src/lib/marketing-evidence.ts`, checked in `scripts/intake-marketing-worker.ts`).
- Cloud heartbeat monitoring while the PC is off. Discord cannot wake a sleeping PC. Do not build a Discord on/off button.
- No token or GPU dashboard. Do not add one.
- P4 in the roadmap: one weekly results page with real Buffer outcomes, then read-only Google Ads, Meta ads, and Search Console. No spend token. A live campaign change is a later package with its own approval and a ceiling.
- Joist estimate learning and a second Ryan entry are later, after the single upload path posts once.
- Reviewed website placement and customer review requests are later. They do not block the first Buffer post.

## To do (owner list, updated October 20, 2026)

Ordered by what gets Ryan posting soonest. Each item is its own piece of work.

### Done October 20, 2026 (branch `app/polish-and-locks`; live after it is pushed to `master`, and the worker parts after a new worker release)

- **Review page rebuilt as four steps** showing only what Buffer posts: Photos, Post text (Facebook & Instagram, Google Business, each with Keep), Improve with AI, Check and approve. Ad drafts, town, service and pack name moved under More; ad checks no longer block approval or publishing (`postedCopyChecks`). The old caption panel is gone. See MARKETING-AI-WORKFLOW.md, "The review page".
- **Typed AI requests are followed.** "Rewrite with AI" sends what the owner typed. A note that asks to remove something ("remove the dishwasher description") is enforced: the writer never gets those facts, is told to leave them out, is sent back if it mentions them, and any sentence that still mentions them is cut. The AI check, its suggested fixes and the rewrite cover only the two posted captions, and the Google Business update may not repeat the Facebook post.
- **ChatGPT round trip in one ZIP.** The bundle prompt always asks for a careful study of every photo, clean-up of imperfections with every change listed, the two posts, and one `rhi-import.zip` (import.json plus edited photos). "Choose the ZIP ChatGPT gave back" imports text and photos in one step; pasting text still works.
- **RHI did the work in its photos; posts are about the work, with life** (owner direction). The writer, house voice, photo reader, fact-check, older caption rewrite and ChatGPT prompt all say so; the "notes do not say RHI built it" blocker is gone. First drafts are written warmer (0.55 and 0.8).
- **Fewer false holds.** Photo concerns block only for privacy or a reason not to post; website facts filed under the wrong source are kept (this is why past-job packs got zero facts); the "what is missing" pass never asks for paperwork, model numbers, dates or the town.

- **Live October 20:** `8e7397d` on `master`, worker release `C:\Users\Alivia\Projects\Manager App\manager-app-marketing-20261020-8e7397d` (installed 4:20 PM Eastern; preflight passed, first cycle 0 failures). The kitchen pack was rewritten without the dishwashers and passed its check (version `5416778a-01fe-44bb-9395-c657397b4796`). The owner chose the AI's text as written and a private Buffer draft, and is importing ChatGPT's edited photo 2 (dishwasher panels) before approval.
- **Pick posts** (branch `app/post-picks`, needs the push and a new worker release): Fill my picks prepares every untouched past-job post on this PC, and Post it approves and sends one to Buffer. See MARKETING-AI-WORKFLOW.md, "Pick posts". The send page warns when another version of a job went to Buffer in the last 90 days, and Pick posts hides those jobs.

### Next, in order

1. **First real post** (the kitchen pack, version `5416778a-01fe-44bb-9395-c657397b4796`). After the owner imports edited photo 2: Save and check with AI, approve, send as a private Buffer draft, then confirm the post id and status, with no duplicates.
2. **Schedule page and choosing the time in the app:** one page listing every Buffer delivery (draft, scheduled time, or posted with its link, refreshed from Buffer), and a time picker when sending so the owner does not have to open Buffer. Buffer's API takes a custom time for a post; check its current field names before building.
3. **Alerts.** A cloud-side check that posts to Discord when work is waiting and the worker heartbeat is over about 60 minutes old (once per outage, plus a back-online note), and per-job Discord links for draft ready, needs details, rewrite ready and Buffer send failed. Needs a scheduler: Vercel cron (plan-dependent) or GitHub Actions, and a `CRON_SECRET` the owner adds in Vercel.

### Done October 19, 2026 (live: master `532181f`, worker release `532181f`)

- **Worker releases.** `696d28e` was installed in the morning; `532181f` (everything below) replaced it at 8:44 PM Eastern at `C:\Users\Alivia\Projects\Manager App\manager-app-marketing-20261019-532181f`. Preflight passed and the first cycle was idle with 0 failures.
- **App speed checked.** Requests enter Vercel at the Virginia edge (`iad1`, near the owner) and the server code runs in Oregon (`pdx1`, next to the Supabase database in `us-west-2`): `x-vercel-id: iad1::pdx1::…` on dynamic routes. Moving the server east would put every database query across the country; moving everything east means a new Supabase project. Signed-in pages answer in about 200 to 470 ms and the review page is ready in about 0.5 s with no long tasks. The earlier "iad1" was the edge, not the server.
- **Installed app is "RHI Pros Manager".** Manifest, browser tab, PDFs and Discord reminders no longer say FieldFlow. The installed app opens on `/` (owner to the marketing inbox, a client to the portal). Chrome or Edge can install it from the address bar; no .exe is needed.
- **Keep and regenerate on the review page.** Every caption has a Keep toggle; a hand edit keeps that caption. "Regenerate unlocked captions" (with an optional note) rewrites only the others with the kept ones as fixed context, fact-checks and fixes them, and fills only unlocked boxes with Undo. Accept all fixes and ChatGPT/Claude imports leave kept captions alone. It reuses the last AI check's evidence, or reads the photos itself when the draft was never checked. Measured on this PC with nothing else using the GPU: 28 to 92 seconds, 0 problems left in three runs. (An earlier 8-minute measurement was the live worker using the GPU at the same time.)
- **Past jobs tab** (`/marketing/past-jobs`, in the More menu). The catalog is rebuilt from the website's gallery by `scripts/sync-website-projects.ts` (18 projects; retired and gallery-hidden projects and the website's hidden photos are left out). "Make a post from this" copies the project's website photos into one internal job, "Website past jobs", as AFTER photos, saves a pack whose captions start from the website's published summary and solution, and queues the AI check so suggested fixes appear on the review page. "Make packs for all" does them one by one. Nothing is approved or posted.

### Still to do

1. **Make the first Past jobs packs on the live app** (owner clicks "Make a post from this" or "Make packs for all"); the AI checks then run one at a time on this PC.
2. **Evergreen past jobs:** done for the inbox. When Ryan has sent no photos for 7 days, the inbox suggests one past job: not sent to Buffer in the last 90 days, in season (outdoor work March to September, indoor work October to February), the same pick Monday to Sunday. Still to try: post formats such as "From the project files", a detail-shot carousel and project of the month, and before/after only where real before photos exist (the website has `beforeImages` for some projects; they are not imported yet).
3. **Write in Ryan's voice.** Started: every writer call (new posts, suggested fixes, regenerate, Shorter / More direct) gets a house voice from the website's copy rules (`scripts/local-voice.ts`) and the owner's three newest approved Facebook/Instagram posts as tone examples, never as facts. There are no approved posts yet, so only the house voice applies until the owner approves some. Still to do: phrases from Ryan's real voice notes once he records some.
4. **Prove the website lead path.** No website lead has reached the app since the October 16 intake fix. Send one quote request marked TEST from rhipros.com (owner's go-ahead first: it emails the business inbox) and confirm it shows on Leads.
5. **Joist import** (separate from finishing the first organic post). Pull estimates and invoices from Joist once the owner is signed in to Joist in a browser tab Claude can use.
6. **Ryan's day-to-day helpers:** photo reminders on job days, review-request texts after a job, and AI drafts for estimates and customer replies (needs an AI key in Vercel). Use the same Keep / regenerate design for estimate lines and replies.
7. **Optional Hybrid mode.** Add `OPENAI_API_KEY` (a billing account) to the worker's `.env.marketing-ai.local` for stronger photo reading and writing; voice stays local.
8. **Results.** Read real Buffer outcomes into Results once posts go out. Do not invent metrics.
9. **Navigation choice for Ryan.** The app opens on marketing (Inbox / Content / Results) with Today, Leads, Jobs and Money under More. Ryan may want Today and Leads first; one option is a per-person landing page.
10. **Small fixes:** delete the old worker folders `manager-app-marketing-hybrid-20261017`, `manager-app-marketing-20261018` and `manager-app-marketing-20261018-696d28e` once the new release has run a few days. Keep `manager-app-intake-release-20261016-152445`: every release links to its Python packages for voice transcription. `src/components/marketing-processing-controls.tsx` has a lint error (Date.now() during render) from earlier work; it does not block the build. `src/lib/evidence-claims.ts` is only used by its own test.

### Ideas from the owner, October 19, 2026

- **Desktop app feel.** Done as far as it helps: the app installs as "RHI Pros Manager" in its own window. An Electron or Tauri wrapper would only be worth it for offline use, desktop notifications or file access; it would not make anything faster. If a screen still feels slow, time that screen.
- **Lock and regenerate for AI writing.** Done for marketing captions (above). Per field, a hand edit locks it, approval stays a separate step and nothing posts automatically. Version history beyond one Undo is not built.

## Verify

```powershell
node --test scripts/check-content-review.mjs scripts/check-publishability.mjs
```

Inbox: http://localhost:3000/marketing shows the Ryan note and, when the check-in is old, the 5-minute sentence. Review page: ad notes and photo notes are closed; a real warning still asks for a note. Do not click `RHI AI`.
