import { redirect } from "next/navigation";

export default async function WorkspaceIndexPage({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/dashboard`);
}
