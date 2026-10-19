import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RHI Pros Manager",
    short_name: "RHI Pros",
    description: "Job photos, posts, leads and jobs for RHI Pros.",
    // The home page sends the owner to the marketing inbox and a client to their portal.
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    orientation: "any",
    shortcuts: [
      { name: "Add job photos", short_name: "Photos", url: "/capture" },
      { name: "Review photos", short_name: "Review", url: "/marketing" },
    ],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
