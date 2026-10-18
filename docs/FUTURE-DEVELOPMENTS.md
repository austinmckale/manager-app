# Future developments and progress

Last updated: October 18, 2026, evening Eastern. This is the handoff for the next model. Product boundaries stay in [MARKETING-VISION-AND-ROADMAP.md](MARKETING-VISION-AND-ROADMAP.md). This file says what is done, what this commit includes, and how to finish the rest without breaking the rules.

A code push is not a deployment. The live site is https://app.rhipros.com and follows GitHub `master` only after Vercel deploys. The installed worker folder is `C:\Users\Alivia\Projects\Manager App\manager-app-marketing-hybrid-20261017`, not this git tree. A website deploy does not update that folder. Do not restart worker PID 24820 unless a restart is required. Do not click the desktop shortcut `RHI AI` while working. It toggles the live scheduled task `RHI Pros Local Marketing Worker`.

## Do not do these unless the owner asks again

- Do not email or text Ryan. His addresses `rhisolutions316@gmail.com` and `ryanran321@gmail.com` are not destinations. Outbound email and SMS stay off. The only email address that may ever be used is `austinmck17@gmail.com`, and even that stays off until the owner chooses to send. The only SMS number is `6104514099`.
- Do not set `MARKETING_PUBLISH_MODE=live`. Do not create, queue, or publish a Buffer post unless the owner asks for that exact action. A private Buffer draft is a real object in Buffer.
- Do not switch the worker to `qwen3.5:9b`. This PC is an RTX 3070 8 GB. Stay on `qwen3.5:4b`. The 9B weights may already be downloaded. They are unused on purpose.
- Do not build ads spend controls, Search Console pulls, Joist, a second Ryan portal, or native Facebook as part of finishing the organic post. Buffer is the only organic posting path.
- Do not send Discord messages for agent status. Discord is for real upload and draft events.
- Do not apply production Prisma migrations. Do not print `.env` secrets. Do not commit `tmp/`.

## Progress already on GitHub

`97a8a99` and `47ce036` are on `origin/marketing/workspace` and `origin/master`.

- Desktop shortcut shows a Windows message box titled RHI local AI. Off refuses to disable the task when a status file says `processing`. It stops only `qwen3.5:4b` and `qwen2.5vl:3b`. Reading the installed worker folder's status file is included in this commit. Origin will have that script change after the push.
- Processing and review shows whether the stored worker check-in is older than 5 minutes. The website cannot see the GPU.
- Caption suggestions show in the AI assist panel, the Facebook and Google fields, and the preview. Save uses that visible text.
- The ChatGPT bundle downloads photos through `/api/marketing/review/media?draftId=&photoId=`. Import fills the text boxes, reorders existing photos, and can show a short "Improve:" note. The app cannot receive edited image files.
- The inbox shows the note to Ryan before the copy button. The button label is "Copy this note to text Ryan". Nothing is sent.

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
2. Confirm the installed worker folder is running the same generation and caption code as this git tree, or copy the needed scripts into that folder without restarting a healthy worker unless required. `INTAKE_OLLAMA_MODEL` stays unset or `qwen3.5:4b`.
3. On the worker PC, the owner clicks `RHI AI` only when they want local AI on for drafts or off for games. The message box is the proof. `ollama ps` with no rows means the models are not loaded. A stale website check-in does not prove that.
4. Ryan's own iPhone Google login at https://app.rhipros.com is still unproven. Do not build a second portal. One upload path until a confirmed post.
5. When the owner asks, create one private Buffer test draft from https://app.rhipros.com/marketing/buffer and look in https://publish.buffer.com under Drafts for "RHI Pros integration test". Do not queue it. Instagram was not in the saved channel list. Recheck channels before assuming Instagram is connected.
6. After a real approved send, the results page should show that Buffer row. It already lists stored rows. It does not yet import Buffer analytics. Do not invent metrics.

## Still not built

- One-shot rewrite does not auto-apply, auto-save, or auto-approve. "Rewrite the post" only queues the local model. If 4B cannot write a postable caption, the owner uses Ask ChatGPT or Claude.
- The checks wall is shorter, not gone. Privacy, empty Facebook or Google Business, bad landing hosts, and unsupported work claims stay blockers.
- Cloud heartbeat monitoring while the PC is off. Discord cannot wake a sleeping PC. Do not build a Discord on/off button.
- No token or GPU dashboard. Do not add one.
- P4 in the roadmap: one weekly results page with real Buffer outcomes, then read-only Google Ads, Meta ads, and Search Console. No spend token. A live campaign change is a later package with its own approval and a ceiling.
- Joist estimate learning and a second Ryan entry are later, after the single upload path posts once.
- Reviewed website placement and customer review requests are later. They do not block the first Buffer post.

## Verify

```powershell
node --test scripts/check-content-review.mjs scripts/check-publishability.mjs
```

Inbox: http://localhost:3000/marketing shows the Ryan note and, when the check-in is old, the 5-minute sentence. Review page: ad notes and photo notes are closed; a real warning still asks for a note. Do not click `RHI AI`.
