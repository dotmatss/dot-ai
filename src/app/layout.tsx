import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";

import { AppProviders } from "@/components/layout/app-providers";
import { ThemeScript } from "@/components/layout/theme-script";
import { siteConfig } from "@/config/site";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // One entry per scheme so the browser chrome matches the painted theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // Resize the layout viewport when the on-screen keyboard opens, so a
  // full-height dialog measured in `dvh` keeps its composer above the keyboard
  // instead of behind it. Without this, mobile browsers leave the layout
  // viewport at full height and only pan, hiding the input the user is typing in.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning is scoped to this element on purpose: the boot
    // script below sets `class` and `style` on <html> before React hydrates, so
    // the server markup and the live DOM differ here by design. It suppresses
    // nothing inside <body>.
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
