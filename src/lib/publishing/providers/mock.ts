import type { OrganicDestination, OrganicPublisher } from "@/lib/publishing/types";

export function createMockPublisher(destination: OrganicDestination): OrganicPublisher {
  return {
    async publish(input) {
      return { outcome: "published", providerPostId: `mock:${destination}:${input.idempotencyKey.slice(0, 12)}` };
    },
  };
}
