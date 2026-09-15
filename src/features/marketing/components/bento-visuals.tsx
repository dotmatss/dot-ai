import { Check, Circle, FileText, Globe, Wrench } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Small static illustrations for the bento tiles.
 *
 * Built from the same tokens as the product UI rather than from stock imagery,
 * so the landing page shows the real visual language. All server rendered: no
 * client JavaScript ships for any of them.
 */

export function ChatPreview() {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-4" aria-hidden>
      <div className="max-w-[78%] rounded-lg rounded-tl-sm border border-border bg-surface px-3 py-2 text-xs leading-5 text-foreground-secondary shadow-xs">
        Do you ship to the EU?
      </div>
      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-accent px-3 py-2 text-xs leading-5 text-accent-foreground">
        Yes — EU orders ship in 2–4 days, duties included.
      </div>
      <div className="ml-auto flex max-w-[85%] flex-wrap justify-end gap-1.5">
        {["Shipping policy", "EU duties"].map((source) => (
          <span
            key={source}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-surface px-2 text-caption text-foreground-muted"
          >
            <FileText aria-hidden className="size-3" />
            {source}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ApiPreview() {
  // Terminal ink, fixed in both themes: a code surface reads as a terminal, and
  // the ink scale does not move between themes, so these stay put on purpose.
  // The surrounding border token is what separates it from the dark page.
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900" aria-hidden>
      <div className="flex h-8 items-center border-b border-ink-700 px-3">
        <span className="text-caption font-medium uppercase tracking-wide text-ink-400">POST /api/v1/public/chat</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-caption leading-5 text-ink-200 scrollbar-thin">
        <code>{`curl -N https://app.example.com/api/v1/public/chat \\
  -H "Authorization: Bearer $DOT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"chatbotId":"…","messages":[
       {"role":"user","content":"Do you ship to the EU?"}]}'`}</code>
      </pre>
    </div>
  );
}

export function PipelinePreview() {
  const stages = ["Source", "Chunk", "Embed", "Index", "Retrieve"];
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-hidden>
      {stages.map((stage, index) => (
        <li key={stage} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full border px-2.5 text-caption font-medium",
              index === stages.length - 1
                ? "border-transparent bg-accent text-accent-foreground"
                : "border-border bg-surface text-foreground-muted",
            )}
          >
            {stage}
          </span>
          {index < stages.length - 1 ? <span className="text-foreground-subtle">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function ToolPreview() {
  const tools = [
    { name: "knowledge_search", status: "Simulated" },
    { name: "create_contact", status: "Needs approval" },
  ];
  return (
    <ul className="flex flex-col gap-1.5" aria-hidden>
      {tools.map((tool) => (
        <li key={tool.name} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
          <Wrench aria-hidden className="size-3.5 text-foreground-subtle" />
          <span className="font-mono text-caption text-foreground-secondary">{tool.name}</span>
          <span className="ml-auto inline-flex h-5 items-center rounded-full border border-border bg-surface px-2 text-caption text-foreground-muted">
            {tool.status}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EmbedPreview() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <Globe aria-hidden className="size-3.5 text-foreground-subtle" />
        <span className="font-mono text-caption text-foreground-secondary">www.yoursite.com</span>
        <Check aria-hidden className="ml-auto size-3.5 text-success" />
      </div>
      <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
        <Globe aria-hidden className="size-3.5 text-foreground-subtle" />
        <span className="font-mono text-caption text-foreground-secondary">*.yoursite.com</span>
        <Check aria-hidden className="ml-auto size-3.5 text-success" />
      </div>
    </div>
  );
}

export function WorkflowPreview() {
  const nodes = ["Trigger", "Classify", "Branch", "Respond"];
  return (
    <ol className="flex flex-col gap-1.5" aria-hidden>
      {nodes.map((node, index) => (
        <li key={node} className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
            {index === 0 ? (
              <Circle aria-hidden className="size-2 fill-accent text-accent" />
            ) : (
              <span className="text-caption text-foreground-muted">{index + 1}</span>
            )}
          </span>
          <span className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground-secondary">
            {node}
          </span>
        </li>
      ))}
    </ol>
  );
}
