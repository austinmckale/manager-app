export default function Loading() {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-16 rounded bg-slate-200" />
            <div className="mt-3 space-y-2">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                        <div className="h-4 w-4 rounded bg-slate-100" />
                        <div className="h-3.5 w-40 rounded bg-slate-100" />
                    </div>
                ))}
            </div>
            <div className="mt-4 rounded-xl border border-slate-100 p-3 space-y-2">
                <div className="h-3 w-20 rounded bg-slate-100" />
                <div className="h-8 w-full rounded-xl bg-slate-100" />
                <div className="h-9 w-full rounded-xl bg-slate-200" />
            </div>
        </section>
    );
}
