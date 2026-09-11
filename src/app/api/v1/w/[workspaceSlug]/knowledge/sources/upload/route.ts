import { createUploadedKnowledgeSource } from "@/features/knowledge/server/knowledge-service";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from "@/features/knowledge/uploads";
import { ApiError } from "@/lib/api/api-error";
import { created } from "@/server/http/responses";
import { workspaceRoute } from "@/server/http/workspace-route";

/**
 * Multipart upload of a single text document.
 *
 * The size is checked from the declared part size *before* the body is read
 * into memory, then again by the service, and the bytes must decode as strict
 * UTF-8. Extension and content type are validated in
 * `@/features/knowledge/uploads`, which the dialog shares so the user hears
 * about a bad file before uploading it.
 *
 * The target collection travels as a form field rather than a query parameter
 * so the whole request is one multipart body; omitting it uploads to
 * Unorganized.
 */
export const POST = workspaceRoute(
  async ({ request, membership, user }) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw ApiError.badRequest("Send the file as multipart/form-data with a “file” field.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw ApiError.validation({ file: ["Choose a file to upload."] });
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      throw ApiError.validation({ file: [`That file is larger than ${UPLOAD_MAX_LABEL}.`] });
    }

    const collectionId = form.get("collectionId");
    const source = await createUploadedKnowledgeSource(
      { workspaceId: membership.workspace.id, userId: user.id },
      typeof collectionId === "string" && collectionId ? collectionId : null,
      { name: file.name, type: file.type, size: file.size, bytes: await file.arrayBuffer() },
    );
    return created(source);
  },
  { minimumRole: "member" },
);
