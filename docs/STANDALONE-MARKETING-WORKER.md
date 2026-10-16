# Standalone local marketing worker

Installed October 16, 2026 on this PC using the isolated intake release:
`C:\Users\Alivia\Projects\Manager App\manager-app-intake-release-20261016-152445`.

Windows Task Scheduler task: **RHI Pros Local Marketing Worker**. Runs with the
current user's limited interactive token at sign-in. A five-minute watchdog starts
the task again if it exits; concurrent task instances are ignored. No password is
stored, no administrator rights or public network port are required. It runs
without Codex open, but the Windows account must remain signed in. Locking the
screen is fine; signing out, sleeping or powering off stops processing. The
installer does not change power settings or install a Windows service.

The hidden launcher starts the existing local Ollama server if unavailable, with
local-only networking and cloud disabled. No models are installed automatically.
The persistent worker checks once per minute and invokes the existing `run-local`
pipeline. Its original fifteen-minute batch settlement period remains. Errors
back off from one minute to fifteen minutes. Processing is sequential, with both
a service process lock and the existing intake pipeline lock.

The online upload receipts and private storage remain the durable work source.
If the PC is unavailable, uploads remain there. Completed transcription is saved
before content generation. Stable draft/pack IDs prevent duplicate completed
packs. The scanner currently considers the latest 2,000 receipts within 29 days;
this is not an unlimited-retention queue. A failing oldest audio item can hold up
later audio until corrected. Shared leases, dead-letter handling, second-PC
failover and a hosted worker-health dashboard are not implemented. **Do not install
this worker on a second PC against production yet:** file locks are local only.

## Check status

From the release directory:

```powershell
powershell -NoProfile -File scripts/marketing-worker-status.ps1
Get-ScheduledTask -TaskName 'RHI Pros Local Marketing Worker'
```

`.vercel/marketing-worker-service/status.json` records PID, state, check times,
consecutive failure count and a generic actionable issue. It never contains raw
worker output, source media, customer details, credentials or capability links.
An active processing pass may take up to an hour before its final status update.

For detailed failure diagnostics, pause the task, let active work finish and run
`npx tsx scripts/intake-marketing-worker.ts run-local` privately in the release
directory. Its output can contain private links; do not share raw output.

## Install or pause

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-marketing-worker.ps1
# Disable future starts, then stop the task when no processing pass is active:
Disable-ScheduledTask -TaskName 'RHI Pros Local Marketing Worker'
Stop-ScheduledTask -TaskName 'RHI Pros Local Marketing Worker'
# Resume:
Enable-ScheduledTask -TaskName 'RHI Pros Local Marketing Worker'
Start-ScheduledTask -TaskName 'RHI Pros Local Marketing Worker'
```

Requires installed Node, existing tsx dependencies, the ignored production env,
local Ollama with qwen3.5:4b, and the previously configured local Python/Whisper
packages and models. Python currently uses a bundled runtime path; set
`INTAKE_PYTHON` if moving it. A spare PC requires separate prerequisite setup.

The old Codex heartbeat `prepare-ryan-s-uploads-locally` is paused after a healthy
standalone run. Windows startup does not provide chat notifications. Review saved
drafts in https://app.rhipros.com/marketing/saved and delivery status in
https://app.rhipros.com/marketing/delivery.

Email is forced disabled in the worker child environment. No automatic SMS,
social publishing, ads, hosted AI fallback or extra review agents are enabled.
