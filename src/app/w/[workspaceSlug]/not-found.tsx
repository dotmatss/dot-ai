import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageContainer } from "@/components/layout/page-container";
import { AppButtonLink } from "@/components/ui/app-button";

export default function WorkspaceNotFound() {
  return (
    <PageContainer>
      <AppErrorState
        kind="not-found"
        action={
          <AppButtonLink href="/" variant="secondary" size="sm">
            Go to dashboard
          </AppButtonLink>
        }
      />
    </PageContainer>
  );
}
