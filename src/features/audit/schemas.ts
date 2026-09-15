import { z } from "zod";

import { AUDIT_PAGE_SIZE } from "@/features/audit/constants";
import { MAX_PAGE_SIZE } from "@/types/pagination";

/**
 * Wire schema for the audit list endpoint.
 *
 * Stricter than `parseAuditFilters`, and deliberately so: the URL parser drops
 * junk so a stale link still renders, while a request that reaches the API with
 * a malformed filter is a client bug and should be told about it.
 */
export const auditListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  actorId: z.uuid().optional(),
  entityType: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/, { error: "Unknown entity type" })
    .optional(),
  action: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/, { error: "Unknown action" })
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(AUDIT_PAGE_SIZE),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
