"use client";

import { useMemo, useState } from "react";

type AssetOption = {
  id: string;
  label: string;
  url: string;
};

export function BeforeAfterTool({ assets }: { assets: AssetOption[] }) {
  const [beforeId, setBeforeId] = useState(assets[0]?.id ?? "");
  const [afterId, setAfterId] = useState(assets[1]?.id ?? assets[0]?.id ?? "");

  const before = useMemo(() => assets.find((asset) => asset.id === beforeId), [assets, beforeId]);
  const after = useMemo(() => assets.find((asset) => asset.id === afterId), [assets, afterId]);

  const exportPair = async () => {
    if (!before || !after) return;
    const [beforeBlob, afterBlob] = await Promise.all([
      fetch(before.url).then((res) => res.blob()),
      fetch(after.url).then((res) => res.blob()),
    ]);

    const beforeBitmap = await createImageBitmap(beforeBlob);
    const afterBitmap = await createImageBitmap(afterBlob);

    const width = beforeBitmap.width + afterBitmap.width;
    const height = Math.max(beforeBitmap.height, afterBitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(beforeBitmap, 0, 0);
    ctx.drawImage(afterBitmap, beforeBitmap.width, 0);

    ctx.fillStyle = "#111827";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("BEFORE", 24, 36);
    ctx.fillText("AFTER", beforeBitmap.width + 24, 36);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `before-after-${Date.now()}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (assets.length < 2) {
    return <p className="text-xs text-slate-500">Need at least 2 portfolio photos for before/after export.</p>;
  }

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
      <p className="text-sm font-medium text-slate-900">Before / After Pairing</p>
      <div className="grid grid-cols-2 gap-2">
        <select value={beforeId} onChange={(event) => setBeforeId(event.target.value)} className="rounded-xl border border-slate-300 px-2 py-2 text-sm">
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.label}
            </option>
          ))}
        </select>
        <select value={afterId} onChange={(event) => setAfterId(event.target.value)} className="rounded-xl border border-slate-300 px-2 py-2 text-sm">
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" onClick={exportPair} className="rounded-xl bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
        Export side-by-side image
      </button>
    </div>
  );
}
