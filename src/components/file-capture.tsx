"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  expenseId?: string;
  onUploaded?: () => void;
};

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function FileCapture({ jobId, fileType = "PHOTO", expenseId, onUploaded }: FileCaptureProps) {
  const [stage, setStage] = useState<"BEFORE" | "DURING" | "AFTER">("DURING");
  const [area, setArea] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [isClientVisible, setIsClientVisible] = useState(false);
  const [isPortfolio, setIsPortfolio] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [queueItems, setQueueItems] = useState<UploadQueueItem[]>([]);
  const [isOnline, setIsOnline] = useState(true);

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
      await refreshQueue();
      onUploaded?.();
    },
    [onUploaded, refreshQueue],
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
  }, [refreshQueue, tryUpload]);

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

  const parsedTags = useMemo(
    () =>
      tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  );

  const onFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (fileType === "PHOTO" && !area) {
      alert("Area is required for photos.");
      return;
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
          fileType,
          stage: fileType === "PHOTO" ? stage : undefined,
          area: fileType === "PHOTO" ? area : undefined,
          tags: parsedTags,
          description,
          isPortfolio,
          isClientVisible,
          expenseId,
        };

        try {
          if (!navigator.onLine) throw new Error("offline");
          await tryUpload(payload);
        } catch {
          await enqueueUpload({
            ...payload,
            retryCount: 0,
          });
          await refreshQueue();
        }
      }

      onUploaded?.();
    } finally {
      setUploading(false);
    }
  };

  const queuedErrors = queueItems.filter((item) => (item.retryCount ?? 0) > 0).length;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-900">Capture / Upload</p>

      <div className={`rounded-xl px-3 py-2 text-xs ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {isOnline ? "Online" : "Offline"} • Pending {queueItems.length}
        {queuedErrors > 0 ? ` • Failed ${queuedErrors}` : ""}
      </div>

      {fileType === "PHOTO" ? (
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
            <input
              value={area}
              onChange={(event) => setArea(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
              placeholder="Kitchen / Bath / Roof"
              required
            />
          </label>
        </>
      ) : null}

      <label className="block text-xs text-slate-600">
        Tags
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
          placeholder="insurance, drywall, tear-out"
        />
      </label>

      <label className="block text-xs text-slate-600">
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2 text-sm"
          rows={2}
        />
      </label>

      <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isClientVisible}
            onChange={(event) => setIsClientVisible(event.target.checked)}
          />
          Client visible
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPortfolio}
            onChange={(event) => setIsPortfolio(event.target.checked)}
          />
          Add to portfolio
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-center text-sm font-medium text-teal-700">
          Camera
          <input
            type="file"
            accept={fileType === "PHOTO" || fileType === "RECEIPT" ? "image/*" : "*/*"}
            capture="environment"
            className="hidden"
            multiple
            onChange={(event) => onFilesSelected(event.target.files)}
          />
        </label>

        <label className="rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-700">
          Files
          <input
            type="file"
            accept={fileType === "PHOTO" || fileType === "RECEIPT" ? "image/*" : "*/*"}
            className="hidden"
            multiple
            onChange={(event) => onFilesSelected(event.target.files)}
          />
        </label>
      </div>

      <div className="text-xs text-slate-500">{uploading ? "Uploading..." : "Ready"}</div>

      <button
        type="button"
        onClick={() => void flushQueue()}
        disabled={!isOnline || queueItems.length === 0}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        Retry Pending Uploads
      </button>

      {queueItems.length > 0 ? (
        <div className="space-y-1 rounded-xl bg-slate-50 p-2 text-[11px] text-slate-600">
          {queueItems.slice(0, 4).map((item) => (
            <p key={item.id}>
              {item.fileName} • tries {item.retryCount ?? 0}
              {item.lastError ? ` • ${item.lastError}` : ""}
            </p>
          ))}
          {queueItems.length > 4 ? <p>+ {queueItems.length - 4} more queued</p> : null}
        </div>
      ) : null}
    </div>
  );
}

