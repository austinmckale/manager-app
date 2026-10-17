"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WebsiteProject } from "@/lib/website-projects";

type WebsiteProjectCard = Pick<WebsiteProject, "id" | "slug" | "jobId" | "name" | "location" | "description" | "photoCount"> & { imageUrl?: string | null; imageAlt?: string };

export function WebsiteProjectList({ projects, featuredId }: { projects: WebsiteProjectCard[]; featuredId?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const ordered = [...projects].sort((a, b) => Number(b.id === featuredId) - Number(a.id === featuredId));

  async function start(project: WebsiteProjectCard) {
    if (pending) return;
    if (!project.jobId) {
      router.push(`/marketing/connections?website=${project.slug}`);
      return;
    }
    setPending(project.jobId);
    setError("");
    try {
      const response = await fetch("/api/marketing/website-project", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: project.jobId }) });
      const body = (await response.json().catch(() => null)) as { error?: string; draftId?: string } | null;
      if (!response.ok || !body?.draftId) { setError(body?.error || "The draft could not be saved. The website project is unchanged."); return; }
      router.push(`/marketing/connections?draftId=${body.draftId}`);
      router.refresh();
    } catch {
      setError("The draft could not be saved. Check the project and try again.");
    } finally { setPending(""); }
  }

  if (!projects.length) return <section className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">Website projects show up here after their photos are on the website. New uploads stay separate.</section>;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">Website projects</h3>
        <p className="mt-1 text-sm text-slate-600">These are projects already on the website, with their town and description. An older one is suggested with new drafts so posts are not only the latest upload. Choosing one fills the preview. It is not posted from this list.</p>
      </div>
      {ordered.map((project) => (
        <article key={project.id} className={`rounded-2xl border p-4 ${project.id === featuredId ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white"}`}>
          {project.id === featuredId ? <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Suggested from the website</p> : null}
          <h4 className="mt-1 font-semibold">{project.name}</h4>
          <p className="mt-1 text-sm text-slate-600">{`${project.location || "Location not listed"} · ${project.photoCount} website photo${project.photoCount === 1 ? "" : "s"}`}</p>
          {project.imageUrl ? <img src={project.imageUrl} alt={project.imageAlt || project.name} className="mt-3 aspect-video w-full rounded-xl object-cover" /> : null}
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{project.description || "No description is stored for this project yet."}</p>
          {project.jobId ? (
            <button type="button" disabled={Boolean(pending)} aria-busy={pending === project.jobId} onClick={() => void start(project)} className="mt-3 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">{pending === project.jobId ? "Saving draft…" : "Use for a post"}</button>
          ) : (
            <Link href={`/marketing/connections?website=${project.slug}`} className="mt-3 inline-block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Use for a post</Link>
          )}
        </article>
      ))}
      {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
    </section>
  );
}
