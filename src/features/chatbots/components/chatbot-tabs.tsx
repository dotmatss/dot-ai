"use client";

import type { Route } from "next";

import { AppTabNav } from "@/components/ui/app-tabs";
import { useWorkspace } from "@/features/workspaces/components/workspace-provider";

export function ChatbotTabs({ chatbotId }: { chatbotId: string }) {
  const { membership } = useWorkspace();
  const base = `/w/${membership.workspace.slug}/chatbots/${chatbotId}`;
  return (
    <AppTabNav
      label="Chatbot sections"
      items={[
        { href: base as Route, label: "Overview" },
        { href: `${base}/instructions` as Route, label: "Instructions" },
        { href: `${base}/knowledge` as Route, label: "Knowledge" },
        { href: `${base}/appearance` as Route, label: "Appearance" },
        { href: `${base}/playground` as Route, label: "Playground" },
        { href: `${base}/deploy` as Route, label: "Deploy" },
        { href: `${base}/settings` as Route, label: "Settings" },
      ]}
    />
  );
}
