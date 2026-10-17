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
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function clearPoll() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function submit() {
    if (demo || disabled || !instruction.trim()) return;
    setBusy(true);
    setStatus("Waiting for this PC…");
    setProposal(null);
    clearPoll();

    try {
      const response = await fetch("/api/marketing/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId, inputHash, instruction }),
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
        setStatus("The local model did not finish in time.");
        setBusy(false);
        return;
      }
      try {
        const res = await fetch(
          `/api/marketing/revise?draftId=${encodeURIComponent(draftId)}&inputHash=${encodeURIComponent(inputHash)}`
        );
        if (!res.ok) return;
        const body = (await res.json()) as { proposal?: Proposal | null };
        const data = body.proposal;
        if (!data) return;

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
          setStatus(data.error || (data.status === "stale" ? "The version changed. Reload before asking again." : "The local model returned an error."));
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
      <h3 className="font-semibold">Ask the local model</h3>
      <p className="mt-1 text-sm text-slate-600">
        This PC writes a proposal. Nothing is saved, approved, or posted until
        you apply it and use the existing Save and Approve buttons.
      </p>

      {demo ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Preview only. The local model is not asked.
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

          <button
            type="button"
            disabled={disabled || busy || !instruction.trim()}
            onClick={() => void submit()}
            className="mt-3 min-h-11 rounded-xl bg-teal-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Working…" : "Ask local model"}
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
        </>
      )}
    </section>
  );
}
