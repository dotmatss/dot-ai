import type { Metadata } from "next";

import { siteConfig } from "@/config/site";
import { BentoGrid } from "@/features/marketing/components/bento-grid";
import { CtaSection } from "@/features/marketing/components/cta-section";
import { HeroSection } from "@/features/marketing/components/hero-section";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { IntegrationPaths } from "@/features/marketing/components/integration-paths";

export const metadata: Metadata = {
  title: `${siteConfig.name} — AI chatbots, agents and workflows for your product`,
  description: siteConfig.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    title: `${siteConfig.name} — AI chatbots, agents and workflows`,
    description: siteConfig.description,
    siteName: siteConfig.name,
  },
  twitter: { card: "summary_large_image", title: siteConfig.name, description: siteConfig.description },
};

/**
 * Public landing page. Every section is a Server Component; the only client
 * JavaScript on the page is the copy button inside the code samples.
 */
export default function LandingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: siteConfig.name,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: siteConfig.description,
  };

  return (
    <>
      <HeroSection />

      <section id="capabilities" className="border-b border-border bg-background" aria-labelledby="capabilities-heading">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <p className="text-caption font-medium uppercase tracking-caption text-foreground-muted">Platform</p>
            <h2 id="capabilities-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Everything the assistant needs, in one workspace
            </h2>
            <p className="mt-4 text-base leading-7 text-foreground-secondary">
              Each piece works on its own and they compose: a chatbot can answer from a collection, an agent can call
              a workflow, and every conversation lands in the same inbox and CRM.
            </p>
          </div>
          <BentoGrid className="mt-12" />
        </div>
      </section>

      <div id="integrations">
        <IntegrationPaths />
      </div>

      <HowItWorks />
      <CtaSection />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
