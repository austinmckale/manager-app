import type { OrganicDestination, OrganicPublisher } from "@/lib/publishing/types";

export function createMockPublisher(destination: OrganicDestination): OrganicPublisher {
  return {
    async publish(input) {
      // Accepted by this application as a simulation, never a published post.
      return { outcome: "accepted", providerPostId: `mock:${destination}:${input.idempotencyKey.slice(0, 12)}` };
    },
  };
}
