"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FacebookPreview } from "@/components/post-previews/facebook-preview";
import { GoogleBusinessPreview } from "@/components/post-previews/google-business-preview";
import type { PreviewPhoto } from "@/components/post-previews/types";
import type { BufferChannel } from "@/lib/publishing/buffer";
import type { BufferDelivery } from "@/lib/publishing/buffer-delivery";

async function request(body: object): Promise<BufferDelivery[]> {
  const response = await fetch("/api/publishing/buffer/deliveries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(125000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Buffer request failed. Check delivery history before sending again.");
  return data.records;
}
const labels: Record<BufferDelivery["status"], string> = { preparing: "Preparing — do not resend", unknown: "Unconfirmed — check Buffer", rejected: "Not confirmed — review in Buffer", draft: "Draft in Buffer — not scheduled", queued: "Queued in Buffer — not yet published", sending: "Buffer is publishing", published: "Published", failed: "Publishing failed", needs_approval: "Awaiting approval in Buffer" };
const button = "rounded-xl border border-teal-700 px-4 py-3 text-sm disabled:opacity-40";
export function BufferHistory({ records }: { records: BufferDelivery[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <section className="rounded-2xl border p-4"><h2 className="font-semibold">Buffer delivery history</h2><p className="mt-2 text-sm text-slate-600">Refresh checks Buffer directly. Only a sent post with a publication time is marked Published. Changes made inside Buffer are managed there.</p>{!records.length ? <p className="mt-3 text-sm">No Buffer deliveries yet.</p> : records.map((record) => <article key={record.id} className="mt-4 rounded-xl border p-3 text-sm"><p className="font-semibold">{record.channelName} · {record.service}{!record.draftId ? " · Connection test" : ""}</p><p className="mt-2">{labels[record.status] || "Unconfirmed"}</p>{record.dueAt ? <p>Scheduled: {new Date(record.dueAt).toLocaleString()}</p> : null}{record.sentAt ? <p>Published: {new Date(record.sentAt).toLocaleString()}</p> : null}<p className="mt-2">{record.message}</p><p className="mt-2 text-xs text-slate-500">Last checked: {new Date(record.checkedAt).toLocaleString()}</p><div className="mt-3 flex flex-wrap gap-3">{record.postId ? <button disabled={busy} className={button} onClick={async () => { setBusy(true); setMessage(""); try { await request({ action: "refresh", id: record.id }); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Status unavailable."); } finally { setBusy(false); } }}>Refresh status</button> : null}<a className={button} href="https://publish.buffer.com" target="_blank" rel="noreferrer">Open Buffer</a>{record.externalLink && /^https:\/\//.test(record.externalLink) ? <a className={button} href={record.externalLink} target="_blank" rel="noreferrer">View social post</a> : null}</div></article>)}<p role="status" className="mt-3 text-sm">{message}</p></section>;
}
export function BufferDraftTest() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <section className="rounded-2xl border p-4"><h2 className="font-semibold">Test the connection without publishing</h2><p className="mt-2 text-sm">Creates clearly labeled test drafts in your saved Facebook and Google Business channels using the public RHI brand image, then reads them back. They contain no customer text or photos and are never added to the posting queue.</p><button disabled={busy} className={`${button} mt-4`} onClick={async () => { setBusy(true); setMessage(""); try { const records = await request({ action: "test" }); setMessage(records.map((record) => `${record.channelName}: ${record.message}`).join("\n")); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Test failed."); } finally { setBusy(false); } }}>{busy ? "Testing…" : "Create private test drafts"}</button><p role="status" className="mt-3 text-sm">{message}</p></section>;
}
type SendPhoto = { id: string; url: string; fileName: string; description?: string };
type SendProps = { draftId: string; inputHash: string; social: string; googleBusiness: string; approved: boolean; channels: BufferChannel[]; photos: SendPhoto[]; location?: string };
function selectedPreviewPhotos(photos: SendPhoto[], ids: string[], limit: number): PreviewPhoto[] {
  return photos.filter((photo) => ids.includes(photo.id) && photo.url.trim()).slice(0, limit).map((photo) => ({ id: photo.id, url: photo.url, description: photo.description ?? "" }));
}
function ChannelPreview({ service, social, googleBusiness, location, photos }: { service: string; social: string; googleBusiness: string; location: string; photos: PreviewPhoto[] }) {
  if (service === "facebook") return <FacebookPreview caption={social} photos={photos} />;
  if (service === "googlebusiness") return <GoogleBusinessPreview update={googleBusiness} location={location} photos={photos.slice(0, 1)} />;
  return <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{social}</p>;
}
export function BufferSend(props: SendProps) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [mode, setMode] = useState<"draft" | "queue">("draft");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const chosen = Object.entries(selections).filter(([, ids]) => ids.length);
  const location = props.location ?? "";
  return <section className="space-y-4 rounded-2xl border p-4"><h2 className="font-semibold">Choose channels and photos</h2>{!props.approved ? <p className="rounded-xl bg-amber-50 p-3 text-sm">Save changes, complete evidence checks and approve this exact version before sending.</p> : null}
    <p className="text-sm text-slate-600">This app sends the approved text and photos. Buffer posts them. A draft waits until you set a time in Buffer. The queue uses the next open slot on the schedule already set in Buffer.</p>
    {props.channels.map((channel) => { const ids = selections[channel.id] || []; const max = channel.service === "googlebusiness" ? 1 : 10; const photos = selectedPreviewPhotos(props.photos, ids, max); return <article key={channel.id} className="rounded-xl border p-3"><label className="flex items-center gap-3 font-medium"><input type="checkbox" disabled={busy || !props.approved || channel.isDisconnected || channel.isLocked} checked={!!ids.length} onChange={(e) => { setSelections((s) => ({ ...s, [channel.id]: e.target.checked ? props.photos.slice(0, max).map((p) => p.id) : [] })); setConfirmed(false); }} />{channel.displayName || channel.name} · {channel.service}</label>{channel.isQueuePaused ? <p className="mt-2 text-sm text-amber-800">Queue paused in Buffer. Drafts can be saved; resume the queue before scheduling.</p> : null}{channel.isDisconnected || channel.isLocked ? <p className="mt-2 text-sm text-amber-800">Reconnect or unlock this channel in Buffer.</p> : null}<div className="mt-3"><ChannelPreview service={channel.service} social={props.social} googleBusiness={props.googleBusiness} location={location} photos={photos} /></div>{!!ids.length ? <><p className="mt-3 text-sm">{ids.length}/{max} photos selected. {max === 1 ? "Choose the single Google Business photo." : "Photos are sent in the order shown."}</p><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{props.photos.map((photo) => <label key={photo.id} className="rounded-lg border p-2"><img src={photo.url} alt="Approved photo preview" className="aspect-square w-full rounded object-cover" /><input aria-label={`${channel.service}: ${photo.fileName}`} type="checkbox" disabled={busy || !props.approved || (!ids.includes(photo.id) && ids.length >= max && max > 1)} checked={ids.includes(photo.id)} onChange={(e) => { setSelections((s) => ({ ...s, [channel.id]: max === 1 ? [photo.id] : props.photos.filter((p) => e.target.checked ? [...ids, photo.id].includes(p.id) : ids.filter((id) => id !== photo.id).includes(p.id)).map((p) => p.id) })); setConfirmed(false); }} /></label>)}</div></> : null}</article>; })}
    {!props.channels.length ? <p className="text-sm">Save your channels on the Buffer setup page first.</p> : null}
    <label className="block text-sm font-medium">Delivery option<select className="mt-2 block w-full rounded-xl border p-3" value={mode} disabled={busy} onChange={(e) => { setMode(e.target.value as "draft" | "queue"); setConfirmed(false); }}><option value="draft">Save as Buffer drafts — I will schedule them in Buffer</option><option value="queue">Add to Buffer queue — publish using my Buffer schedule</option></select></label>
    {mode === "queue" ? <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />I checked the text, photos and channels above. Buffer may publish these at its next open slot. This app does not pick the clock time.</label> : <p className="text-sm text-slate-600">A draft does not post. Open it in Buffer and set the day and time. If this version was already sent, the app returns that delivery instead of creating another one.</p>}
    <button className={`${button} bg-teal-800 font-medium text-white`} disabled={busy || !props.approved || !chosen.length || (mode === "queue" && !confirmed)} onClick={async () => { setBusy(true); setMessage(""); try { const records = await request({ action: "send", draftId: props.draftId, inputHash: props.inputHash, mode, queueConfirmed: confirmed, selections: chosen.map(([channelId, assetIds]) => ({ channelId, assetIds })) }); setMessage(records.map((r) => `${r.channelName}: ${labels[r.status]}.${r.dueAt ? ` Buffer's time is ${new Date(r.dueAt).toLocaleString()}.` : r.sentAt ? ` Posted ${new Date(r.sentAt).toLocaleString()}.` : r.status === "queued" ? " Buffer will post it at the next open slot." : r.status === "draft" ? " Set the time in Buffer." : ""} ${r.message}`).join("\n")); router.refresh(); } catch (e) { setMessage(e instanceof Error ? e.message : "Delivery could not be confirmed. Check Buffer before resending."); router.refresh(); } finally { setBusy(false); } }}>{busy ? "Sending…" : mode === "draft" ? "Send approved version as Buffer drafts" : "Add approved version to Buffer queue"}</button><p role="status" className="whitespace-pre-wrap text-sm">{message}</p>
  </section>;
}
