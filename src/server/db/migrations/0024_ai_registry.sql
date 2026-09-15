-- 0024_ai_registry
--
-- The platform-owned AI catalogue: which providers exist, which models they
-- expose, what those models can do, and which of those capabilities the
-- platform actually offers to customers.
--
-- ── What this migration does NOT do ─────────────────────────────────────────
--
-- It does not change how a single AI request is made today. Nothing here is
-- read by the agent engine, the chatbot runtime or the knowledge pipeline yet:
-- `MODEL_OPTIONS` in the agents and chatbots features still supplies the UI,
-- and `getAiGateway()` still resolves from environment variables.
--
-- That separation is deliberate. Making this catalogue authoritative over what
-- a customer may select changes what EXISTING stored configurations validate
-- against - `agents.model_config.model` and `chatbots.model_config.model` are
-- free text today - and that is a breaking change to the AI provider
-- architecture and to customer data contracts. It is gated separately. This
-- migration establishes the registry; a later one connects it.
--
-- ── Tenancy ─────────────────────────────────────────────────────────────────
--
-- Platform-owned, like everything in 0023: no `workspace_id`, therefore no
-- `*_workspace_isolation` policy and nothing for the RLS convention test to
-- enumerate. Authorization is `requirePlatformAccess`.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

-- Extensible by design: adding a provider is a new enum value plus a row, not
-- a new table or a branch in feature code.
CREATE TYPE ai_provider_kind AS ENUM (
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'azure_openai',
  'gateway',
  'custom'
);

-- What a *completion* model can do. Embeddings are deliberately absent: they
-- have their own table because they carry a dimension count that has to match
-- a stored vector, which no completion capability does.
CREATE TYPE ai_capability AS ENUM (
  'chat',
  'agent',
  'tool_calling',
  'structured_output',
  'vision',
  'reranking'
);

CREATE TYPE ai_model_status AS ENUM ('active', 'deprecated', 'disabled');

-- ---------------------------------------------------------------------------
-- Providers
-- ---------------------------------------------------------------------------
--
-- `enabled` defaults to FALSE. A provider row with no credential cannot serve
-- traffic, so defaulting it on would create a registry entry that looks usable
-- and is not. Enabling is a deliberate act after configuration.
--
-- `base_url` and `config` hold NON-SECRET configuration only. The credential
-- lives in its own table, for the same reason `integration_secrets` is separate
-- from `integrations`: ciphertext stays out of every list query, and "which
-- code can read a provider key" is answerable by grepping one table name.
CREATE TABLE ai_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  kind        ai_provider_kind NOT NULL,
  enabled     boolean NOT NULL DEFAULT false,
  base_url    text,
  config      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Provider credentials
-- ---------------------------------------------------------------------------
--
-- AES-256-GCM envelopes written by the existing `sealSecret` helper, bound by
-- additional authenticated data to `platform:ai-provider:<id>`. That context
-- differs from the workspace integration context, so a ciphertext lifted from
-- a customer's `integration_secrets` row cannot be opened here, and vice versa.
--
-- No display hint is stored - not even the last four characters. The UI shows
-- "Configured", never a fragment of the key.
CREATE TABLE ai_provider_credentials (
  provider_id uuid PRIMARY KEY REFERENCES ai_providers(id) ON DELETE CASCADE,
  ciphertext  text NOT NULL,
  iv          text NOT NULL,
  tag         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Completion models
-- ---------------------------------------------------------------------------
--
-- Two capability columns, and the difference between them is the whole point:
--
--   capabilities   what the model CAN do, as a fact about the upstream model
--   available_for  what this PLATFORM offers it for, always a subset
--
-- The CHECK enforces the subset relation in the database. An operator cannot
-- offer a text-only model for vision by ticking a box, because the row would
-- not be storable. Widening what the platform offers therefore requires first
-- asserting that the model supports it - which is the explicit, visible
-- override the capability rules ask for, rather than a silent one.
--
-- `provider_id` is ON DELETE RESTRICT: removing a provider that still has
-- models must be a deliberate two-step act, not a cascade that quietly empties
-- the catalogue customers select from.
CREATE TABLE ai_models (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id          uuid NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  -- The identifier sent upstream, e.g. 'gpt-4o-mini'. Not unique platform-wide:
  -- two providers can legitimately expose the same upstream name.
  provider_model_id    text NOT NULL,
  -- The stable platform-facing identifier. This is what a future routing table
  -- and any stored customer selection would reference, so it must not change
  -- when a display name is edited.
  slug                 text NOT NULL UNIQUE,
  display_name         text NOT NULL,
  capabilities         ai_capability[] NOT NULL DEFAULT '{}',
  available_for        ai_capability[] NOT NULL DEFAULT '{}',
  context_window       integer CHECK (context_window IS NULL OR context_window > 0),
  -- Cost per million tokens, in USD. numeric, never float: these values are
  -- multiplied by token counts to produce money, and binary floating point
  -- accumulates error over a billing period.
  input_cost_per_mtok  numeric(12, 4) CHECK (input_cost_per_mtok IS NULL OR input_cost_per_mtok >= 0),
  output_cost_per_mtok numeric(12, 4) CHECK (output_cost_per_mtok IS NULL OR output_cost_per_mtok >= 0),
  status               ai_model_status NOT NULL DEFAULT 'active',
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_models_provider_model_key UNIQUE (provider_id, provider_model_id),
  CONSTRAINT ai_models_available_subset_of_capabilities CHECK (available_for <@ capabilities)
);

CREATE INDEX ai_models_provider_idx ON ai_models (provider_id);
-- Serves "what may customers select", the question the catalogue exists to answer.
CREATE INDEX ai_models_offered_idx ON ai_models (status) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Embedding models
-- ---------------------------------------------------------------------------
--
-- A separate registry rather than a capability on `ai_models`, because
-- `dimensions` is not descriptive metadata: it must match the width of the
-- vectors already stored for a collection. Changing the embedding model for
-- existing content is a re-embedding job, never a configuration edit, and
-- keeping this table distinct is what stops that looking like one.
CREATE TABLE embedding_models (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id       uuid NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  provider_model_id text NOT NULL,
  slug              text NOT NULL UNIQUE,
  display_name      text NOT NULL,
  dimensions        integer NOT NULL CHECK (dimensions > 0),
  max_input_tokens  integer CHECK (max_input_tokens IS NULL OR max_input_tokens > 0),
  cost_per_mtok     numeric(12, 4) CHECK (cost_per_mtok IS NULL OR cost_per_mtok >= 0),
  status            ai_model_status NOT NULL DEFAULT 'active',
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embedding_models_provider_model_key UNIQUE (provider_id, provider_model_id)
);

CREATE INDEX embedding_models_provider_idx ON embedding_models (provider_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance, matching the convention from 0001
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_providers', 'ai_provider_credentials', 'ai_models', 'embedding_models'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END $$;
