import { AppFooter } from "@/components/layout/app-footer";
import { MarketingHeader } from "@/features/marketing/components/marketing-header";
import { DemoChatLauncher } from "@/features/public-chatbot/components/demo-chat-launcher";

/**
 * Shell for everything public: the landing page and the documentation. Kept
 * free of session reads so these routes stay statically rendered.
 *
 * The demo launcher is the only interactive thing here. It is a small client
 * component that loads the chat itself on first click, so these pages stay
 * static and ship almost no JavaScript to a visitor who never opens it.
 */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:text-accent-foreground"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <AppFooter />
      <DemoChatLauncher />
    </div>
  );
}
