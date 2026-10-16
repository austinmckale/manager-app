"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preparePhoto } from "@/lib/client/prepare-photo";
import { useRouter } from "next/navigation";
import {
  enqueueUpload,
  getUploadQueue,
  removeQueuedUpload,
  updateQueuedUpload,
  type UploadQueueItem,
} from "@/lib/client/offline-upload";

type FileCaptureProps = {
  jobId: string;
  fileType?: "PHOTO" | "DOCUMENT" | "RECEIPT";
  photoOnly?: boolean;
  vendorSuggestions?: string[];
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

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function toTagToken(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildAutoCaptureTags(input: { area: string; stage: "BEFORE" | "DURING" | "AFTER" }) {
  const areaToken = toTagToken(input.area);
  const stageToken = toTagToken(input.stage);
  const tags: string[] = [];
  if (areaToken) tags.push(`area:${areaToken}`);
  if (stageToken) tags.push(`stage:${stageToken}`);
  return tags;
}

export function FileCapture({
  jobId,
  fileType = "PHOTO",
  photoOnly = false,
  vendorSuggestions = [],
  expenseId,
  onUploaded,
}: FileCaptureProps) {
  const router = useRouter();
  const lockedType: "PHOTO" | "RECEIPT" | "DOCUMENT" = photoOnly ? "PHOTO" : fileType;
  const modeLocked = photoOnly || fileType !== "PHOTO";
  const [captureMode, setCaptureMode] = useState<CaptureMode>(lockedType === "RECEIPT" ? "RECEIPT" : "PHOTO");

  const [stage, setStage] = useState<"BEFORE" | "DURING" | "AFTER">("DURING");
  const [areaOption, setAreaOption] = useState("");
  const [areaCustom, setAreaCustom] = useState("");
  const [description, setDescription] = useState("");
  const [isClientVisible, setIsClientVisible] = useState(false);

  const [expenseVendor, setExpenseVendor] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryValue | "">("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [uploading, setUploading] = useState(false);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const busy = useRef(false);

  const activeFileType: "PHOTO" | "RECEIPT" | "DOCUMENT" = modeLocked ? lockedType : captureMode;
  const isDocumentMode = modeLocked && lockedType === "DOCUMENT";
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

      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(response.status === 401 || response.redirected ? "Sign in again, then retry your saved photos." : "Upload did not complete. Your photo is saved on this device.");
      }
      const result = await response.json();
      if (!result.ok || result.mode === "demo") throw new Error("Demo preview cannot save photos. Your photo remains on this device.");

      await removeQueuedUpload(item.id);
    },
    [],
  );

  const flushQueue = useCallback(async () => {
    if (!navigator.onLine || busy.current) return;
    busy.current = true;

    try {
    const queue = (await getUploadQueue()).filter((item) => item.jobId === jobId);
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
    } finally { busy.current = false; }
  }, [jobId, refreshQueue, router, tryUpload]);

  useEffect(() => {
    // Read the external network state after mounting; browser events handle changes.
    const timer = setTimeout(() => {
      setIsOnline(navigator.onLine);
      void refreshQueue().catch(() => setErrors(["Device storage is unavailable. Keep your originals and try another browser."]));
      void flushQueue().catch(() => setErrors(["Could not retry saved uploads. Keep this screen open and try again."]));
    }, 0);

    const handleOnline = () => {
      setIsOnline(true);
      void flushQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushQueue, refreshQueue]);

  const scopedQueueItems = useMemo(() => queueItems.filter((item) => item.jobId === jobId), [queueItems, jobId]);
  const queuedErrors = scopedQueueItems.filter((item) => (item.retryCount ?? 0) > 0).length;
  const normalizedVendorSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          vendorSuggestions
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      ).slice(0, 200),
    [vendorSuggestions],
  );
  const vendorDatalistId = `receipt-vendors-${jobId}`;

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0 || busy.current || uploading) return;

    if (isDocumentMode) {
      const invalid = Array.from(files).find((file) => {
        const lower = file.name.toLowerCase();
        return !(lower.endsWith(".pdf") || file.type.toLowerCase().includes("pdf"));
      });
      if (invalid) {
        alert("Joist upload only supports PDF files.");
        return;
      }
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
    busy.current = true;
    setErrors([]);
    setFeedback("");
    let sent = 0;
    let saved = 0;
    const failed: string[] = [];

    try {
      for (const original of Array.from(files)) {
        try {
        setFeedback(`Preparing ${original.name}…`);
        const file = activeFileType === "PHOTO" ? await preparePhoto(original) : original;
        const payload: UploadQueueItem = {
          id: crypto.randomUUID(),
          jobId,
          dataUrl: await fileToDataUrl(file),
          fileName: file.name,
          mimeType: file.type,
          fileType: activeFileType,
          stage: activeFileType === "PHOTO" ? stage : undefined,
          area: activeFileType === "PHOTO" ? selectedArea || "Other" : undefined,
          tags: activeFileType === "PHOTO" ? buildAutoCaptureTags({ area: selectedArea, stage }) : [],
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

        // Persist first: closing the screen during a network request must not lose it.
        await enqueueUpload(payload);
        try {
          if (!navigator.onLine) throw new Error("offline");
          await tryUpload(payload);
          sent += 1;
        } catch (error) {
          saved += 1;
          await updateQueuedUpload(payload.id, (current) => ({ ...current, lastError: error instanceof Error ? error.message : "Waiting for connection", retryCount: 1 }));
        }
        } catch (error) {
          failed.push(`${original.name}: ${error instanceof Error ? error.message : "Could not save photo. Keep the original and try again."}`);
        }
      }

      await refreshQueue();
      onUploaded?.();
      router.refresh();

      if (activeFileType === "RECEIPT") {
        setExpenseAmount("");
        setDescription("");
      }
      setErrors(failed);
      setFeedback(`${sent ? `${sent} uploaded successfully. ` : ""}${saved ? `${saved} saved on this device, waiting to upload. Keep this screen open or return to retry. ` : ""}${failed.length ? `${failed.length} could not be saved. Keep the originals.` : ""}`);
    } finally {
      busy.current = false;
      setUploading(false);
    }
  };

  const acceptValue = activeFileType === "PHOTO" || activeFileType === "RECEIPT" ? "image/*" : ".pdf,application/pdf";

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-900">{isDocumentMode ? "Joist PDF Upload" : activeFileType === "PHOTO" ? "Add job photos" : "Capture / Upload"}</p>

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

      {isDocumentMode ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
          Upload the Joist PDF. We auto-extract estimate/invoice number, customer, address, total, and scope summary for this job.
        </div>
      ) : null}

      {activeFileType === "PHOTO" ? (
        <>
          <label className="block text-xs text-slate-600">
            Room or area (optional)
            <select
              value={areaOption}
              onChange={(event) => setAreaOption(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
            >
              <option value="">Choose later</option>
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

          <label className="block text-xs text-slate-600">When were these taken?
            <select aria-label="Photo stage" value={stage} onChange={(event) => setStage(event.target.value as typeof stage)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm">
              <option value="BEFORE">Before work</option><option value="DURING">Work in progress</option><option value="AFTER">Finished work</option>
            </select>
          </label>
          {!photoOnly ? <details className="rounded-xl border border-slate-200 bg-slate-50/60">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700">
              Advanced photo options
            </summary>
            <div className="space-y-2 border-t border-slate-200 px-3 py-2">
              <label className="block text-xs text-slate-600">
                Stage
                <select
                  value={stage}
                  onChange={(event) => setStage(event.target.value as typeof stage)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="BEFORE">Before</option>
                  <option value="DURING">During</option>
                  <option value="AFTER">After</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={isClientVisible}
                  onChange={(event) => setIsClientVisible(event.target.checked)}
                />
                Client visible
              </label>
            </div>
          </details> : null}
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
                list={normalizedVendorSuggestions.length > 0 ? vendorDatalistId : undefined}
                required
              />
              {normalizedVendorSuggestions.length > 0 ? (
                <datalist id={vendorDatalistId}>
                  {normalizedVendorSuggestions.map((vendor) => (
                    <option key={vendor} value={vendor} />
                  ))}
                </datalist>
              ) : null}
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

      {activeFileType === "PHOTO" ? (
        <p className="text-[11px] text-slate-500">Tags are auto-generated from area and stage.</p>
      ) : null}

      {!isDocumentMode ? (
        <label className="block text-xs text-slate-600">
          {activeFileType === "RECEIPT" ? "Receipt notes (optional)" : "What did you do? (optional)"}
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
            rows={2}
            placeholder={activeFileType === "PHOTO" ? "Type a quick note or use your keyboard’s microphone." : undefined}
          />
        </label>
      ) : null}

      {activeFileType === "PHOTO" ? (
        <p className="text-xs text-slate-500">Photos go to your review queue. They stay off the website until published.</p>
      ) : null}
      {activeFileType === "PHOTO" ? (
        <p className="text-[11px] text-slate-500">Photos are resized for upload. iPhone photos are converted to JPG when supported. Keep your originals.</p>
      ) : null}

      {isDocumentMode ? (
        <label className="block rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700">
          Upload Joist PDF
          <input
            type="file"
            accept={acceptValue}
            className="hidden"
            onChange={(event) => {
              void onFilesSelected(event.target.files).catch(() => setErrors(["Could not save this upload. Keep the original and try again."]));
              event.currentTarget.value = "";
            }}
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-center text-sm font-medium text-teal-700">
            Camera
            <input
              type="file"
              accept={acceptValue}
              capture={activeFileType === "PHOTO" || activeFileType === "RECEIPT" ? "environment" : undefined}
              className="hidden"
              multiple={activeFileType === "PHOTO"}
              disabled={uploading}
              onChange={(event) => {
                void onFilesSelected(event.target.files).catch(() => setErrors(["Could not save these photos. Keep the originals and try again."]));
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
              disabled={uploading}
              onChange={(event) => {
                void onFilesSelected(event.target.files).catch(() => setErrors(["Could not save these photos. Keep the originals and try again."]));
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      )}

      <div role="status" aria-live="polite" className="text-sm text-teal-800">{feedback || (uploading ? "Uploading…" : "Ready when you are.")}</div>
      {errors.length > 0 ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}

      {scopedQueueItems.length > 0 ? (
        <button
          type="button"
          onClick={() => void flushQueue().catch(() => setErrors(["Could not retry uploads. Keep your originals and try again."]))}
          disabled={!isOnline || uploading}
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
