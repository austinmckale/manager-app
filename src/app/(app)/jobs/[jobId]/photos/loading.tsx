export default function Loading() {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-16 rounded bg-slate-200" />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="aspect-square rounded-xl bg-slate-100" />
                ))}
            </div>
            <div className="mt-4 rounded-xl border border-slate-100 p-3 space-y-2">
                <div className="h-3 w-24 rounded bg-slate-100" />
                <div className="h-9 w-full rounded-xl bg-slate-200" />
            </div>
        </section>
    );
}
