import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Composable table primitives. Data shaping (sorting, filtering, pagination)
 * lives in feature code; these components only own presentation.
 */
export function AppTableContainer({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("w-full overflow-x-auto rounded-lg border border-border bg-surface shadow-xs scrollbar-thin", className)}
      {...props}
    />
  );
}

export function AppTable({ className, ...props }: ComponentPropsWithoutRef<"table">) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function AppTableHeader({ className, ...props }: ComponentPropsWithoutRef<"thead">) {
  return <thead className={cn("bg-surface-muted/60 [&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function AppTableBody({ className, ...props }: ComponentPropsWithoutRef<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

interface AppTableRowProps extends ComponentPropsWithoutRef<"tr"> {
  interactive?: boolean;
}

export function AppTableRow({ className, interactive, ...props }: AppTableRowProps) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors",
        interactive && "cursor-pointer hover:bg-surface-hover",
        className,
      )}
      {...props}
    />
  );
}

export function AppTableHead({ className, ...props }: ComponentPropsWithoutRef<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "h-10 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-foreground-muted [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

export function AppTableCell({ className, ...props }: ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-4 py-3 align-middle text-foreground [&:has([role=checkbox])]:pr-0", className)} {...props} />;
}

export function AppTableCaption({ className, ...props }: ComponentPropsWithoutRef<"caption">) {
  return <caption className={cn("mt-3 text-xs text-foreground-muted", className)} {...props} />;
}

/** Single full-width row used for empty / loading / error content inside a table. */
export function AppTableMessageRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        {children}
      </td>
    </tr>
  );
}
