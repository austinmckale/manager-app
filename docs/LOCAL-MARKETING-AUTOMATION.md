# Current operation — October 16, 2026

Ryan's live upload page supports camera/roll photos, a 90-second voice recording, keyboard dictation or optional text, plus My uploads with photos, original recording, transcript and progress. There is no crew-facing stage picker and no example finished-pack card. History is scoped to the active upload capability, not other jobs or invite holders. Upload links still expire after 30 days; renewal does not yet combine history from different links.

Production deployment: `dpl_BqiN74ZFcqzwnK1z32BtrT8otg3a`, https://app.rhipros.com. Release folder: `C:\Users\Alivia\Projects\Manager App\manager-app-intake-release-20261016-152445`. Cursor's unpublished publishing models/migrations remain excluded.

## Local processing

Installed Ollama 0.40.5 on this PC. Downloaded `qwen3.5:4b` (current default) and `qwen2.5vl:3b` (initial test). The RTX 3070 and 32GB RAM successfully ran the local vision/copy pipeline. Local calls go only to `http://127.0.0.1:11434/api/chat`. There is no paid model API fallback.

Local transcription uses faster-whisper 1.2.1, small.en, CPU int8. PyAV is pinned to 16.0.1 because version 19 removed an argument faster-whisper uses. Install requirements are in `scripts/requirements-local-ai.txt`; installed packages and downloaded speech models are under the isolated release's ignored `.vercel/local-ai/` directory. Python defaults to the Codex bundled runtime; override `INTAKE_PYTHON` if the installed runtime moves.

Worker command from the isolated release folder: `npx tsx scripts/intake-marketing-worker.ts run-local`. It reads `.env.intake-production-verified`, never prints secrets, retrieves private recordings/photos, transcribes queued audio, waits for 15 minutes without another photo receipt before preparing a batch, classifies phases, validates copy, saves a version in the owner's library, and creates a stable 10–42-hour delivery time measured from the last photo receipt. Inference is local. The model's confidence is an estimate: stages below 0.85 or UNKNOWN remain unassigned. Existing human stages and published photos are not overwritten; model-applied stages carry `analysis:local-ai`. Website publishing still needs the owner's explicit clearance.

Heartbeat `prepare-ryan-s-uploads-locally` is ACTIVE every 15 minutes in this chat. It invokes the local worker and only notifies on a new processed submission or an actionable failure. The desktop assistant uses the existing subscription for orchestration; content inference uses the downloaded models. The PC, Ollama and desktop app must remain running. No Windows scheduled task or always-on external worker was installed. Expect roughly 15–30 minutes before a new settled photo batch is picked up; inference takes additional time.

## Delivery and remaining work

Recipients requested by the user: `rhisolutions316@gmail.com` and `austinmck17@gmail.com`. Gmail connector identity was verified as Austin. Website SMTP code exists but production SMTP credentials are absent; Manager App has no email or SMS transport configured. Inbox search showed prior Twilio access, not a verified working SMS integration. No phone number was supplied. No SMS setup is claimed.

Email sending is disabled unless `INTAKE_EMAIL_SENDING=enabled` is explicitly configured. Do not enable it yet. The current user direction is to finalize content internally, email the finished options, let Ryan choose, then perform authorized publishing and reporting. The finalize/choice workflow and automatic publishing/analytics integrations are not implemented in this release. The active heartbeat explicitly does not send email/SMS, post, or start ads. The delivery queue UI is a draft/status view; its recipient/status text must not be mistaken for working notifications. Test packs are excluded from client availability and notifications.

Public finished packs have selected photos, copy buttons, graphics export and platform links; opening those links does not create a post. Owner `/marketing/saved` preserves inputs for reuse. Owner `/marketing/delivery` shows queued packs. Current generation can be inspected there before connecting delivery. Pack quality still requires evaluation against real job submissions.

## Verification

37 isolated checks passed, focused ESLint and TypeScript passed, and the Vercel production build passed. Live, unauthenticated checks returned 200 for intake/history/detail/private photo/private audio, verified no example card/stage picker, and showed the correct local transcript. Invalid and early-release pack access is blocked. A synthetic 12.66-second spoken project description was uploaded with a real website sample photo; local Whisper transcribed it accurately and Qwen3.5 generated a saved pack. Local phase analysis classified the test photo AFTER and it stayed unpublished and not client-visible. Physical iPhone microphone recording/installation still needs Ryan's real device test.

Internal fixtures: submission `9079d648-b130-4ce9-94a1-1f91b84e2e85`, audio `a264501b-2d51-4fc5-83f2-a5dc594592f9`, photo `4f91585a-1b0b-4d17-9335-08e56f56077f`, pack `385be9e7-9215-4ab9-ae2a-8243be0c3fea`. Test uploads are explicitly labeled TEST. No real email, SMS, social post or ad was sent in validation.

## Free tools to consider

Buffer Free currently includes three channels, ten queued posts per channel and API access (one key, 3,000 requests/30 days). It could handle Facebook/Instagram/Google Business Profile account connections and organic scheduling. Paid ad campaigns remain a separate integration. Its current API FAQ says analytics expansion is forthcoming, so do not promise reporting API coverage from the landing-page feature summary alone.

n8n's self-hosted Community edition can orchestrate internal workflows under its Sustainable Use License; hosting and some commercial embedding scenarios are separate. Umami can be self-hosted for website analytics but does not independently provide ad-account spend or cross-platform attribution. These tools were researched, not installed or connected.
