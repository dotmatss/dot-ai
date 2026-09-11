"use client";

import { MessageCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { DEMO_LAUNCHER_LABEL } from "@/features/public-chatbot/constants";

/**
 * The chat code is loaded on first open, never before.
 *
 * `ssr: false` keeps it out of the server render as well, so a visitor who
 * never clicks pays for this small button and nothing else. That matters here
 * more than anywhere: the landing page is otherwise almost entirely static
 * Server Components.
 */
const DemoChatDialog = dynamic(
  () => import("@/features/public-chatbot/components/demo-chat-dialog").then((module) => module.DemoChatDialog),
  { ssr: false },
);

/**
 * Floating launcher for the public product demo.
 *
 * Mounted once by the marketing layout, so it is present on the landing page
 * and throughout the documentation. It is a plain button: focus, keyboard
 * activation and focus restoration after the dialog closes all come from the
 * platform rather than from bespoke handling.
 */
export function DemoChatLauncher() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const openChat = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={openChat}
        aria-label={DEMO_LAUNCHER_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="group fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-accent bg-accent py-3 pl-4 pr-4 text-sm font-medium text-accent-foreground shadow-lg transition-[transform,background-color] duration-150 ease-[var(--ease-out-soft)] focus-ring hover:border-accent-hover hover:bg-accent-hover active:scale-[0.97] motion-reduce:transition-none sm:bottom-6 sm:right-6 sm:pr-5"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <MessageCircle aria-hidden className="size-5" />
        {/* Hidden on the smallest screens so the launcher never covers content
            it would obscure; the accessible name carries the meaning either way. */}
        <span className="hidden sm:inline">Ask Dot</span>
      </button>

      {mounted ? <DemoChatDialog open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
