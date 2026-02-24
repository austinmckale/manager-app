import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const type = (url.searchParams.get("type") ?? "TIMELINE") as "TIMELINE" | "GALLERY";
  const selectedAssetIds = (url.searchParams.get("selectedAssetIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

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
        selectedAssetIds,
        createdBy: auth.userId,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      },
    });
  }

  return NextResponse.redirect(new URL(`/jobs/${jobId}?shareToken=${token}`, url.origin));
}
