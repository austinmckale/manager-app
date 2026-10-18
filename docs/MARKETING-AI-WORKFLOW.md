# Marketing AI: operation and setup

Open **Marketing → AI processing & submissions needing context** (`/marketing/delivery`). The worker runs independently of Codex as the Windows scheduled task **RHI Pros Local Marketing Worker**. Windows must be signed in and the PC awake. The website saves uploads while the PC is offline. Closing this chat does not stop an installed worker.

## First use

1. Choose **Hybrid**. Voice transcription runs locally; photos, notes, generation and claim checking use the OpenAI Responses API. The configurable initial model is `gpt-4.1-mini` (override with `MARKETING_OPENAI_MODEL`). Ollama mode stays entirely local. Manual mode does not generate automatically.
2. Add `OPENAI_API_KEY` to the installed worker folder's **private** `.env.marketing-ai.local` file. This separate file holds only AI configuration and loads before the main worker environment on each cycle. Do not paste keys into chat, public frontend configuration or a committed file. An API account with billing is separate from a ChatGPT subscription. The UI reports key presence, not billing/account validity; verify with a test.
3. Keep automatic processing **Off**, save settings, then click **Run one test cycle**. This consumes one pending submission, including test uploads. If none is pending, it checks a saved draft. On an individual saved draft, **Run AI checks** requests that exact version without enabling automatic generation. A held submission's correction form requests a test of that exact submission.
4. Inspect the evidence and generated copy. Then enable **Process new uploads automatically** and save if desired. Saving Off cancels an unclaimed test; a running request can finish. Settings are checked by the worker each cycle, normally about one minute apart when idle; in-progress work or failures can delay the next cycle.

The initial API limit is **60 calls per UTC day**, shared by generation, review and retries. Each image needs a separate inspection call. A successful new pack normally takes N+3 calls (N photo inspections, note extraction, writing and claim audit), plus any retry. Editing copy requires new checks. Calls are reserved atomically before sending; timeouts count because the provider may have processed them. Token usage is recorded when returned. This is a request cap, not a dollar guarantee. Configure provider billing alerts/limits too. Missing credentials, refusal, incomplete output, invalid JSON and unavailable models never count as passing checks.

## Evidence and approval

Every selected photo is inspected. Exact source quotes are retained separately from model summaries. Microphone tests and interface feedback provide no job facts. Irrelevant photos, conflicts, visible privacy issues, missing inspections and unsupported claims hold a submission with specific reasons. Choose **Company personality / team life** only when the owner explains that intent; a dog image alone never establishes construction work.

Sources are rechecked before saving a generated draft. The exact public fields must match the reviewed fields. Passed generation checks become a review of that immutable draft and source hash; they do not approve it. Owner approval remains separate. Editing text, changing evidence or replacing a version invalidates the applicable review. Older reviews require the new evidence policy before approval/publishing. The existing publishing service still checks exact owner approval.

## ChatGPT / Claude round trip

Open a saved draft's **Review & approve** page and expand **Ask ChatGPT or Claude instead**. Download the bundle and follow its START-HERE.txt: attach every photo, `review-prompt.txt` and `raw-input.json` to the chat. The bundle contains private notes and voice transcripts; inspect what you share. The prompt asks the chat to pick and order the photos (best first), improve the text in Ryan's own way of talking using only the evidence, and, if it can edit images (ChatGPT can, Claude cannot), return lightly improved copies named `edited-photo-<n>-<id>.jpg` with nothing added, removed or restyled.

**Import as unapproved edits** accepts the whole pasted reply: text around the JSON, a ```json block, smart quotes and trailing commas are fine (`extractReplyJson`). It never gets stuck on format. A missing field keeps the current text, a field over its limit keeps the current text, over-limit or repeated ad lines are dropped, and extra fields are ignored; the editor lists each of these. A reply for an earlier version of the same draft imports with a note. Only a reply that names a different draft and shares none of its photos is refused. Source notes, photo notes, the landing page, approval and photos that are not on the version are never taken from a reply, and the publication block still applies.

**Add edited photos** takes the images the chat returned. Each is matched to its original by the id or photo number in its file name, or by the owner's choice. The browser shrinks it to 2400px JPG; `/api/marketing/review/edited-photo` re-encodes it without metadata and stores a new photo tagged `chat-edit` and `edited-from:<original id>`, with `derivedFromAssetId` pointing at the root original so the notes and voice still load. The original is never changed. Saving accepts an edited copy only when the photo it replaces is on that version. Save an edited version and run AI checks before approval; the checks inspect the edited photos. Manual mode uses Ollama for explicitly requested checks; it does not start automatic generation.

## Local models and the fix loop

Local mode uses two models. `INTAKE_OLLAMA_MODEL` (default `qwen3.5:4b`) reads notes and photos, which are many short calls. `INTAKE_OLLAMA_WRITER_MODEL` (set to `qwen3.5:9b` in the worker's `.env.marketing-ai.local`) writes, fixes and fact-checks, which are a few calls where quality matters. Caption rewrites also use the writer. If the writer model is not downloaded, the reader writes instead (`src/lib/local-models.ts`). Measured on this RTX 3070 on October 18, 2026: both run 100% on the GPU at 8K context; the 9B writes about 32 tokens/s against 81 for the 4B and uses about 7.5 of 8 GB with the desktop running. A game holding GPU memory pushes the 9B partly onto the CPU, so turn local AI off with `RHI AI` before gaming; Off unloads both.

Writing is a loop (`scripts/local-write-loop.ts`). Local mode writes two versions at different temperatures and fact-checks each in a separate pass; Hybrid writes one to save paid calls. The version with fewer problems gets up to two fix rounds: the fact-check's findings go back to the writer, which must remove unsupported claims rather than reword them. A checker that skipped the exact text is asked again instead of triggering a rewrite. Only a draft that still has problems after the last round is held for the owner, with those problems listed. Passing the loop is still not owner approval.

Two reading rules keep good jobs from stalling before the writer runs. A concerns or conflicts entry that only says there is nothing wrong ("None", "No visible privacy concerns") is not a hold reason (`isNonConcern` in `src/lib/marketing-evidence.ts`). The "what is missing" pass only runs, and only holds, when the notes gave no usable facts; with facts present it invented demands such as permit approval and inspection reports. Measured October 18, 2026 on the Bethlehem staircase project photo and its published description: before these rules it was held with six such reasons; after, it read in 9 seconds on the 4B and passed one write and one fact-check on the 9B in about 165 seconds.

## Running and testing locally

Before pointing the scheduled task at a release folder, run `node --import tsx scripts/worker-preflight.ts` inside it. It loads every worker module, checks Ollama has the reader model and reports a missing writer, and makes one read-only database query. A release with a missing file fails there instead of failing every cycle in the background; the worker's status file now names that case too.

The installer `scripts/install-marketing-worker.ps1 -WorkerRoot <release-folder>` points the scheduled task at that release. It requires installed dependencies and the private worker environment file. `scripts/marketing-worker-status.ps1 -WorkerRoot <release-folder>` shows process status. The app uses a separate database heartbeat to show when this worker version last checked in. These paths must refer to the installed release, not an unrelated development checkout.

- `node --test scripts/check-marketing-evidence.mjs scripts/check-content-review.mjs scripts/check-generation-queue.mjs scripts/check-marketing.mjs scripts/check-worker-bugs.mjs`
- `node --import tsx --test scripts/check-write-loop.mjs`
- `npx tsc --noEmit --incremental false`
- `npx tsx scripts/evaluate-marketing-evidence.ts <private-source.json>` performs read-only local evaluation without database writes, paid calls or notifications. Treat actual model evaluations separately from mocked regression tests.

## Social delivery

Open /marketing/buffer. BUFFER_API_KEY is a private Vercel Production secret; redeploy after changing it. Check the connection, then save the intended channels.

On an approved version's Review & approve page, choose **Send to Buffer**. Review the exact channel text and choose its photos. Facebook/Instagram allow up to 10 selected photos; Google Business uses one. The default saves unpublished Buffer drafts. The optional **Add to Buffer queue** requires an explicit acknowledgement that Buffer may publish using its queue schedule. Buffer runs in the cloud; the PC does not need to stay on after queueing.

The server revalidates current owner approval, evidence hash, org/job photo ownership and currently available saved channels before sending. It rechecks approval after preparing media. Signed private media links last seven days for provider ingestion and are never returned in delivery history. A unique durable claim per org/version/channel blocks duplicate sends, including double clicks, partial failures, timeout retries and switching draft/queue. If a version already exists as a Buffer draft, schedule that existing post inside Buffer. Unknown or rejected attempts are not automatically resent; inspect Buffer and reconcile them manually.

Delivery history stores Buffer post IDs and distinguishes draft, queued, sending, failed and published. **Refresh status** reads Buffer directly; only sent posts with sentAt are labeled published. Queue acceptance is not proof of social publication. Refresh is manual; no background status polling or webhook is installed. Posting limits, expired social connections and Buffer queue pauses may prevent delivery and should be resolved in Buffer.

**Create private test drafts** uses only fixed test text and the public RHI brand image. It creates at most one test per channel and reads the post back, verifying draft status, text, channel and image. It never queues or publishes a test. Keep test drafts unpublished.

Buffer regression checks: node --test scripts/check-buffer-setup.mjs scripts/check-buffer-delivery.mjs

## Video scope

Video uploads with embedded voiceovers are not supported by the marketing evidence pipeline yet. They require audio extraction/transcription, timestamped frame inspection across the full clip, audio/visual claim comparison and review of the exact publishable clip. A passing photo workflow does not imply video support.
