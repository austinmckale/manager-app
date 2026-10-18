"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function IntakeLinkManager({ links, demo, portalActive = false }: { links: { id: string; path: string; expiresAt: string; revoked: boolean }[]; demo: boolean; portalActive?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  async function change(body: object) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/marketing/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not update upload links. Sign in again and retry.");
      if (data.url) { setCreatedUrl(data.url); setMessage("Upload link ready. Copy it and send it to Ryan."); }
      else if (data.portalRevoked) setMessage("Google portal access is revoked. Existing shared links keep their own expiry.");
      else setMessage("Link disabled. It can no longer receive photos.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please retry."); } finally { setBusy(false); }
  }
  async function copy(path: string) {
    try { await navigator.clipboard.writeText(new URL(path, window.location.origin).toString()); setMessage("Copied. Send this private upload link to Ryan."); } catch { setMessage("Open the upload link and copy its address from your browser."); }
  }
  const active = links.find((link) => !link.revoked);
  function requestText() {
    const upload = active ? new URL(active.path, window.location.origin).toString() : "";
    return ["Hey Ryan — can you send photos from recent jobs in RHI Pros?", "Open https://app.rhipros.com and continue with Google. Add the photos, a short note, and a voice note about what the job was.", upload ? `Or use this private upload link: ${upload}` : ""].filter(Boolean).join("\n\n");
  }
  async function copyRequest() {
    const text = requestText();
    try { await navigator.clipboard.writeText(text); setMessage("Request copied. Paste it into a text to Ryan. The app did not send it."); } catch { setMessage(text); }
  }
  async function shareRequest() {
    const text = requestText();
    if (!navigator.share) { await copyRequest(); return; }
    try { await navigator.share({ text }); setMessage("Share sheet opened. The app did not send the message."); } catch (error) { if (error instanceof Error && error.name === "AbortError") return; setMessage("Request not shared. You can copy it instead."); }
  }
  return <div className="space-y-4">
    {demo ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This is the local preview. Create the shareable link in the live app after deployment. <Link className="underline" href="/send-photos/preview">Try Ryan’s upload screen</Link>.</p> : null}
    <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-semibold">Ask Ryan for recent jobs</h3><p className="mt-1 text-sm text-slate-600">Copies a message asking for photos, a note, and a voice note from recent work. {active ? "It includes the current upload link." : "Create an upload link first if you want that address in the message. The Google sign-in is included either way."} Nothing is texted or emailed from here.</p><div className="mt-3 flex flex-wrap gap-2"><button className="rounded-xl bg-[#b4411b] px-4 py-3 text-sm font-semibold text-white" onClick={() => void copyRequest()}>Copy request</button><button className="rounded-xl border border-slate-300 px-4 py-3 text-sm" onClick={() => void shareRequest()}>Share request</button></div></section>
    <button disabled={demo || busy} className="rounded-xl bg-[#b4411b] px-4 py-3 font-semibold text-white disabled:opacity-40" onClick={() => void change({ action: "create" })}>Create Ryan’s upload link</button>
    {portalActive ? <button disabled={demo || busy} className="rounded-xl border border-slate-300 px-4 py-3 text-sm" onClick={() => void change({ action: "revokePortal" })}>Revoke Google portal access</button> : null}
    {createdUrl ? <div className="rounded-xl border border-teal-200 bg-teal-50 p-3"><label className="block text-sm font-medium">Private upload link<input readOnly value={createdUrl} onFocus={(e) => e.target.select()} className="mt-2 w-full rounded-lg border border-teal-200 bg-white p-2 text-sm" /></label><button className="mt-2 rounded-lg bg-teal-700 px-3 py-2 text-sm text-white" onClick={() => void copy(createdUrl)}>Copy link</button></div> : null}
    <p role="status" aria-live="polite" className="text-sm text-teal-900">{busy ? "Working…" : message}</p>
    {links.map((link) => <div key={link.id} className="rounded-xl border border-slate-200 p-4"><p className="text-sm font-medium">Ryan’s photo upload</p><p className="mt-1 text-xs text-slate-500">{link.revoked ? "Disabled" : `Expires ${new Date(link.expiresAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })}`} · Upload only</p>{!link.revoked ? <div className="mt-3 flex flex-wrap gap-2"><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => void copy(link.path)}>Copy link</button><a href={link.path} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Open upload screen</a><button disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => void change({ action: "revoke", id: link.id })}>Disable link</button></div> : null}</div>)}
  </div>;
}
