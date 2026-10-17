import { prisma } from "@/lib/prisma";
import { loadApprovedPublishingDraft } from "@/lib/publishing/approval";
import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { readConnections, toSecret } from "@/lib/publishing/connection-store";
import { isMissingRelation } from "@/lib/publishing/http";
import { facebookReadiness, type PublishingApprovalState } from "@/lib/publishing/readiness";
import { PublishRejection } from "@/lib/publishing/types";

export async function publishingStatus(orgId: string, draftId?: string) {
  const env = readPublishingEnv(process.env);
  const [rows, deliveriesReady] = await Promise.all([
    readConnections(orgId),
    prisma.marketingDelivery.findFirst({ where: { orgId }, select: { id: true } }).then(() => true).catch((error: unknown) => {
      if (isMissingRelation(error)) return false;
      throw error;
    }),
  ]);
  let approval: PublishingApprovalState = { state: "NOT_SELECTED", draftId: null };
  if (draftId) {
    try {
      const approved = await loadApprovedPublishingDraft(orgId, draftId);
      approval = { state: "APPROVED", draftId, approvalHash: approved.approvalHash };
    } catch (error) {
      if (!(error instanceof PublishRejection)) throw error;
      approval = { state: error.status === 404 ? "UNAVAILABLE" : "REVIEW_REQUIRED", draftId };
    }
  }
  const now = new Date();
  const tables = { connections: rows !== null, deliveries: deliveriesReady };
  const providers = ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS", "GOOGLE_ADS", "META_ADS"] as const;
  const secrets = rows?.map(toSecret) ?? [];
  return {
    migrationReady: tables.connections && tables.deliveries,
    publishMode: env.publishMode,
    tables,
    connections: providers.map((provider) => presentConnection(provider, secrets.find((row) => row.provider === provider) ?? null, env, now)),
    facebook: facebookReadiness({ env, tables, connection: secrets.find((row) => row.provider === "FACEBOOK_PAGE") ?? null, approval, now }),
  };
}
