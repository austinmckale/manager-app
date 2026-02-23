import { postPortalMessageAction } from "@/app/(app)/actions";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getStoragePublicUrl } from "@/lib/utils";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (isDemoMode()) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Client Portal (Demo)</h1>
        <p className="text-sm text-slate-600">Token: {token}</p>
      </main>
    );
  }

  const link = await prisma.portalLink.findUnique({
    where: { token },
    include: {
      customer: true,
      job: {
        include: {
          estimates: true,
          invoices: true,
          fileAssets: {
            where: { isClientVisible: true, type: "PHOTO" },
            orderBy: { takenAt: "asc" },
          },
        },
      },
    },
  });

  if (!link) {
    return <main className="p-6 text-sm">Invalid or expired portal link.</main>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h1 className="text-2xl font-semibold">{link.job.jobName}</h1>
        <p className="text-sm text-slate-600">Welcome, {link.customer.name}</p>
        <p className="text-sm text-slate-600">Address: {link.job.address}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Documents</h2>
        <div className="mt-2 space-y-1 text-sm">
          {link.job.estimates.map((estimate) => (
            <a key={estimate.id} className="block text-teal-700 underline" href={`/api/pdf/estimate/${estimate.id}`}>Estimate PDF ({estimate.status})</a>
          ))}
          {link.job.invoices.map((invoice) => (
            <a key={invoice.id} className="block text-teal-700 underline" href={`/api/pdf/invoice/${invoice.id}`}>Invoice PDF ({invoice.status})</a>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Shared Photos</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {link.job.fileAssets.map((asset) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={asset.id} src={getStoragePublicUrl(asset.storageKey)} alt={asset.description ?? "Job photo"} className="aspect-square w-full rounded-xl object-cover" />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold">Message Contractor</h2>
        <form action={postPortalMessageAction} className="mt-3 grid gap-2">
          <input type="hidden" name="token" value={token} />
          <input name="senderName" required placeholder="Your name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="senderEmail" type="email" placeholder="Your email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="message" required rows={3} placeholder="Message" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white">Send</button>
        </form>
      </section>
    </main>
  );
}
