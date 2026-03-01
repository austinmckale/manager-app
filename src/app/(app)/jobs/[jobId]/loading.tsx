export default function Loading() {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 animate-pulse">
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-100 p-3 space-y-2">
                    <div className="h-3 w-32 rounded bg-slate-100" />
                    <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="h-6 w-16 rounded-full bg-slate-100" />
                        ))}
                    </div>
                    <div className="h-3 w-20 rounded bg-slate-100" />
                    <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-7 w-14 rounded-lg bg-slate-100" />
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <div className="h-7 w-28 rounded-lg bg-slate-100" />
                        <div className="h-7 w-16 rounded-lg bg-slate-100" />
                        <div className="h-7 w-16 rounded-lg bg-slate-100" />
                    </div>
                    <div className="h-9 w-full rounded-xl bg-slate-200" />
                </div>
                <div className="space-y-1.5">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-start justify-between rounded-lg border border-slate-100 px-3 py-2">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                    <div className="h-3.5 w-24 rounded bg-slate-100" />
                                    <div className="h-4 w-14 rounded-full bg-slate-100" />
                                </div>
                                <div className="h-3 w-28 rounded bg-slate-100" />
                                <div className="h-2.5 w-20 rounded bg-slate-50" />
                            </div>
                            <div className="flex gap-1">
                                <div className="h-4 w-8 rounded bg-slate-50" />
                                <div className="h-4 w-4 rounded bg-slate-50" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
