export function metaPausedCampaignBody(input: { name: string }) {
  return {
    name: input.name,
    objective: "OUTCOME_TRAFFIC" as const,
    status: "PAUSED" as const,
    special_ad_categories: [] as string[],
  };
}

export function assertPausedMetaCampaign(body: ReturnType<typeof metaPausedCampaignBody>) {
  if (body.status !== "PAUSED") throw new Error("Meta campaigns can only be created paused.");
}
