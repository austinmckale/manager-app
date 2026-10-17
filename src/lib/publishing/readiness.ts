import { missingCredentialNames, PROVIDER_CATALOG, type PublishingEnv } from "@/lib/publishing/config";
import type { SecretConnection } from "@/lib/publishing/types";

export type PublishingApprovalState = {
  state: "NOT_SELECTED" | "APPROVED" | "REVIEW_REQUIRED" | "UNAVAILABLE";
  draftId: string | null;
  approvalHash?: string;
};

type Blocker = { code: string; message: string };

/** Stored readiness only. This neither validates a token with Meta nor grants publishing permission. */
export function facebookReadiness(input: {
  env: PublishingEnv;
  tables: { connections: boolean; deliveries: boolean };
  connection: SecretConnection | null;
  approval: PublishingApprovalState;
  now: Date;
}) {
  const { env, tables, connection, approval, now } = input;
  const simulationBlockers: Blocker[] = [];
  const setupBlockers: Blocker[] = [];
  if (!tables.connections || !tables.deliveries) {
    simulationBlockers.push({ code: "PUBLISHING_TABLES_MISSING", message: "Apply the publishing database migration before saving a delivery." });
  }
  if (approval.state !== "APPROVED") {
    simulationBlockers.push({
      code: approval.state === "NOT_SELECTED" ? "SELECT_DRAFT" : "APPROVAL_REQUIRED",
      message: approval.state === "NOT_SELECTED" ? "Choose a saved draft to check its approval." : "Review and approve the exact current draft and source evidence.",
    });
  }
  const missingConfiguration = missingCredentialNames("FACEBOOK_PAGE", env);
  if (missingConfiguration.length) setupBlockers.push({ code: "MISSING_CONFIGURATION", message: `Configure ${missingConfiguration.join(", ")}.` });
  if (!connection?.accessToken) {
    setupBlockers.push({ code: "ACCOUNT_NOT_CONNECTED", message: "Connect the Facebook Page account." });
  } else {
    if (!connection.externalAccountId) setupBlockers.push({ code: "PAGE_NOT_SELECTED", message: "Choose the Facebook Page to post to." });
    if (connection.tokenExpiresAt && (!Number.isFinite(Date.parse(connection.tokenExpiresAt)) || Date.parse(connection.tokenExpiresAt) <= now.getTime() + 120_000)) {
      setupBlockers.push({ code: "AUTHORIZATION_EXPIRED", message: "Reconnect Facebook; its authorization is expired or expiring." });
    }
    if (PROVIDER_CATALOG.FACEBOOK_PAGE.scopes.some((scope) => !connection.scopes.includes(scope))) {
      setupBlockers.push({ code: "MISSING_PERMISSIONS", message: "Reconnect Facebook with the required Page publishing permissions." });
    }
    if (connection.status !== "CONNECTED") setupBlockers.push({ code: "CONNECTION_NOT_READY", message: "Resolve the Facebook connection status before posting." });
  }
  const liveBlockers = [...simulationBlockers, ...setupBlockers];
  if (env.publishMode !== "live") liveBlockers.push({ code: "SIMULATION_MODE", message: "Publishing is in simulation mode. No Facebook post will be created." });
  const canSimulate = env.publishMode === "mock" && simulationBlockers.length === 0;
  const canPublish = env.publishMode === "live" && liveBlockers.length === 0;
  const status = canPublish ? "READY_TO_POST" : canSimulate ? "READY_FOR_SIMULATION"
    : !tables.connections || !tables.deliveries || missingConfiguration.length ? "SETUP_REQUIRED"
      : approval.state !== "APPROVED" ? "APPROVAL_REQUIRED" : "ACCOUNT_REQUIRED";
  return {
    status, mode: env.publishMode, canSimulate, canPublish,
    missingConfiguration, simulationBlockers, setupBlockers, liveBlockers, approval,
    account: { id: connection?.externalAccountId ?? null, name: connection?.externalAccountName ?? null, status: connection?.status ?? "NOT_CONNECTED" },
    authorizationCheck: "stored_only" as const,
  };
}
