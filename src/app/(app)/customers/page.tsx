import Link from "next/link";
import { createCustomerAction } from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getCustomers } from "@/lib/data";

export default async function CustomersPage() {
  const auth = await requireAuth();
  const customers = await getCustomers(auth.orgId);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Add Customer</h2>
        <form action={createCustomerAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="name" required placeholder="Name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="leadSource" placeholder="Lead source" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="address" placeholder="Address" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <textarea name="notes" placeholder="Notes" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" rows={2} />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white sm:col-span-2">
            Save Customer
          </button>
        </form>
      </section>

      <section className="space-y-2">
        {customers.map((customer) => (
          <article key={customer.id} className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-semibold text-slate-900">{customer.name}</p>
                <p className="text-sm text-slate-600">{customer.phone || "No phone"}</p>
                <p className="text-sm text-slate-600">{customer.email || "No email"}</p>
              </div>
              <Link
                href={`/customers/${customer.id}`}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700"
              >
                Client hub
              </Link>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Link
                href={`/jobs?customerId=${customer.id}#new-job`}
                className="rounded-lg border border-teal-300 px-2.5 py-1 text-xs font-medium text-teal-700"
              >
                New job for this customer
              </Link>
              <Link
                href={`/jobs?q=${encodeURIComponent(customer.name)}`}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700"
              >
                View jobs
              </Link>
            </div>
          </article>
        ))}
        {customers.length === 0 ? <p className="text-sm text-slate-500">No customers yet.</p> : null}
      </section>
    </div>
  );
}
