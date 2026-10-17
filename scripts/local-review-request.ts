import { request } from "node:http";

// Native HTTP avoids fetch's shorter header deadline while a CPU model encodes
// an image. Fixed loopback host; no credentials, cloud fallback or raw logging.
export function localReviewRequest(body: unknown, port = 11434, timeoutMs = 600000): Promise<{ message?: { content?: string } }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request({ hostname: "127.0.0.1", port, path: "/api/chat", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (response) => {
      let size = 0;
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) { response.destroy(); req.destroy(new Error("Local reviewer response too large")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        if (response.statusCode !== 200) { reject(new Error(`Local reviewer returned HTTP ${response.statusCode}`)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new SyntaxError("Invalid local reviewer response")); }
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error("Local reviewer timed out"), { name: "TimeoutError" })), timeoutMs);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end(payload);
  });
}
