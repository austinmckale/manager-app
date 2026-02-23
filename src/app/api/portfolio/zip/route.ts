import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { getStoragePublicUrl } from "@/lib/utils";

export async function GET() {
  const auth = await requireAuth();
  const zip = new JSZip();

  if (isDemoMode()) {
    zip.file("readme.txt", "Demo mode: connect Supabase storage to download portfolio assets.");
  } else {
    const assets = await prisma.fileAsset.findMany({
      where: {
        job: { orgId: auth.orgId },
        isPortfolio: true,
        type: "PHOTO",
      },
      take: 40,
    });

    await Promise.all(
      assets.map(async (asset) => {
        const url = getStoragePublicUrl(asset.storageKey);
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.arrayBuffer();
        zip.file(asset.fileName || `${asset.id}.jpg`, blob);
      }),
    );
  }

  const content = await zip.generateAsync({ type: "uint8array" });
  return new NextResponse(Buffer.from(content), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=portfolio.zip",
    },
  });
}
