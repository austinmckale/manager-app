/**
 * Notify the public website to bust its portfolio cache.
 * Fires asynchronously -- callers should `.catch(() => {})`.
 */
export async function revalidateSitePortfolio() {
  const url = process.env.SITE_REVALIDATE_URL;
  const secret = process.env.SITE_REVALIDATE_SECRET;
  if (!url || !secret) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({
      tags: ["portfolio"],
      paths: ["/projects", "/services"],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Website refresh failed. Photos are saved; the website may take up to an hour to refresh.");
  return true;
}
