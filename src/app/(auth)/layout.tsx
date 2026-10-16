import type { Metadata } from "next";
export const metadata: Metadata = { title: "Sign in | RHI Pros", manifest: "/portal/manifest.webmanifest", appleWebApp: { capable: true, title: "RHI Photos", statusBarStyle: "default" }, icons: { apple: "/send-photos/app-icon.png" } };
export default function AuthLayout({ children }: { children: React.ReactNode }) { return children; }
