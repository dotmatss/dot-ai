import { MessageSquareOff } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppEmptyState } from "@/components/feedback/app-empty-state";
import { EmbedWidget } from "@/features/embed/components/embed-widget";
import { resolveEmbed } from "@/features/embed/server/embed-service";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

function Unavailable({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex h-dvh items-center justify-center bg-surface px-4">
      <AppEmptyState icon={<MessageSquareOff aria-hidden />} title={title} description={description} size="sm" />
    </main>
  );
}

/**
 * The page loaded inside the customer-site iframe. Access is decided on the
 * server from the parent page origin (Referer) and the chatbot configuration.
 */
export default async function EmbedPage({ params }: PageProps<"/embed/[embedKey]">) {
  const { embedKey } = await params;
  const referer = (await headers()).get("referer");
  const resolution = await resolveEmbed(embedKey, referer);

  switch (resolution.kind) {
    case "not_found":
      return <Unavailable title="Chat unavailable" description="This chat assistant does not exist or has been removed." />;
    case "inactive":
      return <Unavailable title="Chat is currently offline" description="The assistant is not accepting messages right now. Please check back later." />;
    case "origin_not_allowed":
      return (
        <Unavailable
          title="This site is not allowed to use the chat"
          description="The website embedding this assistant is not on its allowed-domain list."
        />
      );
    case "ready":
      return <EmbedWidget config={resolution.config} token={resolution.token} preview={resolution.preview} />;
  }
}
