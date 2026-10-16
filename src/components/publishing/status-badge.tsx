export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "CONNECTED"
      ? "bg-teal-50 text-teal-800"
      : status === "EXPIRED" || status === "ERROR"
        ? "bg-rose-50 text-rose-800"
        : status === "PENDING_PLATFORM_APPROVAL"
          ? "bg-amber-50 text-amber-900"
          : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}
