import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButtonLink } from "@/components/ui/app-button";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <AppErrorState
        kind="forbidden"
        action={
          <AppButtonLink href="/" variant="secondary" size="sm">
            Back to home
          </AppButtonLink>
        }
      />
    </main>
  );
}
