import { JobStatus } from "@prisma/client";
import { cn } from "@/lib/utils";

const statusStyles: Record<JobStatus, string> = {
  LEAD: "bg-slate-100 text-slate-700",
  ESTIMATE: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-violet-100 text-violet-700",
  IN_PROGRESS: "bg-amber-100 text-amber-700",
  ON_HOLD: "bg-rose-100 text-rose-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  PAID: "bg-teal-100 text-teal-700",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusStyles[status])}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
