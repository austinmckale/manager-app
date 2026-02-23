"use client";

import { useRef, useState } from "react";

type Tool = "draw" | "box" | "text";

type PhotoAnnotatorProps = {
  imageUrl: string;
  onSave: (file: File) => Promise<void>;
};

export function PhotoAnnotator({ imageUrl, onSave }: PhotoAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("draw");
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  const handleDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setStart({ x, y });
    setDrawing(true);

    if (tool === "text") {
      const text = prompt("Text label");
      if (!text) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(text, x, y);
      setDrawing(false);
    }
  };

  const handleMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !start) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;

    if (tool === "draw") {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      setStart({ x, y });
    }
  };

  const handleUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || !start) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (tool === "box") {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.strokeRect(start.x, start.y, x - start.x, y - start.y);
    }

    setDrawing(false);
    setStart(null);
  };

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    const file = new File([blob], `annotation-${Date.now()}.png`, { type: "image/png" });
    await onSave(file);
  };

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
      <div className="flex gap-2 text-xs">
        <button onClick={() => setTool("draw")} className="rounded border px-2 py-1" type="button">Draw</button>
        <button onClick={() => setTool("box")} className="rounded border px-2 py-1" type="button">Box</button>
        <button onClick={() => setTool("text")} className="rounded border px-2 py-1" type="button">Text</button>
        <button onClick={save} className="ml-auto rounded bg-teal-600 px-3 py-1 text-white" type="button">Save</button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="Source" onLoad={handleLoad} className="hidden" />
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        className="h-auto w-full rounded-xl border border-slate-200"
      />
    </div>
  );
}
