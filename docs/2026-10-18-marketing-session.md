# Marketing session handoff — October 18, 2026

This note is for the next agent. Product boundaries live in [MARKETING-VISION-AND-ROADMAP.md](MARKETING-VISION-AND-ROADMAP.md). That brief is the source for what the app is allowed to do. This file records what shipped on October 18, 2026, what was asked next, and what to leave alone.

A code push is not a deployment. The installed worker folder is `manager-app-marketing-hybrid-20261017`, not this git tree. The website cannot see the GPU.

## Shipped today (commit 97a8a99, pushed to origin/marketing/workspace and origin/master)

The desktop shortcut **RHI AI** runs `scripts/set-marketing-worker.ps1 -Action Toggle`. The PowerShell window is minimized, so the script now shows a Windows message box titled **RHI local AI**.

Off says local AI is off, the task is disabled, and models were asked to stop. It also reports the scheduled task state and whether `ollama ps` still lists a model. If a model is listed, it says that is not proof the GPU is free. Off refuses to disable the task when `.vercel/marketing-worker-service/status.json` state is `processing`. It only stops `qwen3.5:4b` and `qwen2.5vl:3b`. It does not start or select `qwen3.5:9b`. Leave the shortcut alone while work is in progress; it toggles the live worker.

Processing and review (`src/components/marketing-processing-controls.tsx`) shows a line when the stored worker check-in is older than 5 minutes: local AI may be off or the PC may be asleep. A fresh check-in says it was within 5 minutes. The website cannot see the GPU.

Caption suggestions (Shorter, More direct, Another option, Apply suggestion) now show the suggested Facebook and Google text in the AI assist panel, in those two text fields, and in the preview. Save and the ChatGPT bundle use that visible text. Nothing is posted until the owner approves and sends to Buffer.

Download ChatGPT / Claude review bundle fetches photos through the owner-only route `/api/marketing/review/media?draftId=&photoId=` instead of a cross-origin Supabase URL. The zip link is attached to the page before click. Unsaved edits no longer disable the download.

## What the inbox buttons mean

The inbox shows the note, then **Copy message for Ryan**. That copies the note so the owner can paste it into their own text. **Share from this phone** appears only when the device has a share sheet. Neither texts nor emails Ryan (`rhisolutions316@gmail.com` and `ryanran321@gmail.com` stay off-limits). This button change is local and not in `97a8a99`.

## Requested next, started after 97a8a99

- Clearer Ryan request buttons are in the inbox locally. See the section above.
- ChatGPT/Claude import fills every text box from the returned copy and reorders the selected photos from `photoIds`. Light improvement notes show under the kept photos as “Improve: …”. The app cannot receive edited image files. The bundle prompt says to improve the photos so they look beautiful, with light edits only. This is local and not in `97a8a99`.

## Still not built (do not start unless asked)

- One-shot rewrite that auto-approves or auto-posts. A passed AI check is not owner approval.
- Checks-wall collapse. A UI-only change to the 10-character warning rule is unsafe; the API in `src/app/api/marketing/review/route.ts` must match.
- Switching the installed worker to `qwen3.5:9b`. This PC is an RTX 3070 8 GB. Stay on `qwen3.5:4b`. The installed worker folder is `manager-app-marketing-hybrid-20261017`, not this git tree. Leave worker PID 24820 running unless a restart is required.
- Live Buffer posting. A private Buffer draft is a real object in Buffer. Run a private Buffer draft test only when the owner asks. Leave `MARKETING_PUBLISH_MODE` off `live`.
- Ads spend controls, Search Console pulls, Joist, a second Ryan portal, and native Facebook. Organic posting through Buffer is still the current milestone.
- Discord is for real upload and draft events, not agent status. Do not email or text Ryan.

## How to verify

- Shortcut: a message box appears. Do not click it as an agent.
- Processing and review: stale check-in sentence after 5 minutes.
- Review page: a ready suggestion changes the Facebook field and the preview; Save keeps that text.
- Ask ChatGPT or Claude: Download produces a zip with photos, `review-prompt.txt`, and `raw-input.json`.
