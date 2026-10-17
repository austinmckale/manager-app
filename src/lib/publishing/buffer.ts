import { z } from "zod";
import { createHash } from "node:crypto";

const channelSchema = z.object({ id: z.string().min(1), name: z.string(), displayName: z.string().nullable(), service: z.string(), isQueuePaused: z.boolean(), isDisconnected: z.boolean().default(false), isLocked: z.boolean().default(false) });
export type BufferChannel = z.infer<typeof channelSchema> & { organization: string };
export const BUFFER_CHANNEL_SELECTION = "marketing.buffer.channels";
export function bufferSelectionId(orgId: string) {
  const hex = createHash("sha256").update(`rhi-buffer-channels-v1:${orgId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
async function bufferQuery(query: string, variables: Record<string, unknown>, key: string, fetcher: typeof fetch) {
  const response = await fetcher("https://api.buffer.com", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (!response.ok) throw new Error("Buffer connection could not be verified. Check the private API key and its permissions.");
  const body = await response.json() as { data?: unknown; errors?: unknown[] };
  if (body.errors?.length || !body.data) throw new Error("Buffer did not return a complete channel list. Check key permissions and try again.");
  return body.data;
}
export async function discoverBufferChannels(key: string, fetcher: typeof fetch = fetch): Promise<BufferChannel[]> {
  if (!key.trim()) throw new Error("Add BUFFER_API_KEY in the app’s private Production environment settings first.");
  const account = z.object({ account: z.object({ organizations: z.array(z.object({ id: z.string(), name: z.string() })).max(50) }) }).parse(await bufferQuery("query RhiOrganizations { account { organizations { id name } } }", {}, key, fetcher));
  const channels: BufferChannel[] = [];
  for (const organization of account.account.organizations) {
    const result = z.object({ channels: z.array(channelSchema).max(500) }).parse(await bufferQuery("query RhiChannels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name displayName service isQueuePaused isDisconnected isLocked } }", { organizationId: organization.id }, key, fetcher));
    channels.push(...result.channels.filter((channel) => ["facebook", "instagram", "googlebusiness"].includes(channel.service)).map((channel) => ({ ...channel, organization: organization.name })));
  }
  return channels;
}

export const bufferPostSchema = z.object({ id: z.string().min(1), channelId: z.string(), text: z.string(), status: z.string(), dueAt: z.string().nullable(), sentAt: z.string().nullable(), externalLink: z.string().nullable(), assets: z.array(z.object({ id: z.string(), mimeType: z.string() })) });
export type BufferPost = z.infer<typeof bufferPostSchema>;
const postFields = "id channelId text status dueAt sentAt externalLink assets { id mimeType }";
export class BufferRejected extends Error {}
export async function createBufferPost(input: { channel: BufferChannel; text: string; imageUrls: string[]; mode: "draft" | "queue" }, key: string, fetcher: typeof fetch = fetch): Promise<BufferPost> {
  if (!key.trim()) throw new Error("Buffer key unavailable.");
  const metadata = input.channel.service === "googlebusiness" ? { google: { type: "whats_new" } } : input.channel.service === "instagram" ? { instagram: { type: "post", shouldShareToFeed: true } } : { facebook: { type: "post" } };
  const response = await fetcher("https://api.buffer.com", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `mutation RhiCreatePost($input: CreatePostInput!) { createPost(input: $input) { __typename ... on PostActionSuccess { post { ${postFields} } } ... on MutationError { message } } }`, variables: { input: { channelId: input.channel.id, text: input.text, assets: input.imageUrls.map((url) => ({ image: { url } })), metadata, schedulingType: "automatic", mode: "addToQueue", saveToDraft: input.mode === "draft", needsApproval: false, source: "RHI Pros Manager" } } }) });
  if (!response.ok) throw new Error("Buffer response unavailable; check Buffer before sending again.");
  const body = await response.json() as { errors?: unknown[]; data?: { createPost?: { __typename?: string; post?: unknown } } };
  // Never expose provider messages, which can contain private URLs or submitted text.
  if (body.errors?.length) throw new BufferRejected("Buffer rejected the request. Check channel permissions and media requirements in Buffer.");
  const result = body.data?.createPost;
  if (result?.__typename && result.__typename !== "PostActionSuccess") throw new BufferRejected("Buffer rejected this post. Check the channel connection, posting limits and media requirements in Buffer.");
  return bufferPostSchema.parse(result?.post);
}
export async function readBufferPost(id: string, key: string, fetcher: typeof fetch = fetch) {
  const data = await bufferQuery(`query RhiPost($input: PostInput!) { post(input: $input) { ${postFields} } }`, { input: { id } }, key, fetcher);
  return z.object({ post: bufferPostSchema }).parse(data).post;
}
