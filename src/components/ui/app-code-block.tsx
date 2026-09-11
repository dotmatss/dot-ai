"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { AppButton } from "@/components/ui/app-button";
import { cn } from "@/lib/cn";

interface AppCodeBlockProps {
  code: string;
  language?: string;
  label?: string;
  className?: string;
}

export function AppCodeBlock({ code, language, label, className }: AppCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Terminal ink, fixed in both themes. A code block is dark whatever the rest
  // of the app is doing, and the ink scale does not move between themes, so
  // every colour inside this panel is deliberately taken from it rather than
  // from a semantic token. `border-border` is the one exception: it is what
  // separates the panel from the page in the dark theme, where the panel and
  // the surface behind it are close in value.
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-ink-900 text-ink-100", className)}>
      <div className="flex h-9 items-center justify-between border-b border-ink-700 px-3">
        <span className="text-caption font-medium uppercase tracking-wide text-ink-400">{label ?? language ?? "code"}</span>
        <AppButton
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-7 text-ink-300 hover:bg-ink-800 hover:text-white"
          leadingIcon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </AppButton>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-5 scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function AppInlineCode({ children, className }: { children: string; className?: string }) {
  return (
    <code className={cn("rounded-xs bg-surface-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground", className)}>
      {children}
    </code>
  );
}
