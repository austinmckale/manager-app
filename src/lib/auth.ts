import { Role } from "@prisma/client";
import { cache } from "react";
import { cookies } from "next/headers";
import { parseAuthContextCookieValue, AUTH_CONTEXT_COOKIE_NAME } from "@/lib/auth-context-cookie";
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
  if (existingById) {
    if (!existingById.isActive) throw new Error("Unauthorized");
    return existingById;
  }

  const normalizedEmail = (sessionUser.email ?? "").trim().toLowerCase();
  if (normalizedEmail) {
    const existingByEmail = await prisma.userProfile.findFirst({
      where: { email: normalizedEmail },
      orderBy: { createdAt: "asc" },
    });
    if (existingByEmail) {
      if (!existingByEmail.isActive) throw new Error("Unauthorized");
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
  if (cachedAuth && isEmailAllowed(cachedAuth.email)) {
    return cachedAuth;
  }

  try {
    const supabase = await createServerSupabase();
    // Fast path: read session from auth cookies without forcing a remote user lookup.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const sessionUser = session?.user;
    if (sessionUser) {
      if (!isEmailAllowed(sessionUser.email)) {
        throw new Error("Unauthorized");
      }
      const profile = await ensureUserForSessionUser(sessionUser);
      return {
        userId: profile.id,
        orgId: profile.orgId,
        role: profile.role,
        fullName: profile.fullName,
        email: profile.email,
      };
    }

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
});
