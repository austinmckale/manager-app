import { Role } from "@prisma/client";
import { cache } from "react";
import { cookies } from "next/headers";
import { parseAuthContextCookieValue, AUTH_CONTEXT_COOKIE_NAME } from "@/lib/auth-context-cookie";
import { getDemoOrgId, isDemoMode, listDemoRuntimeUsers } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { createServerSupabase } from "@/lib/supabase/server";
import { isClientPortalEmail, isDashboardOwnerEmail } from "@/lib/client-portal-policy";

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
export function isEmailAllowed(email?: string | null) {
  return isClientPortalEmail(email) || isDashboardOwnerEmail(email);
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
  if (isClientPortalEmail(sessionUser.email)) throw new Error("Client portal only");
  if (!isDashboardOwnerEmail(sessionUser.email)) throw new Error("Unauthorized");
  const existingById = await prisma.userProfile.findUnique({
    where: { id: sessionUser.id },
  });
  if (existingById) {
    if (!existingById.isActive || !isDashboardOwnerEmail(existingById.email) || (existingById.role !== Role.OWNER && existingById.role !== Role.ADMIN)) throw new Error("Unauthorized");
    return existingById;
  }

  const normalizedEmail = (sessionUser.email ?? "").trim().toLowerCase();
  if (normalizedEmail) {
    const existingByEmail = await prisma.userProfile.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "asc" },
    });
    if (existingByEmail) {
      if (!existingByEmail.isActive || (existingByEmail.role !== Role.OWNER && existingByEmail.role !== Role.ADMIN)) throw new Error("Unauthorized");
      return existingByEmail;
    }
  }

  throw new Error("Unauthorized");
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
  return requireAuthCached(allowFallback);
}

const requireAuthCached = cache(async (allowFallback: boolean): Promise<AuthContext> => {
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

  const cookieStore = await cookies();
  const cachedAuth = parseAuthContextCookieValue(cookieStore.get(AUTH_CONTEXT_COOKIE_NAME)?.value);
  if (cachedAuth && isClientPortalEmail(cachedAuth.email)) throw new Error("Client portal only");
  if (cachedAuth && !isDashboardOwnerEmail(cachedAuth.email)) throw new Error("Unauthorized");
  if (cachedAuth && isDashboardOwnerEmail(cachedAuth.email) && (cachedAuth.role === Role.OWNER || cachedAuth.role === Role.ADMIN)) {
    return cachedAuth;
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user && data.user.email_confirmed_at) {
      if (!isDashboardOwnerEmail(data.user.email)) {
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
});
