import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const type = (url.searchParams.get("type") ?? "TIMELINE") as "TIMELINE" | "GALLERY";

  if (!jobId) {
    return NextResponse.redirect(new URL("/jobs", url.origin));
  }

  const token = crypto.randomUUID();

  if (!isDemoMode()) {
    await prisma.shareLink.create({
      data: {
        orgId: auth.orgId,
        jobId,
        type,
        token,
        selectedAssetIds: [],
        createdBy: auth.userId,
      },
    });
  }

  return NextResponse.redirect(new URL(`/jobs/${jobId}?tab=overview&shareToken=${token}`, url.origin));
}
