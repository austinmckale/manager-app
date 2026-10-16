import { z } from "zod";
export const AUDIO_RECEIVED = "field.audio.received";
export const audioNoteSchema = z.object({ token: z.string().max(150), id: z.string().uuid(), submissionId: z.string().uuid(), mimeType: z.enum(["audio/mp4", "audio/webm", "audio/ogg", "audio/wav"]), dataUrl: z.string().max(2900000) });
export function decodeAudioNote(input: z.infer<typeof audioNoteSchema>) {
  if (!input.dataUrl.startsWith(`data:${input.mimeType}`) || !input.dataUrl.includes(";base64,")) throw new Error("Invalid recording format.");
  const bytes = Buffer.from(input.dataUrl.split(";base64,")[1] ?? "", "base64");
  if (bytes.length < 12 || bytes.length > 2 * 1024 * 1024) throw new Error("Recording must be under 2 MB.");
  const valid = input.mimeType === "audio/mp4" ? bytes.subarray(4, 8).toString() === "ftyp" : input.mimeType === "audio/webm" ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : input.mimeType === "audio/ogg" ? bytes.subarray(0, 4).toString() === "OggS" : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE";
  if (!valid) throw new Error("Recording file is invalid.");
  return bytes;
}
