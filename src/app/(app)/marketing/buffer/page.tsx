import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { bufferSelectionId, discoverBufferChannels, type BufferChannel } from "@/lib/publishing/buffer";
import { BufferChannelSetup } from "@/components/buffer-channel-setup";
import { BufferDraftTest, BufferHistory } from "@/components/buffer-delivery";
import { bufferDeliveries } from "@/lib/publishing/buffer-store";

export const dynamic = "force-dynamic";
export default async function BufferSetup({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const auth = await requireAuth();
  const demo = isDemoMode();
  if (!demo && !isDashboardOwnerEmail(auth.email)) return <p>Owner access is required to set up Buffer.</p>;
  const params = await searchParams;
  const ready = Boolean(process.env.BUFFER_API_KEY);
  let channels: BufferChannel[] | null = null;
  let error = "";
  if (params.check === "1" && ready && !demo) {
    try { channels = await discoverBufferChannels(process.env.BUFFER_API_KEY!); }
    catch { error = "The connection check did not complete. Confirm that the key is active, has channel-reading permission, and belongs to your Buffer account."; }
  }
  const saved = !demo ? await prisma.activityLog.findFirst({ where: { id: bufferSelectionId(auth.orgId), orgId: auth.orgId } }) : null;
  const savedChannels = (saved?.metadata as { channels?: { id: string }[] } | null)?.channels || [];
  return <div className="space-y-5"><header><Link href="/marketing" className="text-sm text-teal-700 underline">← Marketing</Link><h1 className="mt-3 text-2xl font-semibold">Connect your existing Buffer account</h1><p className="mt-2 text-slate-600">Your social accounts stay connected in Buffer. This connects your RHI app to those accounts; it does not install more software.</p></header>
    <section className="rounded-2xl border p-5"><h2 className="font-semibold">Where your Buffer API key goes</h2><ol className="mt-3 list-decimal space-y-3 pl-5 text-sm"><li>Copy your key from <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noreferrer" className="underline">Buffer API settings</a>.</li><li>Open <a href="https://vercel.com/austinmckales-projects/manager-app/settings/environment-variables" target="_blank" rel="noreferrer" className="underline">RHI app private server settings</a>. Add <strong>BUFFER_API_KEY</strong>, choose <strong>Secret</strong> and <strong>Production</strong>, then paste the key as its value and save.</li><li>Redeploy the app when Vercel prompts, then return here and check the connection.</li></ol><p className="mt-3 text-sm text-slate-600">The key is a private server setting. It is never shown on a public website page or included in downloaded marketing packs.</p><p className="mt-4 font-medium">Key: {ready ? "Present on this deployment; verify below" : "Not configured on this deployment"}</p>{ready && !demo ? <Link href="/marketing/buffer?check=1" className="mt-3 inline-block rounded-xl bg-teal-700 px-4 py-3 text-white">Check connection & find channels</Link> : null}</section>
    {error ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">{error}</p> : null}
    {channels?.length ? <BufferChannelSetup channels={channels} selectedIds={savedChannels.map((channel) => channel.id)} /> : channels ? <p>No Facebook, Instagram or Google Business channels were found. Check their connections and API permissions in Buffer.</p> : null}
    <section className="rounded-xl bg-slate-50 p-4 text-sm"><h2 className="font-semibold">How to send a post</h2><p className="mt-2">Open a <Link href="/marketing/saved" className="underline">saved draft</Link>, check the original evidence and approve the version, then choose Send to Buffer. Save it as a Buffer draft or add it to your Buffer queue. Queueing authorizes Buffer to publish using its schedule; saving a draft does not publish.</p></section>
    {ready && !demo && savedChannels.length ? <BufferDraftTest /> : null}
    {!demo ? <BufferHistory records={await bufferDeliveries(auth.orgId)} /> : null}
  </div>;
}
