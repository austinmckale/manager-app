"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type CrewVoiceNote = { id: string; mimeType: string; dataUrl: string };
export function CrewVoiceRecorder({ value, onChange, disabled, onRecordingChange, children }: { value?: CrewVoiceNote | null; onChange: (voice: CrewVoiceNote | null) => void; disabled: boolean; onRecordingChange: (recording: boolean) => void; children?: ReactNode }) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const starting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; if (timer.current) clearTimeout(timer.current); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); }; }, []);
  async function start() {
    if (disabled || starting.current) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError("Recording is unavailable in this browser. Open this link in Safari, or use the microphone on your keyboard below."); return; }
    starting.current = true;
    setRequesting(true);
    onRecordingChange(true);
    let media: MediaStream | undefined;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current) { media?.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64000 });
      recorder.current = next;
      const chunks: Blob[] = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => { if (active.current) { setError("Recording stopped. Please record your note again."); setRecording(false); onRecordingChange(false); } media?.getTracks().forEach((track) => track.stop()); };
      next.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media?.getTracks().forEach((track) => track.stop());
        if (!active.current) return;
        const blob = new Blob(chunks, { type: next.mimeType || mimeType || "audio/mp4" });
        if (!blob.size || blob.size > 2 * 1024 * 1024) { setRecording(false); onRecordingChange(false); setError("Keep the voice note under 90 seconds, then try again."); return; }
        const reader = new FileReader();
        reader.onload = () => { if (active.current) { onChange({ id: crypto.randomUUID(), mimeType: blob.type.split(";")[0], dataUrl: String(reader.result) }); setRecording(false); onRecordingChange(false); } };
        reader.onerror = () => { if (active.current) { setError("Could not save the recording. Please try again."); setRecording(false); onRecordingChange(false); } };
        reader.readAsDataURL(blob);
      };
      next.start(); setRecording(true); onRecordingChange(true);
      timer.current = setTimeout(() => { if (next.state === "recording") next.stop(); }, 90000);
    } catch {
      media?.getTracks().forEach((track) => track.stop());
      if (active.current) { setRecording(false); onRecordingChange(false); setError("Allow microphone access to record your note. You can also dictate with your keyboard microphone below."); }
    } finally { starting.current = false; if (active.current) setRequesting(false); }
  }
  return <section className="mt-5 rounded-2xl border border-[#b4411b]/25 bg-white p-4"><h2 className="font-semibold">Tell us about the job</h2><p className="mt-1 text-sm text-slate-600">Talk into the notes box below to see and fix your words as you go. You can also attach a voice recording.</p>{children}<button type="button" disabled={disabled || requesting} onClick={() => recording ? recorder.current?.stop() : void start()} className={`mt-3 w-full rounded-xl px-4 py-4 font-semibold text-white disabled:opacity-50 ${recording ? "bg-red-700" : "bg-[#b4411b]"}`}>{requesting ? "Opening microphone…" : recording ? "■ Stop recording" : value ? "● Record again" : "● Record a voice note"}</button>{recording ? <p role="status" className="mt-2 text-sm text-red-700">Recording… tap Stop when you’re done. Up to 90 seconds.</p> : null}{value && !recording ? <div className="mt-3"><audio controls src={value.dataUrl} className="w-full" /><button type="button" disabled={disabled} onClick={() => onChange(null)} className="mt-2 text-xs text-slate-500 underline">Remove recording</button><p className="mt-2 text-xs text-slate-500">Recording attached. It is transcribed after upload, so its words do not appear in the notes box automatically. Add any corrections in the box above.</p></div> : null}{error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}</section>;
}
