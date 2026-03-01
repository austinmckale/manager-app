export default function Loading() {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-16 rounded bg-slate-200" />
            <div className="mt-3 rounded-xl border border-slate-100 p-3 space-y-2">
                <div className="h-3 w-28 rounded bg-slate-100" />
                <div className="grid gap-2 sm:grid-cols-2">
                    <div className="h-8 rounded-xl bg-slate-100" />
                    <div className="h-8 rounded-xl bg-slate-100" />
                </div>
                <div className="h-9 w-full rounded-xl bg-slate-200" />
            </div>
            <div className="mt-3 space-y-2">
                {[1, 2].map((i) => (
                    <div key={i} className="rounded-xl border border-slate-100 p-3 space-y-1.5">
                        <div className="h-3.5 w-32 rounded bg-slate-100" />
                        <div className="h-3 w-20 rounded bg-slate-100" />
                    </div>
                ))}
            </div>
        </section>
    );
}
