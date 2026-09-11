import { AppErrorState } from "@/components/feedback/app-error-state";
import { AppButtonLink } from "@/components/ui/app-button";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <AppErrorState
        kind="unauthorized"
        action={
          <AppButtonLink href="/sign-in" variant="primary" size="sm">
            Sign in
          </AppButtonLink>
        }
      />
    </main>
  );
}
