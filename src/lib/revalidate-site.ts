/**
 * Notify the public website to bust its portfolio cache.
 * Fires asynchronously -- callers should `.catch(() => {})`.
 */
export async function revalidateSitePortfolio() {
  const url = process.env.SITE_REVALIDATE_URL;
  const secret = process.env.SITE_REVALIDATE_SECRET;
  if (!url || !secret) return;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({
      tags: ["portfolio"],
      paths: ["/projects", "/services"],
    }),
  });
}
