"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  draftId: string;
  inputHash: string;
  disabled: boolean;
  demo?: boolean;
  onApply: (social: string, googleBusiness: string) => void;
};

type Proposal = {
  status: "pending" | "ready" | "error" | "queued" | "running" | "failed" | "stale";
  inputHash: string;
  social: string;
  googleBusiness: string;
  approved?: boolean;
  published?: boolean;
  error?: string;
};

type RevisionTurn = {
  instruction: string;
  status: string;
  at?: string;
};

const QUICK_REVISIONS = [
  {
    label: "Shorter",
    instruction: "Make the public captions shorter. Keep every fact.",
  },
  {
    label: "More direct",
    instruction: "Make the tone plain and direct. Keep every fact.",
  },
  {
    label: "Another option",
    instruction: "Write another short option with the same facts.",
  },
] as const;

function isRevisionTurn(value: unknown): value is RevisionTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as { instruction?: unknown; status?: unknown; at?: unknown };
  return (
    typeof turn.instruction === "string" &&
    typeof turn.status === "string" &&
    (turn.at === undefined || typeof turn.at === "string")
  );
}

function latestRevisionTurns(value: unknown): RevisionTurn[] {
  if (!Array.isArray(value)) return [];
  const turns = value.filter(isRevisionTurn);
  const times = turns.map((turn) => Date.parse(turn.at ?? ""));
  if (turns.length > 0 && times.every((time) => Number.isFinite(time))) {
    return [...turns]
      .sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""))
      .slice(-4);
  }
  return turns.slice(-4);
}

function turnStatusText(status: string) {
  if (status === "queued" || status === "pending") {
    return "Waiting to rewrite the descriptions.";
  }
  if (status === "running") return "Rewriting the descriptions.";
  if (status === "ready") return "Ready";
  if (status === "failed" || status === "error") return "Failed";
  if (status === "stale") return "The version changed.";
  if (status.toLowerCase() === "generating") return "Rewriting the descriptions.";
  return status;
}

export function CaptionRevisionPanel({
  draftId,
  inputHash,
  disabled,
  demo,
  onApply,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [turns, setTurns] = useState<RevisionTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revisionKeyRef = useRef(`${draftId}:${inputHash}`);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    const key = `${draftId}:${inputHash}`;
    if (revisionKeyRef.current === key) return;
    revisionKeyRef.current = key;
    setTurns([]);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      setBusy(false);
      setStatus("");
      setProposal(null);
    }
  }, [draftId, inputHash]);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function submit(requestedInstruction: string) {
    const nextInstruction = requestedInstruction.trim();
    if (demo || disabled || !nextInstruction) return;
    setBusy(true);
    setStatus("Sending the request…");
    setProposal(null);
    clearPoll();

    try {
      const response = await fetch("/api/marketing/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          inputHash,
          instruction: nextInstruction,
        }),
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
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        setStatus("The request timed out. Try again.");
      } else {
        setStatus(
          error instanceof Error
            ? error.message
            : "Could not submit the revision request."
        );
      }
      setBusy(false);
      return;
    }

    const deadline = Date.now() + 3 * 60 * 1000;
    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        clearPoll();
        setStatus("The rewrite did not finish in time.");
        setBusy(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/marketing/revise?draftId=${encodeURIComponent(draftId)}&inputHash=${encodeURIComponent(inputHash)}`
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          ok?: boolean;
          proposal?: Proposal | null;
          turns?: unknown;
        };
        if (Array.isArray(body.turns)) {
          setTurns(latestRevisionTurns(body.turns));
        }
        const data = body.proposal;
        if (!data) return;

        if (data.status === "queued") {
          setStatus("Waiting to rewrite the descriptions.");
        }

        if (data.status === "ready") {
          clearPoll();
          if (data.inputHash !== inputHash) {
            setStatus("The version changed. This proposal does not match.");
            setProposal(null);
          } else if (data.approved || data.published) {
            setStatus(
              "This draft is already approved or published. The proposal cannot be applied."
            );
            setProposal(null);
          } else {
            setStatus("Proposal ready");
            setProposal(data);
          }
          setBusy(false);
        } else if (data.status === "error" || data.status === "failed" || data.status === "stale") {
          clearPoll();
          setStatus(data.error || (data.status === "stale" ? "The version changed. Reload before asking again." : "The rewrite failed."));
          setBusy(false);
        }
      } catch {
        /* network hiccup — keep polling */
      }
    }, 4000);
  }

  function applyProposal() {
    if (
      !proposal ||
      disabled ||
      demo ||
      proposal.inputHash !== inputHash
    ) {
      return;
    }
    if (proposal.approved || proposal.published) {
      setStatus(
        "This draft is already approved or published. The proposal cannot be applied."
      );
      return;
    }
    onApply(proposal.social, proposal.googleBusiness);
    setProposal(null);
    setStatus("");
  }

  function keepCurrent() {
    setProposal(null);
    setStatus("");
  }

  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h3 className="font-semibold">AI assist</h3>
      <p className="mt-1 text-sm text-slate-600">
        Edit the Facebook and Google descriptions. Apply a suggestion, then
        save. Nothing is posted.
      </p>

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
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={disabled || busy}
            />
            <span className="text-xs font-normal text-slate-500">
              {instruction.length}/400
            </span>
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
            {busy ? "Working…" : "Edit descriptions"}
          </button>

          {status ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm font-medium text-slate-900"
            >
              {status}
            </p>
          ) : null}

          {proposal &&
          proposal.status === "ready" &&
          proposal.inputHash === inputHash ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold">
                  Proposed Facebook / Instagram post
                </h4>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {proposal.social}
                </p>
              </div>
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold">
                  Proposed Google Business update
                </h4>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {proposal.googleBusiness}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applyProposal}
                  disabled={disabled || demo}
                  className="min-h-11 rounded-xl bg-teal-900 px-4 py-3 text-sm font-semibold text-white"
                >
                  Apply proposal
                </button>
                <button
                  type="button"
                  onClick={keepCurrent}
                  disabled={disabled || demo}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900"
                >
                  Keep current
                </button>
              </div>
            </div>
          ) : null}

          {turns.length > 0 ? (
            <div className="mt-4">
              <h4 className="text-sm font-semibold">Earlier changes</h4>
              <ul className="mt-2 space-y-2">
                {turns.map((turn, index) => (
                  <li
                    key={`${turn.at ?? index}-${turn.status}-${turn.instruction}`}
                    className="rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <p className="text-sm text-slate-900">{turn.instruction}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {turnStatusText(turn.status)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
