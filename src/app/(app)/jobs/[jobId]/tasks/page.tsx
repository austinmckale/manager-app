import { TaskStatus } from "@prisma/client";
import { format } from "date-fns";
import {
    createTaskAction,
    updateTaskStatusAction,
} from "@/app/(app)/actions";
import { requireAuth } from "@/lib/auth";
import { getJobById, getOrgUsers } from "@/lib/data";

export default async function TasksPage({
    params,
}: {
    params: Promise<{ jobId: string }>;
}) {
    const auth = await requireAuth();
    const { jobId } = await params;
    const [job, users] = await Promise.all([
        getJobById({ orgId: auth.orgId, role: auth.role, userId: auth.userId, jobId }),
        getOrgUsers(auth.orgId),
    ]);
    const openTasks = job.tasks.filter((task) => task.status !== TaskStatus.DONE).length;

    return (
        <section id="tasks" className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Tasks / Punch List</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">Open: {openTasks}</span>
            </div>
            <form action={createTaskAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="jobId" value={job.id} />
                <input name="title" required placeholder="Task / punch item" className="rounded-xl border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
                <select name="assignedTo" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.fullName}</option>
                    ))}
                </select>
                <input name="dueDate" type="date" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <button type="submit" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white sm:col-span-2">Add Task</button>
            </form>

            <div className="mt-3 space-y-2">
                {job.tasks.map((task) => (
                    <article key={task.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                        <p className="font-semibold">{task.title}</p>
                        <p className="text-xs text-slate-500">{task.assignee?.fullName ?? "Unassigned"} - Due {task.dueDate ? format(task.dueDate, "MMM d, yyyy") : "-"}</p>
                        <form action={updateTaskStatusAction} className="mt-2 flex gap-2">
                            <input type="hidden" name="taskId" value={task.id} />
                            <select name="status" defaultValue={task.status} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                                {Object.values(TaskStatus).map((value) => (
                                    <option key={value} value={value}>{value}</option>
                                ))}
                            </select>
                            <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">Update</button>
                        </form>
                    </article>
                ))}
            </div>
        </section>
    );
}
