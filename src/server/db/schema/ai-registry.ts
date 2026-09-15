import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { aiCapability, aiModelStatus, aiProviderKind } from "@/server/db/schema/columns";

/**
 * The platform-owned AI catalogue (migration 0024).
 *
 * Describes what the database already holds; the migration owns the
 * definitions. Nothing in the customer-facing request path reads these tables
 * yet - see the migration header for why connecting them is gated separately.
 *
 * Like the control-plane tables, none of these carries a `workspace_id`: they
 * are global and guarded by `requirePlatformAccess`, not by Row Level Security.
 */

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable identifier for routing. Renaming `name` must not change this. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: aiProviderKind("kind").notNull(),
  /** Off until deliberately configured and enabled. */
  enabled: boolean("enabled").notNull().default(false),
  baseUrl: text("base_url"),
  /** Non-secret configuration only. The credential is in its own table. */
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sealed provider credentials, AES-256-GCM.
 *
 * Separate table so ciphertext stays out of every list query and so "which code
 * can read a provider key" is answerable by grepping this table name - the same
 * reasoning as `integration_secrets`. No display hint is stored.
 */
export const aiProviderCredentials = pgTable("ai_provider_credentials", {
  providerId: uuid("provider_id")
    .primaryKey()
    .references(() => aiProviders.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    /** Sent upstream. Not unique platform-wide: two providers may share a name. */
    providerModelId: text("provider_model_id").notNull(),
    /** Stable platform-facing identifier; survives a display-name edit. */
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    /** What the model CAN do. */
    capabilities: aiCapability("capabilities").array().notNull().default(sql`'{}'`),
    /** What the platform OFFERS it for. Constrained to a subset of the above. */
    availableFor: aiCapability("available_for").array().notNull().default(sql`'{}'`),
    contextWindow: integer("context_window"),
    // numeric, not float: these are multiplied by token counts to produce money.
    // Drizzle returns numeric as a string; callers parse deliberately.
    inputCostPerMtok: numeric("input_cost_per_mtok", { precision: 12, scale: 4 }),
    outputCostPerMtok: numeric("output_cost_per_mtok", { precision: 12, scale: 4 }),
    status: aiModelStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("ai_models_provider_model_key").on(table.providerId, table.providerModelId),
    index("ai_models_provider_idx").on(table.providerId),
    index("ai_models_offered_idx").on(table.status),
    // The database refuses to store a model offered for something it cannot do.
    check("ai_models_available_subset_of_capabilities", sql`available_for <@ capabilities`),
  ],
);

/**
 * Embedding models.
 *
 * Separate from `ai_models` because `dimensions` must match the width of
 * vectors already stored for a collection. Changing an embedding model for
 * existing content is a re-embedding job, not a configuration edit, and this
 * table being distinct is what keeps that from looking like one.
 */
export const embeddingModels = pgTable(
  "embedding_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    providerModelId: text("provider_model_id").notNull(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    dimensions: integer("dimensions").notNull(),
    maxInputTokens: integer("max_input_tokens"),
    costPerMtok: numeric("cost_per_mtok", { precision: 12, scale: 4 }),
    status: aiModelStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("embedding_models_provider_model_key").on(table.providerId, table.providerModelId),
    index("embedding_models_provider_idx").on(table.providerId),
  ],
);
