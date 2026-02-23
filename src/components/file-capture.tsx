"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { enqueueUpload, getUploadQueue, removeQueuedUpload, type UploadQueueItem } from "@/lib/client/offline-upload";

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
  const [queueCount, setQueueCount] = useState(0);

  const refreshQueue = useCallback(async () => {
    const queue = await getUploadQueue();
    setQueueCount(queue.length);
  }, []);

  const tryUpload = useCallback(
    async (item: UploadQueueItem) => {
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!response.ok) {
        throw new Error("Upload failed");
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
      } catch {
        break;
      }
    }
  }, [tryUpload]);

  useEffect(() => {
    refreshQueue();
    flushQueue();
    window.addEventListener("online", flushQueue);
    return () => window.removeEventListener("online", flushQueue);
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
          await enqueueUpload(payload);
          await refreshQueue();
        }
      }

      onUploaded?.();
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-900">Capture / Upload</p>
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
      <div className="text-xs text-slate-500">
        {uploading ? "Uploading..." : "Ready"} {queueCount > 0 ? `• ${queueCount} queued offline` : ""}
      </div>
    </div>
  );
}
