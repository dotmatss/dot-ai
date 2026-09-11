import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Minimal inline markup for prose: `code`, **strong**, [links](/path) and
 * [[PLACEHOLDER]].
 *
 * Deliberately tiny and deliberately not HTML. Everything becomes React
 * elements, so there is no path from content to markup injection, and we avoid
 * pulling an MDX toolchain in for four constructs.
 *
 * `[[PLACEHOLDER]]` exists for the legal pages: a value that must be supplied
 * by the operator and must never be quietly invented. It renders as a marked,
 * announced gap rather than as plausible-looking text, so an unfilled policy
 * cannot be mistaken for a finished one.
 */
// The placeholder alternative comes first so `[[NAME]]` is never mistaken for
// the start of a link.
const TOKEN = /(\[\[[A-Z0-9_]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
// A separate, non-global copy: `test` on a global regex advances lastIndex, so
// reusing TOKEN for both splitting and testing would skip every other token.
const IS_TOKEN = /^(\[\[[A-Z0-9_]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))$/;

function renderToken(token: string, key: number): ReactNode {
  if (token.startsWith("[[") && token.endsWith("]]")) {
    const name = token.slice(2, -2);
    return (
      <mark
        key={key}
        // Not styled as a highlight for decoration: this is an unresolved
        // value, and it should be impossible to read past it by accident.
        className="rounded-xs border border-warning-border bg-warning-bg px-1.5 py-0.5 font-mono text-[0.85em] font-medium text-foreground"
      >
        <span className="sr-only">Placeholder, to be completed: </span>
        {name}
      </mark>
    );
  }

  if (token.startsWith("`") && token.endsWith("`")) {
    return (
      <code key={key} className="rounded-xs bg-surface-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
        {token.slice(1, -1)}
      </code>
    );
  }

  if (token.startsWith("**") && token.endsWith("**")) {
    return (
      <strong key={key} className="font-semibold text-foreground">
        {token.slice(2, -2)}
      </strong>
    );
  }

  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
  if (link?.[1] && link[2]) {
    const [, label, href] = link;
    const isExternal = /^https?:\/\//.test(href);
    const className =
      "font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-foreground focus-ring rounded-xs";

    if (isExternal) {
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={className}>
          {label}
        </a>
      );
    }
    return (
      <Link key={key} href={href as Route} className={className}>
        {label}
      </Link>
    );
  }

  return token;
}

export function InlineText({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter((part) => part !== "");
  return <>{parts.map((part, index) => (IS_TOKEN.test(part) ? renderToken(part, index) : part))}</>;
}
