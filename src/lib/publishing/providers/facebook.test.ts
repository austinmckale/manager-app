import assert from "node:assert/strict";
import test from "node:test";
import { createFacebookPublisher } from "@/lib/publishing/providers/facebook";
import { encodeFacebookState, readFacebookState } from "@/lib/publishing/providers/facebook-state";
import { PublishRejection, type PublishAttempt } from "@/lib/publishing/types";

function fixture(responses: (Response | Error)[]) {
  const calls: { url: string; body: FormData | string }[] = [];
  const loaded: string[] = [];
  let saved: string | null = null;
  const input: PublishAttempt = {
    destination: "FACEBOOK_PAGE", text: "Owner-approved caption", assetIds: ["asset-a", "asset-b"],
    mediaUrls: [], idempotencyKey: "approved-version-key", containerId: null, providerPostId: null,
    accessToken: "synthetic-token", externalAccountId: "page-1",
    checkpoint: async (containerId) => { saved = containerId; },
  };
  const publisher = createFacebookPublisher(async (url, init) => {
    calls.push({ url: String(url), body: init!.body as FormData | string });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-token");
    assert.ok(init?.signal);
    const response = responses.shift();
    if (!response) throw new Error("Unexpected external request");
    if (response instanceof Error) throw response;
    return response;
  }, "v-test", async (id) => {
    loaded.push(id);
    return { bytes: new Uint8Array([1, 2]), mimeType: "image/jpeg", fileName: `${id}.jpg` };
  });
  return { input, publisher, calls, loaded, saved: () => saved };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });

test("partial Facebook uploads resume missing assets before submitting the complete feed payload", async () => {
  const f = fixture([json({ id: "photo-a" }), json({ error: { code: 4 } }, 429), json({ id: "photo-b" }), json({ id: "page_post" })]);
  const first = await f.publisher.publish(f.input);
  assert.equal(first.outcome, "failed");
  assert.equal(f.calls.filter((call) => call.url.endsWith("/feed")).length, 0);
  assert.deepEqual(readFacebookState(first.containerId ?? null)?.photos, [{ assetId: "asset-a", photoId: "photo-a" }]);
  const second = await f.publisher.publish({ ...f.input, containerId: first.containerId! });
  assert.equal(second.outcome, "published");
  assert.deepEqual(f.loaded, ["asset-a", "asset-b", "asset-b"]);
  assert.deepEqual(JSON.parse(f.calls.at(-1)!.body as string), { message: f.input.text, attached_media: [{ media_fbid: "photo-a" }, { media_fbid: "photo-b" }] });
  assert.equal(readFacebookState(f.saved())?.phase, "feed_pending");
  assert.equal((f.calls[0].body as FormData).get("published"), "false");
});

test("a photo transport failure preserves confirmed uploads without creating a feed post", async () => {
  const f = fixture([json({ id: "photo-a" }), new Error("network disconnected")]);
  const result = await f.publisher.publish(f.input);
  assert.equal(result.outcome, "failed");
  assert.deepEqual(readFacebookState(result.containerId ?? null)?.photos, [{ assetId: "asset-a", photoId: "photo-a" }]);
  assert.equal(f.calls.some((call) => call.url.endsWith("/feed")), false);
});

test("missing photo ids never produce an incomplete Facebook feed post", async () => {
  const f = fixture([json({ id: "photo-a" }), json({})]);
  assert.equal((await f.publisher.publish(f.input)).outcome, "failed");
  assert.equal(f.calls.length, 2);
});

test("network loss, server errors and missing feed ids hold delivery for manual checking", async () => {
  for (const response of [new Error("timeout"), json({ error: { code: 1 } }, 503), json({}), new Response("bad gateway", { status: 502 })]) {
    const f = fixture([json({ id: "photo-a" }), json({ id: "photo-b" }), response]);
    const first = await f.publisher.publish(f.input);
    assert.equal(first.outcome, "failed");
    if (first.outcome === "failed") { assert.equal(first.retryable, false); assert.match(first.message, /automatic retry is blocked/); }
    assert.equal(first.containerId, f.saved());
    const retry = await f.publisher.publish({ ...f.input, containerId: first.containerId! });
    assert.equal(retry.outcome, "failed");
    assert.equal(f.calls.length, 3);
  }
});

test("a definite feed rejection can retry using every saved photo without reuploading", async () => {
  const f = fixture([json({ id: "photo-a" }), json({ id: "photo-b" }), json({ error: { code: 4 } }, 429), json({ id: "page_post" })]);
  const first = await f.publisher.publish(f.input);
  assert.equal(first.outcome, "failed");
  assert.equal(readFacebookState(first.containerId ?? null)?.phase, "uploading");
  assert.equal((await f.publisher.publish({ ...f.input, containerId: first.containerId! })).outcome, "published");
  assert.deepEqual(f.loaded, ["asset-a", "asset-b"]);
});

test("unreadable and legacy upload records fail closed without any requests", async () => {
  for (const containerId of ["fbphotos:old-photo", "fbresume:broken", "unexpected"]) {
    const f = fixture([]);
    assert.equal((await f.publisher.publish({ ...f.input, containerId })).outcome, "failed");
    assert.equal(f.calls.length, 0);
  }
});

test("resuming against a different Page, caption, approval key or photo set is blocked", async () => {
  for (const changes of [{ externalAccountId: "different-page" }, { text: "Unapproved copy" }, { idempotencyKey: "other-approval" }, { assetIds: ["asset-a"] }]) {
    const f = fixture([json({ id: "photo-a" }), new Error("network")]);
    const first = await f.publisher.publish(f.input);
    assert.equal((await f.publisher.publish({ ...f.input, containerId: first.containerId!, ...changes })).outcome, "failed");
    assert.equal(f.calls.length, 2);
  }
});

test("resumed photos remain mapped to their assets when selection order changes", async () => {
  const f = fixture([json({ id: "photo-a" }), new Error("network"), json({ id: "photo-b" }), json({ id: "page_post" })]);
  const first = await f.publisher.publish(f.input);
  await f.publisher.publish({ ...f.input, assetIds: ["asset-b", "asset-a"], containerId: first.containerId! });
  assert.deepEqual(JSON.parse(f.calls.at(-1)!.body as string).attached_media, [{ media_fbid: "photo-b" }, { media_fbid: "photo-a" }]);
});

test("invalid photo selections and missing checkpoint storage cannot publish", async () => {
  for (const changes of [{ assetIds: [] }, { assetIds: ["asset-a", "asset-a"] }, { checkpoint: undefined }, { providerPostId: "already-posted" }]) {
    const f = fixture([]);
    assert.equal((await f.publisher.publish({ ...f.input, ...changes })).outcome, "failed");
    assert.equal(f.calls.length, 0);
  }
});

test("the uncertain feed checkpoint is durable before sending the public request", async () => {
  const f = fixture([json({ id: "photo-a" }), json({ id: "photo-b" })]);
  let checkpoints = 0;
  const result = await f.publisher.publish({ ...f.input, checkpoint: async () => { if (++checkpoints === 3) throw new Error("database unavailable"); } });
  assert.equal(result.outcome, "failed");
  assert.equal(f.calls.some((call) => call.url.endsWith("/feed")), false);
});

test("approval changes during uploads stop the adapter before any feed request", async () => {
  const f = fixture([json({ id: "photo-a" })]);
  await assert.rejects(() => f.publisher.publish({ ...f.input, checkpoint: async () => { throw new PublishRejection("Approval changed", 409); } }), PublishRejection);
  assert.equal(f.calls.length, 1);
});

test("malformed mappings cannot attach a photo twice or from outside the approved set", async () => {
  const f = fixture([json({ id: "photo-a" }), new Error("network")]);
  const first = await f.publisher.publish(f.input);
  const state = readFacebookState(first.containerId!)!;
  for (const photos of [[...state.photos, ...state.photos], [{ assetId: "foreign", photoId: "photo-a" }]]) {
    await f.publisher.publish({ ...f.input, containerId: encodeFacebookState({ ...state, photos }) });
    assert.equal(f.calls.length, 2);
  }
});
