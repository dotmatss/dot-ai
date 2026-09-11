import { AppDetailSkeleton } from "@/components/feedback/app-loading";
import { PageContainer } from "@/components/layout/page-container";

export default function ConversationDetailLoading() {
  return (
    <PageContainer aria-busy="true">
      <AppDetailSkeleton />
    </PageContainer>
  );
}
