export const ORGANIC_DESTINATIONS = ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS"] as const;
export type OrganicDestination = (typeof ORGANIC_DESTINATIONS)[number];

export const AD_PROVIDERS = ["GOOGLE_ADS", "META_ADS"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

export const MARKETING_PROVIDERS = [...ORGANIC_DESTINATIONS, ...AD_PROVIDERS] as const;
export type MarketingProviderName = (typeof MARKETING_PROVIDERS)[number];

export type ConnectionStatus =
  | "MISSING_CONFIGURATION"
  | "PENDING_PLATFORM_APPROVAL"
  | "CONNECTED"
  | "EXPIRED"
  | "ERROR";

export type DeliveryStatus = "ACCEPTED" | "PROCESSING" | "PUBLISHED" | "FAILED";

export type OauthFlow = "meta_organic" | "meta_ads" | "google_business" | "google_ads";

export type DeliveryRecord = {
  id: string;
  orgId: string;
  jobId: string;
  draftId: string;
  destination: OrganicDestination;
  assetIds: string[];
  idempotencyKey: string;
  contentHash: string;
  status: DeliveryStatus;
  providerPostId: string | null;
  containerId: string | null;
  attemptCount: number;
  lastError: string | null;
  acceptedAt: string | null;
  publishedAt: string | null;
};

export type ProviderOutcome =
  | { outcome: "published"; providerPostId: string; containerId?: string }
  | { outcome: "processing"; providerPostId?: string; containerId?: string }
  | { outcome: "accepted"; providerPostId?: string; containerId?: string }
  | {
      outcome: "failed";
      message: string;
      retryable: boolean;
      rateLimited?: boolean;
      approvalPending?: boolean;
      expired?: boolean;
      providerPostId?: string;
      containerId?: string;
    };

export type PublishAttempt = {
  destination: OrganicDestination;
  text: string;
  assetIds: string[];
  mediaUrls: string[];
  idempotencyKey: string;
  containerId: string | null;
  providerPostId: string | null;
  accessToken: string;
  externalAccountId: string;
  /** Persist provider progress before any potentially public request. */
  checkpoint?: (containerId: string) => Promise<void>;
};

export type OrganicPublisher = {
  publish: (input: PublishAttempt) => Promise<ProviderOutcome>;
  poll?: (input: PublishAttempt) => Promise<ProviderOutcome>;
};

export type SecretConnection = {
  provider: MarketingProviderName;
  status: ConnectionStatus;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  externalAccountId: string | null;
  externalAccountName: string | null;
  scopes: string[];
  lastError: string | null;
  approvalNote: string | null;
  candidates: { id: string; name: string }[];
};

export type OwnedAsset = {
  id: string;
  orgId: string;
  jobId: string;
  mimeType: string | null;
  fileName: string;
  fileSize: number | null;
  storageKey: string;
};

export class PublishRejection extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublishRejection";
    this.status = status;
  }
}
