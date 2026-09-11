import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButtonLink } from "@/components/ui/app-button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <AppErrorState
        kind="not-found"
        title="Page not found"
        description="The page you requested does not exist or you do not have access to it."
        action={
          <AppButtonLink href="/" variant="primary" size="sm">
            Back to home
          </AppButtonLink>
        }
      />
    </main>
  );
}
