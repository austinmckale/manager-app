"use client";

export function RetryDeliveryButton({ deliveryId }: { deliveryId: string }) {
  return (
    <button
      type="button"
      className="text-sm underline"
      onClick={async () => {
        const response = await fetch("/api/publishing/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deliveryId }),
        });
        if (response.ok) window.location.reload();
      }}
    >
      Retry
    </button>
  );
}
