import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FieldFlow Manager",
    short_name: "FieldFlow",
    description: "Lightweight job management for contractors.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0f766e",
    orientation: "portrait",
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
