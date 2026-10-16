import { z } from "zod";
import { marketingDraftSchema } from "@/lib/marketing";

export const savedPackSchema = z.object({
  id: z.string().uuid(), jobId: z.string().uuid(), jobName: z.string(), createdAt: z.string(), draft: marketingDraftSchema,
});
export type SavedMarketingPack = z.infer<typeof savedPackSchema>;
export const DEMO_PACK_KEY = "rhi-marketing-demo-packs-v1";

export function readDemoPacks(): SavedMarketingPack[] {
  try {
    const value = JSON.parse(localStorage.getItem(DEMO_PACK_KEY) ?? "[]");
    const result = z.array(savedPackSchema).safeParse(value);
    return result.success ? result.data : [];
  } catch { return []; }
}

export function saveDemoPack(pack: SavedMarketingPack) {
  const packs = [savedPackSchema.parse(pack), ...readDemoPacks()].slice(0, 50);
  localStorage.setItem(DEMO_PACK_KEY, JSON.stringify(packs));
  window.dispatchEvent(new Event("rhi:demo-pack-saved"));
}

export function parseSavedPack(record: { id: string; jobId: string | null; createdAt: Date; metadata: unknown; job: { jobName: string } | null }): SavedMarketingPack | null {
  const result = savedPackSchema.safeParse({ id: record.id, jobId: record.jobId, jobName: record.job?.jobName ?? "Project", createdAt: record.createdAt.toISOString(), draft: record.metadata });
  return result.success ? result.data : null;
}
