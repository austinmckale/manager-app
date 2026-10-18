import { z } from "zod";
import { marketingDraftSchema, type MarketingDraft } from "@/lib/marketing";

// Action names match the stored ActivityLog values. They are duplicated here so
// this view model does not import Prisma through the intake modules.
const PHOTO_RECEIVED = "field.photo.received";
const AUDIO_RECEIVED = "field.audio.received";
const GENERATION = "marketing.generation.job";
const DRAFT_SAVED = "marketing.draft.saved";
const APPROVED = "marketing.content.approved";
const SUPERSEDED = "marketing.content.superseded";
const INTAKE_PACK = "marketing.intake.pack.ready";
const BUFFER_DELIVERY = "marketing.buffer.delivery";

export const inboxStatusOrder = ["needs_details", "needs_review", "ready_to_schedule", "processing", "received", "scheduled", "posted"] as const;
export type InboxStatus = (typeof inboxStatusOrder)[number];
export type InboxAction = "review" | "notes" | "open";

export type InboxPhotoInput = {
  id: string;
  jobId: string;
  jobName: string;
  unsorted: boolean;
  createdAt: string;
  description: string;
  tags: string[];
  onWebsite: boolean;
};

export type InboxLogInput = {
  id: string;
  action: string;
  createdAt: string;
  metadata: unknown;
};

export type InboxCardModel = {
  id: string;
  jobId: string;
  jobName: string;
  unsorted: boolean;
  test: boolean;
  submittedAt: string;
  title: string;
  place: string;
  jobLabel: string;
  summary: string;
  status: InboxStatus;
  statusLabel: string;
  detail: string;
  actionLabel: string;
  action: InboxAction;
  draftId: string | null;
  draft: MarketingDraft | null;
  photoIds: string[];
  photoCount: number;
  websitePhotoCount: number;
};

const idSchema = z.string().uuid();
const generationStatusSchema = z.enum(["queued", "running", "completed", "failed", "held"]);

export function isMarkedTestText(value: string) {
  return value.split(/\r?\n/).some((line) => /^TEST\b/i.test(line.trim()));
}

export function submissionNote(description: string) {
  return description.replace(/^Town \/ job:.*(?:\r?\n+|$)/i, "").trim();
}

export function submissionPlace(location: string, descriptions: string[]) {
  if (location.trim()) return location.trim();
  for (const description of descriptions) {
    const match = description.match(/^Town \/ job:\s*(.+)$/im);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

export function submissionSummary(note: string, transcript: string) {
  const text = (transcript.trim() || note.trim()).replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function meta(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function newest<T extends { createdAt: string }>(rows: T[]) {
  return rows.reduce<T | null>((best, row) => !best || row.createdAt > best.createdAt ? row : best, null);
}

function eastern(iso: string) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} Eastern`;
}

function bufferDelivery(logs: InboxLogInput[], draftId: string) {
  const rank: Record<string, number> = { published: 6, sending: 5, queued: 4, draft: 3, unknown: 2, preparing: 2, needs_approval: 2, failed: 1, rejected: 1 };
  const rows = logs.filter((log) => log.action === BUFFER_DELIVERY && text(meta(log.metadata)?.draftId) === draftId);
  const best = rows.reduce<InboxLogInput | null>((chosen, row) => {
    if (!chosen) return row;
    const chosenRank = rank[text(meta(chosen.metadata)?.status)] ?? 0;
    const rowRank = rank[text(meta(row.metadata)?.status)] ?? 0;
    if (rowRank !== chosenRank) return rowRank > chosenRank ? row : chosen;
    return row.createdAt > chosen.createdAt ? row : chosen;
  }, null);
  if (!best) return null;
  const status = text(meta(best.metadata)?.status);
  const otherFailed = rows.some((row) => row !== best && ["failed", "rejected"].includes(text(meta(row.metadata)?.status)));
  return { status, dueAt: text(meta(best.metadata)?.dueAt), sentAt: text(meta(best.metadata)?.sentAt), otherFailed };
}

function derive(input: {
  note: string;
  transcript: string;
  voice: "none" | "pending" | "failed" | "ready";
  generation: "none" | "queued" | "running" | "completed" | "failed" | "held";
  draft: boolean;
  approved: boolean;
  buffer: { status: string; dueAt: string; sentAt: string; otherFailed: boolean } | null;
}) {
  if (input.draft && input.approved && input.buffer) {
    const extra = input.generation === "queued" || input.generation === "running" ? " Another generation is still in progress." : input.generation === "held" ? " An earlier generation pass is still waiting on details." : "";
    const channel = input.buffer.otherFailed ? " Another channel did not finish. Check Buffer before sending that one again." : "";
    const sent = eastern(input.buffer.sentAt);
    const due = eastern(input.buffer.dueAt);
    if (input.buffer.status === "published") {
      const when = sent ? ` at ${sent}` : ". The publication time was not saved";
      return { status: "posted" as const, statusLabel: "Posted", detail: `Buffer published this${when}.${channel}${extra}`, actionLabel: "View delivery", action: "review" as const };
    }
    if (input.buffer.status === "queued" || input.buffer.status === "sending") {
      const when = input.buffer.status === "sending" && !due ? " Buffer is publishing this now." : due ? ` Buffer's slot is ${due}.` : " Buffer will publish it at the next open slot on your Buffer schedule.";
      return { status: "scheduled" as const, statusLabel: "Scheduled", detail: `This is in Buffer's queue.${when}${channel}${extra}`, actionLabel: "View delivery", action: "review" as const };
    }
    if (input.buffer.status === "draft") {
      return { status: "ready_to_schedule" as const, statusLabel: "Draft in Buffer", detail: `Buffer is holding this as a draft. It posts when you set a time in Buffer.${channel}${extra}`, actionLabel: "View delivery", action: "review" as const };
    }
    if (input.buffer.status === "failed" || input.buffer.status === "rejected") {
      return { status: "ready_to_schedule" as const, statusLabel: "Send failed", detail: `This send did not finish. Check Buffer before sending again.${extra}`, actionLabel: "View delivery", action: "review" as const };
    }
    if (input.buffer.status === "preparing" || input.buffer.status === "unknown" || input.buffer.status === "needs_approval") {
      return { status: "ready_to_schedule" as const, statusLabel: "Send unconfirmed", detail: `Buffer has not confirmed this yet. Check Buffer before sending again.${extra}`, actionLabel: "View delivery", action: "review" as const };
    }
  }
  if (input.voice === "pending") {
    return { status: "processing" as const, statusLabel: "Processing", detail: "Voice transcription is not finished. The recording stays saved.", actionLabel: "View progress", action: "open" as const };
  }
  if (input.generation === "held") {
    return { status: "needs_details" as const, statusLabel: "Needs details", detail: "Draft generation is held until more job detail is saved.", actionLabel: "Add details", action: "notes" as const };
  }
  if (input.voice === "failed") {
    return { status: "needs_details" as const, statusLabel: "Needs details", detail: "Voice transcription failed. The recording stays saved.", actionLabel: "Add details", action: "notes" as const };
  }
  if (input.draft && input.approved) {
    const extra = input.generation === "queued" || input.generation === "running" ? " Another generation is still in progress." : "";
    return { status: "ready_to_schedule" as const, statusLabel: "Ready to schedule", detail: `This saved version is approved. Approval is not a scheduled or published post.${extra}`, actionLabel: "Open approved draft", action: "review" as const };
  }
  if (input.generation === "queued" || input.generation === "running") {
    return { status: "processing" as const, statusLabel: "Processing", detail: input.generation === "running" ? "Draft generation is running." : "Draft generation is queued.", actionLabel: "View progress", action: "open" as const };
  }
  if (input.generation === "failed" && !input.draft) {
    return { status: "needs_details" as const, statusLabel: "Needs details", detail: "Draft generation did not finish. The photos and notes stay saved.", actionLabel: "Add details", action: "notes" as const };
  }
  if (!input.note && !input.transcript && !input.draft) {
    return { status: "needs_details" as const, statusLabel: "Needs details", detail: "No job note or transcript is saved with these photos.", actionLabel: "Add details", action: "notes" as const };
  }
  if (input.draft) {
    const failed = input.generation === "failed" ? " The latest generation did not finish." : "";
    return { status: "needs_review" as const, statusLabel: "Needs review", detail: `A saved draft exists and is not approved.${failed}`, actionLabel: "Review draft", action: "review" as const };
  }
  return { status: "received" as const, statusLabel: "Received", detail: "Photos are saved. No draft has been saved for them yet.", actionLabel: "Open submission", action: "open" as const };
}

export function compareInbox(a: InboxCardModel, b: InboxCardModel) {
  const rank = inboxStatusOrder.indexOf(a.status) - inboxStatusOrder.indexOf(b.status);
  if (rank !== 0) return rank;
  return a.submittedAt < b.submittedAt ? 1 : a.submittedAt > b.submittedAt ? -1 : a.id < b.id ? -1 : 1;
}

export function buildInboxCards(photos: InboxPhotoInput[], logs: InboxLogInput[]): InboxCardModel[] {
  const groups = new Map<string, InboxPhotoInput[]>();
  for (const photo of photos) {
    const submission = photo.tags.find((tag) => tag.startsWith("submission:"))?.slice("submission:".length);
    const key = submission && idSchema.safeParse(submission).success ? submission : `job:${photo.jobId}`;
    groups.set(key, [...(groups.get(key) ?? []), photo]);
  }

  const approvals = new Set(logs.flatMap((log) => {
    if (log.action !== APPROVED) return [];
    const draftId = text(meta(log.metadata)?.draftId);
    return idSchema.safeParse(draftId).success ? [draftId] : [];
  }));
  const superseded = new Set(logs.flatMap((log) => {
    if (log.action !== SUPERSEDED) return [];
    const draftId = text(meta(log.metadata)?.draftId);
    return idSchema.safeParse(draftId).success ? [draftId] : [];
  }));

  const cards: InboxCardModel[] = [];
  for (const [id, items] of groups) {
    const submissionId = id.startsWith("job:") ? "" : id;
    const related = submissionId ? logs.filter((log) => text(meta(log.metadata)?.submissionId) === submissionId) : [];
    const receipts = related.filter((log) => log.action === PHOTO_RECEIVED);
    const audio = related.filter((log) => log.action === AUDIO_RECEIVED);
    const generation = newest(related.filter((log) => log.action === GENERATION && generationStatusSchema.safeParse(text(meta(log.metadata)?.status)).success));
    const generationStatus = generation ? generationStatusSchema.parse(text(meta(generation.metadata)?.status)) : "none";
    const packs = related.filter((log) => log.action === INTAKE_PACK);
    const photoIds = items.map((photo) => photo.id);
    const photoIdSet = new Set(photoIds);
    const draftLog = newest(logs.filter((log) => {
      if (log.action !== DRAFT_SAVED) return false;
      const parsed = marketingDraftSchema.safeParse(log.metadata);
      return parsed.success && parsed.data.assetIds.every((assetId) => photoIdSet.has(assetId));
    }));
    const draft = draftLog ? marketingDraftSchema.parse(draftLog.metadata) : null;
    const approved = Boolean(draftLog && approvals.has(draftLog.id) && !superseded.has(draftLog.id));
    const note = [...new Set([...receipts.map((log) => text(meta(log.metadata)?.description)), ...items.map((photo) => submissionNote(photo.description))].map((value) => value.trim()).filter(Boolean))].join("\n\n");
    const transcript = audio.map((log) => text(meta(log.metadata)?.transcript).trim()).filter(Boolean).join("\n\n");
    const voiceState = audio.reduce<"none" | "pending" | "failed" | "ready">((state, log) => {
      const status = text(meta(log.metadata)?.status);
      const next = status === "transcribed" ? "ready" : status === "failed" ? "failed" : "pending";
      if (state === "pending" || next === "pending") return "pending";
      if (state === "failed" || next === "failed") return "failed";
      return next;
    }, "none");
    const place = submissionPlace(text(meta(newest(receipts)?.metadata)?.location), items.map((photo) => photo.description));
    const first = items[0];
    const submittedAt = items.reduce((earliest, photo) => photo.createdAt < earliest ? photo.createdAt : earliest, items[0].createdAt);
    const photoNotes = items.map((photo) => submissionNote(photo.description).trim()).filter(Boolean);
    const markedNote = packs.some((log) => meta(log.metadata)?.isTest === true) || receipts.some((log) => meta(log.metadata)?.isTest === true) || isMarkedTestText(note);
    const test = submissionId ? markedNote : photoNotes.length > 0 && photoNotes.every((value) => isMarkedTestText(value));
    const status = derive({ note, transcript, voice: voiceState, generation: generationStatus, draft: Boolean(draft), approved, buffer: draftLog ? bufferDelivery(logs, draftLog.id) : null });
    cards.push({
      id,
      jobId: first.jobId,
      jobName: first.jobName,
      unsorted: first.unsorted,
      test,
      submittedAt,
      title: place || (first.unsorted ? "Unsorted photos" : first.jobName),
      place,
      jobLabel: first.unsorted ? "Unsorted photos" : first.jobName,
      summary: submissionSummary(note, transcript),
      ...status,
      draftId: draftLog?.id ?? null,
      draft,
      photoIds,
      photoCount: items.length,
      websitePhotoCount: items.filter((photo) => photo.onWebsite).length,
    });
  }
  return cards.sort(compareInbox);
}
