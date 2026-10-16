import { redirect } from "next/navigation";

export default async function HomePage() {
  const { clientPortalUser } = await import("@/lib/client-portal");
  if (await clientPortalUser()) redirect("/portal");
  redirect("/marketing");
}
