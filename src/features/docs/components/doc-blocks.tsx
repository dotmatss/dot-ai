import { AppAlert } from "@/components/ui/app-alert";
import { AppBadge } from "@/components/ui/app-badge";
import { AppCodeBlock } from "@/components/ui/app-code-block";
import {
  AppTable,
  AppTableBody,
  AppTableCell,
  AppTableContainer,
  AppTableHead,
  AppTableHeader,
  AppTableRow,
} from "@/components/ui/app-table";
import { InlineText } from "@/features/docs/components/inline-text";
import type { DocBlock } from "@/features/docs/types";

const METHOD_TONE = {
  GET: "info",
  POST: "success",
  PATCH: "warning",
  DELETE: "danger",
} as const;

/**
 * Renders one documentation block.
 *
 * Every block reuses a product primitive — the same code block, alert and table
 * the dashboard uses — so the docs cannot drift visually from the application
 * they describe.
 */
function Block({ block }: { block: DocBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <h2 id={block.id} className="group mt-12 scroll-mt-24 text-xl font-semibold tracking-tight first:mt-0">
          <a href={`#${block.id}`} className="rounded-xs focus-ring">
            {block.text}
            <span aria-hidden className="ml-2 text-foreground-subtle opacity-0 transition-opacity group-hover:opacity-100">
              #
            </span>
          </a>
        </h2>
      );

    case "paragraph":
      return (
        <p className="mt-4 text-[15px] leading-7 text-foreground-secondary">
          <InlineText text={block.text} />
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={
            block.ordered
              ? "mt-4 flex list-decimal flex-col gap-2 pl-5 text-[15px] leading-7 text-foreground-secondary marker:text-foreground-subtle"
              : "mt-4 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-7 text-foreground-secondary marker:text-foreground-subtle"
          }
        >
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineText text={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case "code":
      return (
        <div className="mt-5">
          <AppCodeBlock code={block.code} language={block.language} label={block.label} />
        </div>
      );

    case "callout":
      return (
        <div className="mt-6">
          <AppAlert tone={block.tone} title={block.title}>
            <InlineText text={block.body} />
          </AppAlert>
        </div>
      );

    case "endpoint":
      return (
        <div className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <AppBadge tone={METHOD_TONE[block.method]} variant="soft" size="sm">
              {block.method}
            </AppBadge>
            <code className="font-mono text-sm text-foreground">{block.path}</code>
            <span className="ml-auto text-xs text-foreground-muted">{block.auth}</span>
          </div>
          <p className="px-4 py-3 text-sm leading-6 text-foreground-secondary">
            <InlineText text={block.summary} />
          </p>
        </div>
      );

    case "table":
      return (
        <div className="mt-6">
          <AppTableContainer>
            <AppTable>
              <AppTableHeader>
                <AppTableRow>
                  {block.head.map((cell) => (
                    <AppTableHead key={cell}>{cell}</AppTableHead>
                  ))}
                </AppTableRow>
              </AppTableHeader>
              <AppTableBody>
                {block.rows.map((row, rowIndex) => (
                  <AppTableRow key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <AppTableCell key={cellIndex} className="align-top text-sm leading-6 text-foreground-secondary">
                        <InlineText text={cell} />
                      </AppTableCell>
                    ))}
                  </AppTableRow>
                ))}
              </AppTableBody>
            </AppTable>
          </AppTableContainer>
        </div>
      );

    case "steps":
      return (
        <ol className="mt-6 flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
          {block.items.map((item, index) => (
            <li key={item.title} className="flex gap-4 bg-surface p-5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-accent-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1 text-sm leading-6 text-foreground-secondary">
                  <InlineText text={item.body} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case "divider":
      return <hr className="mt-10 border-border" />;

    default:
      return null;
  }
}

export function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <div>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
