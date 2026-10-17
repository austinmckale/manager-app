"use client";
import { useState } from "react";

export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <span><button
      type="button"
      disabled={pending}
      className="text-sm underline"
      onClick={async () => {
        setPending(true); setMessage("");
        try {
        const response = await fetch("/api/publishing/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliveryId }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.ok) { setMessage(result?.error || "Retry did not complete. Check the delivery status."); return; }
        if (result.mode === "mock") setMessage("Simulation saved. Nothing was posted.");
        else window.location.reload();
        } catch { setMessage("Retry could not complete. Check status before trying again."); }
        finally { setPending(false); }
      }}
    >
      {pending ? "Checking approval…" : "Retry"}
    </button>{message ? <span role="status" className="ml-2 text-xs">{message}</span> : null}</span>
  );
}
