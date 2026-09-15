import { AppErrorState } from "@/components/feedback/app-error-state";
import { PageContainer } from "@/components/layout/page-container";
import { AppButtonLink } from "@/components/ui/app-button";

/**
 * A refusal inside a workspace, rendered inside the workspace shell.
 *
 * Without this segment the nearest boundary is `src/app/forbidden.tsx`, which
 * is a full-viewport takeover: someone who followed a link their role cannot
 * open would lose the sidebar and be ejected from the workspace entirely.
 * Being told "no" should not also mean being shown the door.
 */
export default function WorkspaceForbidden() {
  return (
    <PageContainer>
      <AppErrorState
        kind="forbidden"
        action={
          <AppButtonLink href="/" variant="secondary" size="sm">
            Go to dashboard
          </AppButtonLink>
        }
      />
    </PageContainer>
  );
}
