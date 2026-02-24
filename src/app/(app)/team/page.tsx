import { JobStatus } from "@prisma/client";
import {
  createWorkerAction,
  saveJobAssignmentsAction,
  setWorkerActiveAction,
  updateWorkerAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getJobs, getOrgUsers } from "@/lib/data";
import { canManageOrg } from "@/lib/permissions";
import { toNumber } from "@/lib/utils";

const ongoingStatuses: JobStatus[] = [JobStatus.SCHEDULED, JobStatus.IN_PROGRESS, JobStatus.ON_HOLD];

export default async function TeamPage() {
  const auth = await requireAuth();
  const manage = canManageOrg(auth.role);

  const [users, allJobs] = await Promise.all([
    getOrgUsers(auth.orgId),
    getJobs({ orgId: auth.orgId, role: auth.role, userId: auth.userId, view: "all" }),
  ]);

  const ongoingJobs = allJobs.filter((job) => ongoingStatuses.includes(job.status));

  if (!manage) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        Team management is only available to owner/admin.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <h2 className="text-base font-semibold text-teal-900">Team Operations</h2>
        <p className="mt-1 text-sm text-teal-800">Add workers fast, then assign them to ongoing jobs with checkboxes.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4" id="add-worker-form">
        <h3 className="text-sm font-semibold text-slate-900">1) Add Worker</h3>
        <form action={createWorkerAction} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="fullName" required placeholder="Full name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="email" type="email" required placeholder="Email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="phone" placeholder="Phone" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select name="role" defaultValue="WORKER" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="WORKER">Worker</option>
            <option value="ADMIN">Admin</option>
          </select>
          <input name="hourlyRateDefault" type="number" step="0.01" placeholder="Hourly rate" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
          <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">+ Add Worker</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">2) Active Workers</h3>
        <div className="mt-3 space-y-2 text-sm">
          {users.map((worker) => (
            <article key={worker.id} className="rounded-xl border border-slate-200 p-2">
              <form action={updateWorkerAction} className="grid gap-2 sm:grid-cols-5">
                <input type="hidden" name="workerId" value={worker.id} />
                <input name="fullName" defaultValue={worker.fullName} className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-2" />
                <input name="phone" defaultValue={worker.phone ?? ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <select name="role" defaultValue={worker.role} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  <option value="WORKER">Worker</option>
                  <option value="ADMIN">Admin</option>
                  <option value="OWNER">Owner</option>
                </select>
                <input name="hourlyRateDefault" type="number" step="0.01" defaultValue={toNumber(worker.hourlyRateDefault) || ""} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs sm:col-span-2">Save</button>
              </form>

              <form action={setWorkerActiveAction} className="mt-2">
                <input type="hidden" name="workerId" value={worker.id} />
                <input type="hidden" name="isActive" value={worker.isActive ? "false" : "true"} />
                <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                  {worker.isActive ? "Deactivate" : "Activate"}
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">3) Assign Crew To Ongoing Jobs</h3>
        <p className="mt-1 text-xs text-slate-500">Each job has its own checklist. Save one job at a time.</p>
        <div className="mt-3 space-y-3">
          {ongoingJobs.map((job) => {
            const assigned = new Set(job.assignments.map((assignment) => assignment.userId));
            return (
              <form key={job.id} action={saveJobAssignmentsAction} className="rounded-xl border border-slate-200 p-3 text-sm">
                <input type="hidden" name="jobId" value={job.id} />
                <p className="font-semibold text-slate-900">{job.jobName}</p>
                <p className="text-xs text-slate-500">{job.address}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {users
                    .filter((user) => user.isActive)
                    .map((user) => (
                      <label key={user.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                        <input type="checkbox" name="workerIds" value={user.id} defaultChecked={assigned.has(user.id)} />
                        {user.fullName}
                      </label>
                    ))}
                </div>
                <button type="submit" className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-xs">Save Assignments</button>
              </form>
            );
          })}
          {ongoingJobs.length === 0 ? <p className="text-sm text-slate-500">No ongoing jobs to assign.</p> : null}
        </div>
      </section>
    </div>
  );
}
