import { cn } from "@/lib/utils";

export function CostHealth({ value, label }: { value: number; label: string }) {
  const tone = value <= 80 ? "bg-emerald-500" : value <= 100 ? "bg-amber-500" : "bg-rose-600";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span>{label}</span>
        <span>{value.toFixed(0)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full", tone)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}
