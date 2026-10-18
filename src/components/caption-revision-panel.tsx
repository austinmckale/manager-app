"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  draftId: string;
  inputHash: string;
  disabled: boolean;
  demo?: boolean;
  onApply: (social: string, googleBusiness: string) => void;
  onPreview?: (next: { social: string; googleBusiness: string } | null) => void;
};

type Proposal = {
  status: "pending" | "ready" | "error" | "queued" | "running" | "failed" | "stale";
  inputHash: string;
  social: string;
  googleBusiness: string;
  approved?: boolean;
  published?: boolean;
  error?: string | null;
  instruction?: string;
};

type RevisionTurn = {
  instruction: string;
  status: string;
  at?: string;
  error?: string;
};

type RevisionBody = {
  proposal?: Proposal | null;
  ready?: Proposal | null;
  turns?: unknown;
};

const QUICK_REVISIONS = [
  { label: "Shorter", instruction: "Make the public captions shorter. Keep every fact." },
  { label: "More direct", instruction: "Make the tone plain and direct. Keep every fact." },
  { label: "Another option", instruction: "Write another short option with the same facts." },
] as const;

const STILL_WRITING_STATUS =
  "Still writing on this PC. This page will show the suggestion when it finishes.";
const STOPPED_WATCHING_STATUS =
  "Still running on this PC. Open this draft again later for the suggestion.";

function isRevisionTurn(value: unknown): value is RevisionTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as { instruction?: unknown; status?: unknown; at?: unknown; error?: unknown };
  return (
    typeof turn.instruction === "string" &&
    typeof turn.status === "string" &&
    (turn.at === undefined || typeof turn.at === "string") &&
    (turn.error === undefined || typeof turn.error === "string")
  );
}

function collapsedTurns(value: unknown): RevisionTurn[] {
  if (!Array.isArray(value)) return [];
  const turns = value.filter(isRevisionTurn);
  const ordered =
    turns.length > 0 && turns.every((turn) => Number.isFinite(Date.parse(turn.at ?? "")))
      ? [...turns].sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))
      : turns;
  const latest = new Map<string, RevisionTurn>();
  for (const turn of ordered) latest.set(turn.instruction, turn);
  return [...latest.values()].reverse().slice(0, 4);
}

function readyKey(proposal: Proposal) {
  return `${proposal.instruction ?? ""}:${proposal.social}:${proposal.googleBusiness}`;
}

function usableReady(proposal: Proposal | null | undefined, hash: string) {
  return Boolean(
    proposal &&
      proposal.status === "ready" &&
      proposal.inputHash === hash &&
      !proposal.approved &&
      !proposal.published &&
      (proposal.social.trim() || proposal.googleBusiness.trim()),
  );
}

export function CaptionRevisionPanel({
  draftId,
  inputHash,
  disabled,
  demo,
  onApply,
  onPreview,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState<Proposal | null>(null);
  const [, setTurns] = useState<RevisionTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchToken = useRef(0);
  const announcedRef = useRef(false);
  const dismissedRef = useRef<string | null>(null);

  useEffect(() => {
    onPreview?.(
      usableReady(ready, inputHash)
        ? { social: ready!.social, googleBusiness: ready!.googleBusiness }
        : null,
    );
  }, [ready, inputHash, onPreview]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function rememberReady(proposal: Proposal) {
    const key = readyKey(proposal);
    if (dismissedRef.current === key) return;
    setReady((current) => (current && readyKey(current) === key ? current : proposal));
  }

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function notifyReady() {
    if (announcedRef.current) return;
    announcedRef.current = true;
    const previous = document.title;
    document.title = "Suggestion ready · RHI Pros";
    window.setTimeout(() => {
      if (document.title === "Suggestion ready · RHI Pros") document.title = previous;
    }, 20000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification("A description suggestion is ready", {
        body: "It is on the review cards. Nothing is posted.",
      });
    }
  }

  function applyBody(body: RevisionBody, hash: string, announce: boolean) {
    if (Array.isArray(body.turns)) setTurns(collapsedTurns(body.turns));
    if (body.ready && usableReady(body.ready, hash)) rememberReady(body.ready);
    const active = body.proposal;
    if (!active) return "idle" as const;
    if (active.status === "queued") {
      setStatus("Writing the descriptions on this PC.");
      return "wait" as const;
    }
    if (active.status === "running") {
      setStatus("Rewriting the descriptions now.");
      return "wait" as const;
    }
    if (active.status === "ready") {
      if (!usableReady(active, hash)) {
        setStatus(
          active.approved || active.published
            ? "This draft is already approved or published. The suggestion cannot be applied."
            : "The version changed. This suggestion does not match.",
        );
        return "done" as const;
      }
      rememberReady(active);
      setStatus("");
      if (announce) notifyReady();
      return "done" as const;
    }
    if (active.status === "error" || active.status === "failed" || active.status === "stale") {
      setStatus(
        active.error ||
          (active.status === "stale"
            ? "The version changed. Reload before asking again."
            : "The rewrite failed."),
      );
      return "done" as const;
    }
    return "wait" as const;
  }

  async function loadRevision(hash: string): Promise<RevisionBody | null> {
    const res = await fetch(
      `/api/marketing/revise?draftId=${encodeURIComponent(draftId)}&inputHash=${encodeURIComponent(hash)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as RevisionBody;
  }

  function startWatch(hash: string) {
    clearPoll();
    const token = ++watchToken.current;
    const started = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const body = await loadRevision(hash);
        if (token !== watchToken.current || !body) return;
        const result = applyBody(body, hash, true);
        if (token !== watchToken.current) return;
        if (result === "done") {
          clearPoll();
          setBusy(false);
          return;
        }
        if (result === "wait" && Date.now() - started > 600_000) {
          setStatus(STILL_WRITING_STATUS);
        }
      } catch {
        /* network hiccup — keep polling */
      }
    }, 2000);
  }

  function stopWatching() {
    watchToken.current += 1;
    clearPoll();
    setBusy(false);
    setStatus(STOPPED_WATCHING_STATUS);
  }

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void (async () => {
      try {
        const body = await loadRevision(inputHash);
        if (cancelled || !body) return;
        if (applyBody(body, inputHash, false) === "wait") {
          setBusy(true);
          startWatch(inputHash);
        }
      } catch {
        /* the page still shows the saved captions */
      }
    })();
    return () => {
      cancelled = true;
      clearPoll();
    };
    // loadRevision and applyBody close over the current draft. Restart only when the version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, inputHash, demo]);

  async function submit(requestedInstruction: string) {
    const nextInstruction = requestedInstruction.trim();
    if (demo || disabled || !nextInstruction) return;
    setBusy(true);
    announcedRef.current = false;
    setStatus("Sending the request…");
    clearPoll();

    try {
      const response = await fetch("/api/marketing/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, inputHash, instruction: nextInstruction }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const error =
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Could not submit the revision request.";
        throw new Error(error);
      }
    } catch (error) {
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        setStatus("The request timed out. Try again.");
      } else {
        setStatus(error instanceof Error ? error.message : "Could not submit the revision request.");
      }
      setBusy(false);
      return;
    }

    setInstruction("");
    setStatus("Writing the descriptions on this PC. The cards keep the last suggestion until this one is ready.");
    startWatch(inputHash);
  }

  function applyProposal() {
    if (!usableReady(ready, inputHash) || disabled || demo || !ready) return;
    dismissedRef.current = readyKey(ready);
    onApply(ready.social, ready.googleBusiness);
    setReady(null);
    setStatus("Applied. Save this version before checks or approval. Nothing is posted.");
  }

  function keepCurrent() {
    if (ready) dismissedRef.current = readyKey(ready);
    setReady(null);
    setStatus("Keeping the saved descriptions.");
    onPreview?.(null);
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="font-semibold">AI assist</h3>

      {demo ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Preview only. Descriptions are not rewritten here.
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-medium">
            What should change?
            <textarea
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
              maxLength={400}
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={demo}
            />
            <span className="text-xs font-normal text-slate-500">{instruction.length}/400</span>
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            {QUICK_REVISIONS.map((revision) => (
              <button
                key={revision.label}
                type="button"
                disabled={disabled || busy}
                onClick={() => void submit(revision.instruction)}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 disabled:opacity-40"
              >
                {revision.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={disabled || busy || !instruction.trim()}
            onClick={() => void submit(instruction)}
            className="mt-3 min-h-11 rounded-xl bg-teal-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Writing…" : "Edit descriptions"}
          </button>

          {status ? (
            <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-slate-900">
              {status}
            </p>
          ) : null}

          {status === STILL_WRITING_STATUS ? (
            <button
              type="button"
              onClick={stopWatching}
              className="mt-3 min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900"
            >
              Stop watching
            </button>
          ) : null}

          {usableReady(ready, inputHash) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyProposal}
                disabled={disabled || demo}
                className="min-h-11 rounded-xl bg-teal-900 px-4 py-3 text-sm font-semibold text-white"
              >
                Apply suggestion
              </button>
              <button
                type="button"
                onClick={keepCurrent}
                disabled={disabled || demo}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900"
              >
                Keep saved text
              </button>
            </div>
          ) : null}

        </>
      )}
    </section>
  );
}
