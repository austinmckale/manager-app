import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const customerId = url.searchParams.get("customerId");

  if (!jobId || !customerId) {
    return NextResponse.redirect(new URL("/jobs", url.origin));
  }

  const token = crypto.randomUUID();

  if (!isDemoMode()) {
    await prisma.portalLink.create({
      data: {
        orgId: auth.orgId,
        jobId,
        customerId,
        token,
        createdBy: auth.userId,
      },
    });
  }

  return NextResponse.redirect(new URL(`/jobs/${jobId}?tab=overview&portalToken=${token}`, url.origin));
}
