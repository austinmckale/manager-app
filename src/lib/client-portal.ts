import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { CLIENT_PORTAL_ACCESS, isClientPortalEmail } from "@/lib/client-portal-policy";
import { resolveUploadInvite, uploadInviteToken } from "@/lib/field-intake";
import { z } from "zod";

const accessSchema = z.object({ emails: z.array(z.string().email()), inviteId: z.string().uuid() });
export const clientPortalUser = cache(async () => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email || !data.user.email_confirmed_at || !isClientPortalEmail(data.user.email)) return null;
  return { email: data.user.email.trim().toLowerCase(), userId: data.user.id };
});
export async function clientPortalAccess(email: string) {
  if (!isClientPortalEmail(email)) return null;
  const rows = await prisma.activityLog.findMany({ where: { action: CLIENT_PORTAL_ACCESS, metadata: { path: ["emails"], array_contains: [email.trim().toLowerCase()] } }, orderBy: { createdAt: "desc" }, take: 10 });
  for (const row of rows) {
    const parsed = accessSchema.safeParse(row.metadata);
    if (!parsed.success) continue;
    const token = uploadInviteToken(parsed.data.inviteId);
    const invite = await resolveUploadInvite(token);
    if (invite && invite.orgId === row.orgId && invite.jobId === row.jobId) return { token, invite };
  }
  return null;
}
