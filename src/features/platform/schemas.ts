import { z } from "zod";

import { MAX_STATUS_REASON_LENGTH } from "@/features/platform/constants";
import { ORGANIZATION_STATUSES } from "@/features/platform/types";
import { MAX_PAGE_SIZE } from "@/types/pagination";

/**
 * Wire schemas for the platform API.
 *
 * Stricter than the URL parsers in `filters.ts`, for the same reason the audit
 * feature is: a stale link should still render a list, while a malformed
 * request that reaches the API is a client bug worth reporting.
 */

export const PLATFORM_PAGE_SIZE = 25;

const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PLATFORM_PAGE_SIZE),
};

export const platformOrganizationListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  ...pageFields,
});

export const platformUserListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum(["active", "disabled"]).optional(),
  ...pageFields,
});

export const platformAuditListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  action: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{1,80}$/, { error: "Unknown action" })
    .optional(),
  result: z.enum(["success", "denied", "error"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  ...pageFields,
});

/**
 * Changing an organization's lifecycle state.
 *
 * A reason is REQUIRED when leaving `active` and forbidden from being blank.
 * Suspending a paying customer is the kind of action that gets questioned
 * weeks later, and an audit row that records only "suspended" answers nothing.
 * Restoring to `active` needs no justification, so the reason is optional there
 * and cleared on write.
 */
export const organizationStatusSchema = z
  .object({
    status: z.enum(ORGANIZATION_STATUSES),
    reason: z.string().trim().max(MAX_STATUS_REASON_LENGTH).optional(),
  })
  .refine((value) => value.status === "active" || Boolean(value.reason && value.reason.length >= 3), {
    error: "A reason of at least 3 characters is required when suspending or disabling an organization",
    path: ["reason"],
  });

export type OrganizationStatusInput = z.infer<typeof organizationStatusSchema>;

/** Same rule as above: taking access away is explained, giving it back is not. */
export const userStateSchema = z
  .object({
    disabled: z.boolean(),
    reason: z.string().trim().max(MAX_STATUS_REASON_LENGTH).optional(),
  })
  .refine((value) => !value.disabled || Boolean(value.reason && value.reason.length >= 3), {
    error: "A reason of at least 3 characters is required when disabling an account",
    path: ["reason"],
  });

export type UserStateInput = z.infer<typeof userStateSchema>;
