import type { Role } from "@prisma/client";
import { canManageOrg } from "@/lib/permissions";

export function marketingAccessDenied(role: Role) {
  if (canManageOrg(role)) return null;
  return "Only an owner or admin can manage marketing connections.";
}
