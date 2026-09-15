import Link from "next/link";
import type { ReactNode } from "react";
import { AppButton } from "@/components/ui/app-button";
import { AppInput } from "@/components/ui/app-input";
import { AppSelect } from "@/components/ui/app-select";
import { AppHeading } from "@/components/ui/app-typography";
import { AppTable, AppTableBody, AppTableCell, AppTableContainer, AppTableHead, AppTableHeader, AppTableRow } from "@/components/ui/app-table";

export function PlatformList({ title, description, path, filters, total, page, pageSize, columns, rows, extraFilters }: {
  title: string; description?: string; path: string; filters: Record<string, string | number | undefined>;
  total: number; page: number; pageSize: number; columns: string[]; rows: { id: string; cells: ReactNode[] }[]; extraFilters?: ReactNode;
}) {
  function pageUrl(next: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined && key !== "pageSize") query.set(key, String(value));
    query.set("page", String(next));
    return { pathname: path, query: Object.fromEntries(query) };
  }
  return <>
    <div className="flex flex-col gap-1">
      <AppHeading level={1}>{title}</AppHeading>
      {description ? <p className="text-sm text-foreground-muted">{description}</p> : null}
    </div>
    <form action={path} className="flex flex-wrap items-end gap-3">
      <label className="min-w-56 flex-1 text-sm">Search<AppInput name="q" type="search" defaultValue={filters.q ?? ""} maxLength={200} /></label>
      {extraFilters}
      <AppButton type="submit">Apply filters</AppButton><Link href={{ pathname: path }} className="text-sm underline">Clear</Link>
    </form>
    <p className="text-sm text-foreground-muted">{total.toLocaleString()} results</p>
    <AppTableContainer><AppTable>
      <AppTableHeader><AppTableRow>{columns.map(column => <AppTableHead key={column}>{column}</AppTableHead>)}</AppTableRow></AppTableHeader>
      <AppTableBody>{rows.length ? rows.map(row => <AppTableRow key={row.id}>{row.cells.map((cell, index) => <AppTableCell key={index}>{cell}</AppTableCell>)}</AppTableRow>) :
        <AppTableRow><AppTableCell colSpan={columns.length}>No results match these filters.</AppTableCell></AppTableRow>}</AppTableBody>
    </AppTable></AppTableContainer>
    <nav aria-label="Pagination" className="flex items-center gap-4 text-sm">
      {page > 1 && <Link href={pageUrl(page - 1)}>Previous</Link>}
      <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
      {page * pageSize < total && <Link href={pageUrl(page + 1)}>Next</Link>}
    </nav>
  </>;
}

export function PlatformFilter({ name, value, options }: { name: string; value?: string; options: string[] }) {
  return <label className="text-sm capitalize">{name}<AppSelect name={name} defaultValue={value ?? ""} placeholder="All" options={options.map(value => ({ value, label: value }))} /></label>;
}
