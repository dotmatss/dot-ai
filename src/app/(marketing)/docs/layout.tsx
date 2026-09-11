import { DocsSidebar } from "@/features/docs/components/docs-sidebar";

/**
 * Documentation shell: a persistent sidebar on desktop, a disclosure on
 * mobile. The sidebar is the only client component on a docs page besides the
 * search box and the copy buttons.
 */
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="mx-auto w-full max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:px-8 lg:py-12">
      <aside className="mb-8 lg:mb-0">
        <DocsSidebar />
      </aside>
      {children}
    </div>
  );
}
