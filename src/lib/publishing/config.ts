import { encryptionKeyReady } from "@/lib/publishing/crypto";
import type { MarketingProviderName, OauthFlow } from "@/lib/publishing/types";

export const GRAPH_VERSION_DEFAULT = "v26.0";
export const GOOGLE_ADS_VERSION_DEFAULT = "v26";

const ENV_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MARKETING_TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_APP_URL",
] as const;

export type PublishingEnvName = (typeof ENV_KEYS)[number];

export type PublishingEnv = {
  present: Record<PublishingEnvName, boolean>;
  googleBusinessAccessGranted: boolean;
  googleAdsAccess: "missing" | "test" | "basic" | "standard";
  publishMode: "mock" | "live";
  graphVersion: string;
  googleAdsVersion: string;
};

type ProviderSpec = {
  label: string;
  flow: OauthFlow;
  scopes: string[];
  env: PublishingEnvName[];
  connectedNote: string;
};

export const PROVIDER_CATALOG: Record<MarketingProviderName, ProviderSpec> = {
  FACEBOOK_PAGE: {
    label: "Facebook Page",
    flow: "meta_organic",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    env: ["META_APP_ID", "META_APP_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"],
    connectedNote:
      "Standard Access publishes only for people with a role on the Meta app. App Review Advanced Access is required before posting for any other Page.",
  },
  INSTAGRAM: {
    label: "Instagram",
    flow: "meta_organic",
    scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
    env: ["META_APP_ID", "META_APP_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"],
    connectedNote:
      "Instagram publishing requires a professional Business or Creator account linked to a Facebook Page. Personal accounts cannot publish through the API. The 24-hour limit is 100 API-published posts.",
  },
  GOOGLE_BUSINESS: {
    label: "Google Business Profile",
    flow: "google_business",
    scopes: ["https://www.googleapis.com/auth/business.manage"],
    env: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"],
    connectedNote: "Local posts use the Google Business Profile API for the selected location.",
  },
  GOOGLE_ADS: {
    label: "Google Ads",
    flow: "google_ads",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    env: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"],
    connectedNote: "Connected for paused campaign drafts. This app does not enable campaigns or raise budgets.",
  },
  META_ADS: {
    label: "Meta Ads",
    flow: "meta_ads",
    scopes: ["ads_read", "ads_management", "business_management", "pages_show_list", "pages_read_engagement"],
    env: ["META_APP_ID", "META_APP_SECRET", "MARKETING_TOKEN_ENCRYPTION_KEY"],
    connectedNote:
      "Connected for paused campaign drafts. Advanced Access is required before this app can manage an ad account the Meta app user does not own.",
  },
};

export function readPublishingEnv(source: Record<string, string | undefined>): PublishingEnv {
  const present = Object.fromEntries(ENV_KEYS.map((key) => [key, Boolean(source[key]?.trim())])) as Record<PublishingEnvName, boolean>;
  present.MARKETING_TOKEN_ENCRYPTION_KEY = encryptionKeyReady(source.MARKETING_TOKEN_ENCRYPTION_KEY);
  const adsAccess = source.GOOGLE_ADS_API_ACCESS?.trim().toLowerCase();
  return {
    present,
    googleBusinessAccessGranted: source.GOOGLE_BUSINESS_API_ACCESS?.trim().toLowerCase() === "granted",
    googleAdsAccess: adsAccess === "test" || adsAccess === "basic" || adsAccess === "standard" ? adsAccess : "missing",
    publishMode: source.MARKETING_PUBLISH_MODE?.trim() === "live" ? "live" : "mock",
    graphVersion: source.META_GRAPH_VERSION?.trim() || GRAPH_VERSION_DEFAULT,
    googleAdsVersion: source.GOOGLE_ADS_API_VERSION?.trim() || GOOGLE_ADS_VERSION_DEFAULT,
  };
}

export function missingCredentialNames(provider: MarketingProviderName, env: PublishingEnv) {
  return PROVIDER_CATALOG[provider].env.filter((name) => !env.present[name]);
}

export function approvalBlocker(provider: MarketingProviderName, env: PublishingEnv) {
  if (provider === "GOOGLE_BUSINESS" && !env.googleBusinessAccessGranted) {
    return "Google Business Profile API quota starts at zero. Submit Google's Basic API Access application. Set GOOGLE_BUSINESS_API_ACCESS=granted only after Google approves it.";
  }
  if (provider === "GOOGLE_ADS" && env.googleAdsAccess === "missing") {
    return "This Google Cloud project needs Google Ads API access (test, basic, or standard). Apply from the Google Ads API overview for that project. Developer tokens were retired on September 9, 2026; access follows the Cloud project. Set GOOGLE_ADS_API_ACCESS after the project is approved.";
  }
  return null;
}

export function scopesForFlow(flow: OauthFlow) {
  if (flow === "meta_organic") {
    return [...new Set([...PROVIDER_CATALOG.FACEBOOK_PAGE.scopes, ...PROVIDER_CATALOG.INSTAGRAM.scopes])];
  }
  if (flow === "meta_ads") return PROVIDER_CATALOG.META_ADS.scopes;
  if (flow === "google_business") return PROVIDER_CATALOG.GOOGLE_BUSINESS.scopes;
  return PROVIDER_CATALOG.GOOGLE_ADS.scopes;
}

export function appBaseUrl(source: Record<string, string | undefined>) {
  return (source.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
