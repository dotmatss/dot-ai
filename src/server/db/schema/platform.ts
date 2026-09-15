import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, check, index, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { credentialType, integrationStatus } from "@/server/db/schema/columns";
import { users } from "@/server/db/schema/identity";
import { workspaces } from "@/server/db/schema/tenancy";

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    name: text("name").notNull(),
    status: integrationStatus("status").notNull().default("disconnected"),
    /** Non-secret configuration only. Secrets live in integration_secrets. */
    config: jsonb("config").notNull().default({}),
    secretRef: text("secret_ref"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    lastTestMessage: text("last_test_message"),
  },
  (table) => [unique("integrations_workspace_id_provider_key").on(table.workspaceId, table.provider)],
);

/**
 * Sealed credential envelopes, AES-256-GCM. Kept in their own table so
 * ciphertext stays out of every list query, and so "which code can read a
 * secret" is answerable by grepping for this table.
 */
export const integrationSecrets = pgTable(
  "integration_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_secrets_integration_idx").on(table.integrationId),
    index("integration_secrets_workspace_idx").on(table.workspaceId),
  ],
);

/**
 * Outbound credentials (migration 0026): what this workspace sends to somebody
 * else's API.
 *
 * The opposite direction to `apiKeys` below, and the reason the two cannot be
 * one table: an inbound key is stored as a hash precisely so the plaintext is
 * unrecoverable, while an outbound credential has to be recoverable or it
 * cannot be sent. Reversible encryption is the requirement here, not a
 * weakening of the other.
 *
 * Nothing secret lives on this row. The sealed envelope is in
 * `workspaceCredentialSecrets`.
 */
export const workspaceCredentials = pgTable(
  "workspace_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: credentialType("type").notNull(),
    /** Set for `header` credentials only; the other kinds imply `Authorization`. */
    headerName: text("header_name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive: a workflow author picking "Stripe" from a list must not
    // have to tell it apart from "stripe".
    uniqueIndex("workspace_credentials_workspace_name_idx").on(table.workspaceId, sql`lower(${table.name})`),
    index("workspace_credentials_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    check(
      "workspace_credentials_header_name_check",
      sql`(type = 'header' AND header_name IS NOT NULL AND length(btrim(header_name)) > 0) OR (type <> 'header' AND header_name IS NULL)`,
    ),
  ],
);

/**
 * Sealed credential envelopes for `workspaceCredentials`, AES-256-GCM.
 *
 * Separate from the row above for the same reason `integrationSecrets` is
 * separate from `integrations`: ciphertext stays out of every list query, and
 * "which code can read a secret" stays answerable by grepping for this table.
 */
export const workspaceCredentialSecrets = pgTable(
  "workspace_credential_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => workspaceCredentials.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_credential_secrets_credential_idx").on(table.credentialId),
    index("workspace_credential_secrets_workspace_idx").on(table.workspaceId),
  ],
);

/**
 * Workspace API keys. Only the hash is stored, next to a short display prefix;
 * the key itself is shown once at creation and never again.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("api_keys_workspace_idx").on(table.workspaceId),
    index("api_keys_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** e.g. 'message', 'tokens_in', 'tokens_out', 'workflow_run', 'embedding'. */
    kind: text("kind").notNull(),
    // Written as SQL rather than a BigInt literal: drizzle-kit serialises the
    // schema to JSON to diff it, and JSON.stringify cannot serialise a BigInt.
    quantity: bigint("quantity", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_events_workspace_time_idx").on(table.workspaceId, table.occurredAt.desc())],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activity_log_workspace_idx").on(table.workspaceId, table.createdAt.desc())],
);
