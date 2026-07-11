import type { Metadata, Viewport } from "next";
import { siteAppearanceBootScript } from "@/lib/site-branding";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OU-Image Hosting",
    template: "%s · OU-Image Hosting"
  },
  description: "欧记图床：好看、好用、好管理的现代自托管图床。",
  icons: {
    icon: "/brand/ou-image-hosting-logo.jpg",
    apple: "/brand/ou-image-hosting-logo.jpg"
  }
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7F5" },
    { media: "(prefers-color-scheme: dark)", color: "#10100F" }
  ],
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: siteAppearanceBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
