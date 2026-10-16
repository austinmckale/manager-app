import { randomBytes } from "node:crypto";

export const INGEST_PREFIX = "marketing-ingest";
const PUBLIC_BUCKET = "site-public";

export function ingestObjectPath(orgId: string, assetId: string) {
  const token = randomBytes(16).toString("hex");
  return `${INGEST_PREFIX}/${orgId}/${token}-${assetId}`;
}

export function publicIngestUrl(supabaseUrl: string, objectPath: string) {
  if (!objectPath.startsWith(`${INGEST_PREFIX}/`)) {
    throw new Error("Only limited ingest files can be made public.");
  }
  const base = supabaseUrl.replace(/\/$/, "");
  if (!base.startsWith("https://")) {
    throw new Error("Instagram and Google need a public https media URL. Set NEXT_PUBLIC_SUPABASE_URL to the project URL.");
  }
  const encoded = objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${base}/storage/v1/object/public/${PUBLIC_BUCKET}/${encoded}`;
}

export function ingestExpiresAt(now: Date) {
  return new Date(now.getTime() + 2 * 60 * 60 * 1000);
}
