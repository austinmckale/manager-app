export function googleAdsPausedMutations(input: {
  customerId: string;
  name: string;
  budgetAmountCents: number;
  startDate: string;
  endDate: string;
  budgetResourceName: string;
}) {
  const amountMicros = input.budgetAmountCents * 10_000;
  return {
    budget: {
      operations: [
        {
          create: {
            name: `${input.name} budget`,
            amountMicros: String(amountMicros),
            deliveryMethod: "STANDARD",
            explicitlyShared: false,
          },
        },
      ],
    },
    campaign: {
      operations: [
        {
          create: {
            name: input.name,
            status: "PAUSED" as const,
            advertisingChannelType: "SEARCH",
            campaignBudget: input.budgetResourceName,
            startDate: input.startDate.replaceAll("-", ""),
            endDate: input.endDate.replaceAll("-", ""),
            manualCpc: {},
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: false,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
          },
        },
      ],
    },
  };
}

export function assertPausedGoogleCampaign(campaign: ReturnType<typeof googleAdsPausedMutations>["campaign"]) {
  const status = campaign.operations[0]?.create.status;
  if (status !== "PAUSED") {
    throw new Error("Google Ads campaigns can only be created paused.");
  }
}
