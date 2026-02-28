import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FieldFlow Manager",
  description: "Mobile-first job management for contractors",
  applicationName: "FieldFlow Manager",
  icons: {
    icon: [{ url: "/brand/chat-logo.png", type: "image/png" }],
    shortcut: [{ url: "/brand/chat-logo.png", type: "image/png" }],
    apple: [{ url: "/brand/chat-logo.png", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FieldFlow",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
