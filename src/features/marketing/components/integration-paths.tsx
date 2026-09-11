import { ArrowUpRight, Code2, Globe } from "lucide-react";
import Link from "next/link";

import { AppCodeBlock } from "@/components/ui/app-code-block";

const EMBED_SNIPPET = `<script
  src="https://app.example.com/embed/widget.js"
  data-chatbot="cb_YOUR_EMBED_KEY"
  async
></script>`;

const API_SNIPPET = `const response = await fetch(
  "https://app.example.com/api/v1/public/chat",
  {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.DOT_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatbotId: "YOUR_CHATBOT_ID",
      messages: [{ role: "user", content: "Do you ship to the EU?" }],
    }),
  },
);

// Server-sent events: the same stream the widget consumes.
for await (const event of readChatStream(response)) {
  if (event.type === "text-delta") process.stdout.write(event.delta);
}`;

/**
 * The two supported deployment paths, side by side.
 *
 * This is a product decision made visible: the embed and the API are the same
 * assistant behind the same streaming contract, so choosing one does not close
 * the other off.
 */
export function IntegrationPaths() {
  return (
    <section className="border-b border-border bg-surface" aria-labelledby="integration-paths-heading">
      <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-caption font-medium uppercase tracking-[0.08em] text-foreground-muted">Deployment</p>
          <h2 id="integration-paths-heading" className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Two ways to reach your customers
          </h2>
          <p className="mt-4 text-base leading-7 text-foreground-secondary">
            Put the assistant on your website, or call it from whatever you already run. Both paths hit the same chatbot,
            the same knowledge and the same streaming response.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <article className="flex flex-col rounded-xl border border-border bg-background p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
                <Globe aria-hidden className="size-4" />
              </span>
              <h3 className="text-base font-semibold">Website embed</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground-secondary">
              For a marketing site, a help centre or a product page. Paste the script, list the domains that may use it,
              and the widget matches your brand colour. Nothing secret ever reaches the page.
            </p>
            <div className="mt-5">
              <AppCodeBlock code={EMBED_SNIPPET} language="html" label="index.html" />
            </div>
            <Link
              href="/docs/embed"
              className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-ring rounded-xs"
            >
              Embedding guide
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </article>

          <article className="flex flex-col rounded-xl border border-border bg-background p-6">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface text-foreground-secondary">
                <Code2 aria-hidden className="size-4" />
              </span>
              <h3 className="text-base font-semibold">API</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground-secondary">
              For your own frontend, a backend service, a mobile app or an internal tool. Authenticate with a workspace
              API key; the key identifies the tenant, so your code never names one.
            </p>
            <div className="mt-5">
              <AppCodeBlock code={API_SNIPPET} language="ts" label="server.ts" />
            </div>
            <Link
              href="/docs/api/chat"
              className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-ring rounded-xs"
            >
              API reference
              <ArrowUpRight aria-hidden className="size-4" />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
