import { Role, TimeEntry } from "@prisma/client";
import { isSameDay } from "date-fns";

export function canManageOrg(role: Role) {
  return role === Role.OWNER || role === Role.ADMIN;
}

export function canViewJob(role: Role, assigned: boolean) {
  if (role === Role.OWNER || role === Role.ADMIN) return true;
  return assigned;
}

export function canEditTimeEntry(params: {
  role: Role;
  actorUserId: string;
  entry: Pick<TimeEntry, "workerId" | "date">;
  workerCanEditOwnSameDay: boolean;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  if (params.role === Role.OWNER || params.role === Role.ADMIN) return true;
  if (params.role === Role.WORKER && params.entry.workerId === params.actorUserId) {
    return params.workerCanEditOwnSameDay ? isSameDay(params.entry.date, now) : false;
  }
  return false;
}
