import { z } from "zod";

const PREFIX = "fbresume:";
const stateSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  phase: z.enum(["uploading", "feed_pending"]),
  photos: z.array(z.object({ assetId: z.string().min(1), photoId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).strict()).max(10),
}).strict();

export type FacebookResumeState = z.infer<typeof stateSchema>;

export function readFacebookState(containerId: string | null): FacebookResumeState | null {
  if (!containerId?.startsWith(PREFIX)) return null;
  try {
    const parsed = stateSchema.safeParse(JSON.parse(containerId.slice(PREFIX.length)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeFacebookState(state: FacebookResumeState) {
  return PREFIX + JSON.stringify(state);
}

export function facebookRetryBlocker(containerId: string | null) {
  if (!containerId) return null;
  const state = readFacebookState(containerId);
  if (!state) return "This Facebook delivery has an older or unreadable upload record. Check the Page before starting a new delivery.";
  if (state.phase === "feed_pending") return "Facebook may have created this post, but confirmation was not saved. Check the Page before starting a new delivery; automatic retry is blocked.";
  return null;
}
