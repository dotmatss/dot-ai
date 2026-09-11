import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a workspace name" }).max(60),
  organizationId: z.uuid(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter a workspace name" }).max(60),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
