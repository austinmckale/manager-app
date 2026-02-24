/**
 * Send server-side conversion events to GA4 via the Measurement Protocol.
 * This closes the loop: you can see which ads/pages produce actual revenue,
 * not just form fills.
 *
 * Set GA4_MEASUREMENT_ID and GA4_API_SECRET in .env to enable.
 * Get the API secret from: GA4 Admin > Data Streams > your stream > Measurement Protocol API secrets
 */

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

interface ConversionEvent {
  leadId: string;
  jobId: string;
  contactName: string;
  serviceType: string | null;
  conversionValue?: number;
  currency?: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export async function sendGA4ConversionEvent(event: ConversionEvent) {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) return;

  const clientId = `server.${event.leadId}`;

  const payload = {
    client_id: clientId,
    events: [
      {
        name: "lead_converted",
        params: {
          lead_id: event.leadId,
          job_id: event.jobId,
          service_type: event.serviceType ?? "general",
          value: event.conversionValue ?? 0,
          currency: event.currency ?? "USD",
          utm_source: event.utmSource ?? "",
          utm_medium: event.utmMedium ?? "",
          utm_campaign: event.utmCampaign ?? "",
        },
      },
    ],
  };

  try {
    const url = `${GA4_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("[ga4-server] failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[ga4-server] error:", err);
  }
}
