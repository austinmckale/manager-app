import { Role } from "@prisma/client";
import { getDemoOrgId, isDemoMode, listDemoRuntimeUsers } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { createServerSupabase } from "@/lib/supabase/server";

export type AuthContext = {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  email: string;
};

type RequireAuthOptions = {
  allowFallback?: boolean;
};

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "1" || process.env.NODE_ENV === "production";
const AUTH_ALLOWED_EMAILS = (process.env.AUTH_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

export function isEmailAllowed(email?: string | null) {
  if (AUTH_ALLOWED_EMAILS.length === 0) return true;
  if (!email) return false;
  return AUTH_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

async function ensureBaseOrg() {
  const existing = await prisma.organization.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (existing) return existing.id;

  const created = await prisma.organization.create({
    data: { name: "FieldFlow Organization" },
    select: { id: true },
  });

  return created.id;
}

async function ensureUserForSessionUser(sessionUser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }) {
  const existingById = await prisma.userProfile.findUnique({
    where: { id: sessionUser.id },
  });
  if (existingById) return existingById;

  const normalizedEmail = (sessionUser.email ?? "").trim().toLowerCase();
  if (normalizedEmail) {
    const existingByEmail = await prisma.userProfile.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "asc" },
    });
    if (existingByEmail) return existingByEmail;
  }

  const orgId = await ensureBaseOrg();
  const existingUsers = await prisma.userProfile.count({ where: { orgId } });
  const fullName =
    typeof sessionUser.user_metadata?.full_name === "string" && sessionUser.user_metadata.full_name.trim().length > 0
      ? sessionUser.user_metadata.full_name.trim()
      : "Owner";

  return prisma.userProfile.create({
    data: {
      id: sessionUser.id,
      orgId,
      fullName,
      email: normalizedEmail || `${sessionUser.id}@local.invalid`,
      role: existingUsers === 0 ? Role.OWNER : Role.WORKER,
      isActive: true,
    },
  });
}

async function resolveFallbackContext(): Promise<AuthContext> {
  const ownerOrAdmin = await prisma.userProfile.findFirst({
    where: { isActive: true, role: { in: [Role.OWNER, Role.ADMIN] } },
    orderBy: { createdAt: "asc" },
  });

  if (ownerOrAdmin) {
    return {
      userId: ownerOrAdmin.id,
      orgId: ownerOrAdmin.orgId,
      role: ownerOrAdmin.role,
      fullName: ownerOrAdmin.fullName,
      email: ownerOrAdmin.email,
    };
  }

  const activeProfile = await prisma.userProfile.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (activeProfile) {
    return {
      userId: activeProfile.id,
      orgId: activeProfile.orgId,
      role: activeProfile.role,
      fullName: activeProfile.fullName,
      email: activeProfile.email,
    };
  }

  const orgId = await ensureBaseOrg();
  const created = await prisma.userProfile.create({
    data: {
      id: crypto.randomUUID(),
      orgId,
      fullName: "Owner",
      email: "owner@local.invalid",
      role: Role.OWNER,
      isActive: true,
    },
  });

  return {
    userId: created.id,
    orgId: created.orgId,
    role: created.role,
    fullName: created.fullName,
    email: created.email,
  };
}

export async function requireAuth(options?: RequireAuthOptions): Promise<AuthContext> {
  const allowFallback = options?.allowFallback ?? !AUTH_REQUIRED;

  if (isDemoMode()) {
    const user = listDemoRuntimeUsers()[0];
    return {
      userId: user?.id ?? "00000000-0000-0000-0000-000000000001",
      orgId: user?.orgId ?? getDemoOrgId(),
      role: user?.role ?? Role.OWNER,
      fullName: user?.fullName ?? "Demo User",
      email: user?.email ?? "demo@local.invalid",
    };
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      if (!isEmailAllowed(data.user.email)) {
        throw new Error("Unauthorized");
      }
      const profile = await ensureUserForSessionUser(data.user);
      return {
        userId: profile.id,
        orgId: profile.orgId,
        role: profile.role,
        fullName: profile.fullName,
        email: profile.email,
      };
    }
  } catch {
    // Fallback handled below.
  }

  if (!allowFallback) {
    throw new Error("Unauthorized");
  }

  return resolveFallbackContext();
}
