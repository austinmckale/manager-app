export type FacebookSetup = {
  status: string;
  statusLabel: string;
  note: string;
  externalAccountName: string | null;
};

export type FacebookDraft = {
  id: string;
  jobId: string;
  jobName: string;
  createdAt: string;
  caption: string;
  photos: { id: string; fileName: string; url: string | null }[];
  approval: "approved" | "missing" | "superseded" | "unavailable";
  approvalDetail: string;
  postable?: boolean;
};

export type FacebookResult = {
  destination: string;
  status: string;
  error: string | null;
  deduped: boolean;
  mock: boolean;
  attemptCount: number;
  simulation?: { text: string; approvalHash: string; photos: { id: string; fileName: string }[] } | null;
};

export type PublishBody = {
  ok?: boolean;
  error?: string;
  mode?: string;
  results?: FacebookResult[];
};

export function facebookSetupCopy(connection: FacebookSetup, mode: "mock" | "live") {
  return {
    ready: connection.status === "CONNECTED",
    label: connection.statusLabel,
    account: connection.externalAccountName,
    note: connection.note,
    modeNote: mode === "live"
      ? "Live publishing is on. This screen shows a published post only after Facebook confirms it."
      : "Simulation is on. A result on this screen is a dry run. Nothing is posted to Facebook.",
  };
}

export function facebookSubmitBlock(input: {
  pending: boolean;
  mode: "mock" | "live";
  connectionStatus: string;
  approval: FacebookDraft["approval"];
  photoCount: number;
  caption: string;
  postable?: boolean;
}) {
  if (input.pending) return "A request is already running. Wait for Facebook’s response before trying again.";
  if (input.postable === false) return "This website project is mixed in with new drafts. It fills the preview and is not sent from here.";
  if (!input.caption.trim()) return "This saved draft has no Facebook caption.";
  if (input.photoCount < 1) return "Select at least one photo from this saved draft.";
  if (input.approval === "missing") return "Owner approval of this exact draft and its current evidence is still required.";
  if (input.approval === "superseded") return "This draft was replaced. Approve the current version before posting.";
  if (input.approval === "unavailable") return "Owner approval could not be confirmed. Refresh the draft before posting.";
  if (input.mode === "live" && input.connectionStatus !== "CONNECTED") return "Facebook setup is not complete. Finish the connection before a live post.";
  return null;
}

export function interpretPublishResponse(responseOk: boolean, body: PublishBody | null) {
  if (!responseOk || !body || body.ok !== true || body.error) {
    return { kind: "error" as const, message: body?.error || "The post was not confirmed. Check approval, the selected photos, and Facebook setup, then try again." };
  }
  const facebook = body.results?.find((result) => result.destination === "FACEBOOK_PAGE") ?? null;
  if (!facebook || facebook.error) {
    return { kind: "error" as const, message: facebook?.error || "Facebook did not confirm this post. Nothing is shown as published." };
  }
  if (body.mode !== "live" || facebook.mock || facebook.status === "SIMULATED") {
    return { kind: "simulation" as const, message: "Simulation only. Facebook did not receive a live post.", facebook };
  }
  if (facebook.status === "PUBLISHED") {
    return { kind: "published" as const, message: "Facebook confirmed this post.", facebook };
  }
  if (facebook.status === "PROCESSING" || facebook.status === "ACCEPTED") {
    return { kind: "accepted" as const, message: "Facebook accepted the request. It is not shown as published until Facebook confirms the finished post.", facebook };
  }
  return { kind: "error" as const, message: "Facebook did not confirm this post. Nothing is shown as published." };
}
