"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  enqueueUpload,
  getUploadQueue,
  removeQueuedUpload,
  updateQueuedUpload,
  type UploadQueueItem,
} from "@/lib/client/offline-upload";
import { SERVICE_TAG_OPTIONS } from "@/lib/service-tags";

type FileCaptureProps = {
  jobId: string;
  fileType?: "PHOTO" | "DOCUMENT" | "RECEIPT";
  expenseId?: string;
  onUploaded?: () => void;
};

type CaptureMode = "PHOTO" | "RECEIPT";
type ExpenseCategoryValue = "MATERIALS" | "SUBCONTRACTOR" | "PERMIT" | "EQUIPMENT" | "MISC";

const AREA_OPTIONS = [
  "Kitchen",
  "Bathroom",
  "Living Area",
  "Bedroom",
  "Roof",
  "Exterior",
  "Garage",
  "Utility",
  "Yard",
  "Other",
] as const;

const EXTRA_CAPTURE_TAGS: Array<{ slug: string; label: string }> = [
  { slug: "tear-out", label: "Tear-out" },
  { slug: "framing", label: "Framing" },
  { slug: "plumbing", label: "Plumbing" },
  { slug: "electrical", label: "Electrical" },
  { slug: "paint", label: "Paint" },
  { slug: "inspection", label: "Inspection" },
];

const CONTROLLED_TAG_OPTIONS = [
  ...SERVICE_TAG_OPTIONS.map((tag) => ({ slug: tag.slug, label: tag.label })),
  ...EXTRA_CAPTURE_TAGS,
];

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function FileCapture({ jobId, fileType = "PHOTO", expenseId, onUploaded }: FileCaptureProps) {
  const router = useRouter();
  const modeLocked = fileType !== "PHOTO";
  const [captureMode, setCaptureMode] = useState<CaptureMode>(fileType === "RECEIPT" ? "RECEIPT" : "PHOTO");

  const [stage, setStage] = useState<"BEFORE" | "DURING" | "AFTER">("DURING");
  const [areaOption, setAreaOption] = useState("");
  const [areaCustom, setAreaCustom] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isClientVisible, setIsClientVisible] = useState(false);

  const [expenseVendor, setExpenseVendor] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryValue | "">("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [uploading, setUploading] = useState(false);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);

  const activeFileType: "PHOTO" | "RECEIPT" | "DOCUMENT" = modeLocked ? fileType : captureMode;
  const selectedArea = areaOption === "Other" ? areaCustom.trim() : areaOption;

  const refreshQueue = useCallback(async () => {
    const queue = await getUploadQueue();
    setQueueItems(queue);
  }, []);

  const tryUpload = useCallback(
    async (item: UploadQueueItem) => {
      await updateQueuedUpload(item.id, (current) => ({
        ...current,
        lastAttemptAt: new Date().toISOString(),
      }));

      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Upload failed");
      }

      await removeQueuedUpload(item.id);
    },
    [],
  );

  const flushQueue = useCallback(async () => {
    if (!navigator.onLine) return;

    const queue = await getUploadQueue();
    for (const item of queue) {
      try {
        await tryUpload(item);
      } catch (error) {
        await updateQueuedUpload(item.id, (current) => ({
          ...current,
          retryCount: (current.retryCount ?? 0) + 1,
          lastError: error instanceof Error ? error.message : "Upload failed",
          lastAttemptAt: new Date().toISOString(),
        }));
      }
    }

    await refreshQueue();
    router.refresh();
  }, [refreshQueue, router, tryUpload]);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    void refreshQueue();
    void flushQueue();

    const handleOnline = () => {
      setIsOnline(true);
      void flushQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushQueue, refreshQueue]);

  const scopedQueueItems = useMemo(() => queueItems.filter((item) => item.jobId === jobId), [queueItems, jobId]);
  const queuedErrors = scopedQueueItems.filter((item) => (item.retryCount ?? 0) > 0).length;

  const toggleTag = (slug: string) => {
    setSelectedTags((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  };

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (activeFileType === "PHOTO" && !selectedArea) {
      alert("Area is required for photos.");
      return;
    }

    const normalizedVendor = expenseVendor.trim();
    const numericAmount = Number(expenseAmount);
    if (activeFileType === "RECEIPT") {
      if (!normalizedVendor) {
        alert("Vendor is required for receipt capture.");
        return;
      }
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        alert("Amount must be greater than zero for receipt capture.");
        return;
      }
    }

    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        const payload: UploadQueueItem = {
          id: crypto.randomUUID(),
          jobId,
          dataUrl: await fileToDataUrl(file),
          fileName: file.name,
          mimeType: file.type,
          fileType: activeFileType,
          stage: activeFileType === "PHOTO" ? stage : undefined,
          area: activeFileType === "PHOTO" ? selectedArea : undefined,
          tags: selectedTags,
          description: description.trim() || undefined,
          isPortfolio: false,
          isClientVisible: activeFileType === "PHOTO" ? isClientVisible : false,
          expenseId,
          expenseVendor: activeFileType === "RECEIPT" ? normalizedVendor : undefined,
          expenseAmount: activeFileType === "RECEIPT" ? numericAmount : undefined,
          expenseCategory: activeFileType === "RECEIPT" ? (expenseCategory || undefined) : undefined,
          expenseDate: activeFileType === "RECEIPT" ? expenseDate : undefined,
          expenseNotes: activeFileType === "RECEIPT" ? description.trim() || undefined : undefined,
        };

        try {
          if (!navigator.onLine) throw new Error("offline");
          await tryUpload(payload);
        } catch {
          await enqueueUpload({
            ...payload,
            retryCount: 0,
          });
        }
      }

      await refreshQueue();
      onUploaded?.();
      router.refresh();

      if (activeFileType === "RECEIPT") {
        setExpenseAmount("");
        setDescription("");
      }
    } finally {
      setUploading(false);
    }
  };

  const acceptValue = activeFileType === "PHOTO" || activeFileType === "RECEIPT" ? "image/*" : "*/*";

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-900">Capture / Upload</p>

      {!modeLocked ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button
            type="button"
            className={`rounded-xl border px-2 py-1.5 ${captureMode === "PHOTO" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
            onClick={() => setCaptureMode("PHOTO")}
          >
            Photo mode
          </button>
          <button
            type="button"
            className={`rounded-xl border px-2 py-1.5 ${captureMode === "RECEIPT" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
            onClick={() => setCaptureMode("RECEIPT")}
          >
            Receipt mode
          </button>
        </div>
      ) : null}

      <div className={`rounded-xl px-3 py-2 text-xs ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {isOnline ? "Online" : "Offline"} - Pending {scopedQueueItems.length}
        {queuedErrors > 0 ? ` - Failed ${queuedErrors}` : ""}
      </div>

      {activeFileType === "PHOTO" ? (
        <>
          <label className="block text-xs text-slate-600">
            Stage
            <select
              value={stage}
              onChange={(event) => setStage(event.target.value as typeof stage)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="BEFORE">Before</option>
              <option value="DURING">During</option>
              <option value="AFTER">After</option>
            </select>
          </label>

          <label className="block text-xs text-slate-600">
            Area (required)
            <select
              value={areaOption}
              onChange={(event) => setAreaOption(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
              required
            >
              <option value="">Select area</option>
              {AREA_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          {areaOption === "Other" ? (
            <label className="block text-xs text-slate-600">
              Area detail
              <input
                value={areaCustom}
                onChange={(event) => setAreaCustom(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
                placeholder="Type custom area"
                required
              />
            </label>
          ) : null}
        </>
      ) : null}

      {activeFileType === "RECEIPT" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">
            Vendor (required)
            <input
              value={expenseVendor}
              onChange={(event) => setExpenseVendor(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
              placeholder="Home Depot / Lowe's / Sub"
              required
            />
          </label>
          <label className="block text-xs text-slate-600">
            Amount (required)
            <input
              value={expenseAmount}
              onChange={(event) => setExpenseAmount(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              required
            />
          </label>
          <label className="block text-xs text-slate-600">
            Category (optional)
            <select
              value={expenseCategory}
              onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategoryValue | "")}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">Uncategorized</option>
              <option value="MATERIALS">Materials</option>
              <option value="SUBCONTRACTOR">Subcontractor</option>
              <option value="PERMIT">Permit</option>
              <option value="EQUIPMENT">Equipment</option>
              <option value="MISC">Misc</option>
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Date
            <input
              value={expenseDate}
              onChange={(event) => setExpenseDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
              type="date"
              required
            />
          </label>
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs text-slate-600">Tags (optional)</p>
        <div className="flex flex-wrap gap-1.5">
          {CONTROLLED_TAG_OPTIONS.map((tag) => {
            const selected = selectedTags.includes(tag.slug);
            return (
              <button
                key={tag.slug}
                type="button"
                onClick={() => toggleTag(tag.slug)}
                className={`rounded-full border px-2 py-1 text-[11px] ${selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block text-xs text-slate-600">
        {activeFileType === "RECEIPT" ? "Receipt notes (optional)" : "Description (optional)"}
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
          rows={2}
        />
      </label>

      {activeFileType === "PHOTO" ? (
        <>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={isClientVisible}
              onChange={(event) => setIsClientVisible(event.target.checked)}
            />
            Client visible
          </label>
          <p className="text-[11px] text-slate-500">Portfolio can be set after upload from the photo grid.</p>
        </>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <label className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-center text-sm font-medium text-teal-700">
          Camera
          <input
            type="file"
            accept={acceptValue}
            capture={activeFileType === "PHOTO" || activeFileType === "RECEIPT" ? "environment" : undefined}
            className="hidden"
            multiple={activeFileType === "PHOTO"}
            onChange={(event) => {
              void onFilesSelected(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>

        <label className="rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700">
          Files
          <input
            type="file"
            accept={acceptValue}
            className="hidden"
            multiple={activeFileType === "PHOTO"}
            onChange={(event) => {
              void onFilesSelected(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <div className="text-xs text-slate-500">{uploading ? "Uploading..." : "Ready"}</div>

      {scopedQueueItems.length > 0 ? (
        <button
          type="button"
          onClick={() => void flushQueue()}
          disabled={!isOnline}
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          Retry Pending Uploads
        </button>
      ) : null}

      {scopedQueueItems.length > 0 ? (
        <div className="space-y-1 rounded-xl bg-slate-50 p-2 text-[11px] text-slate-600">
          {scopedQueueItems.slice(0, 4).map((item) => (
            <p key={item.id}>
              {item.fileName} - tries {item.retryCount ?? 0}
              {item.lastError ? ` - ${item.lastError}` : ""}
            </p>
          ))}
          {scopedQueueItems.length > 4 ? <p>+ {scopedQueueItems.length - 4} more queued</p> : null}
        </div>
      ) : null}
    </div>
  );
}
