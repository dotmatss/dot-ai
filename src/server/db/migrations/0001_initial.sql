-- 0001_initial
-- Core identity, tenancy and domain tables.
--
-- Tenant isolation strategy
-- -------------------------
-- 1. Every tenant-scoped table carries workspace_id and repository SQL always
--    filters on it explicitly.
-- 2. Row Level Security policies additionally restrict rows to the workspace
--    named in the transaction-local setting `app.workspace_id`, which the
--    application sets via `withWorkspace()`. Note: PostgreSQL superusers bypass
--    RLS, so use a dedicated non-superuser role in shared environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text,
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Links a user to an external identity provider (e.g. Firebase / Google).
CREATE TABLE user_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  provider_uid text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent  text,
  ip_address  text
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member', 'viewer');

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            member_role NOT NULL DEFAULT 'member',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_id_idx ON organization_members(user_id);

CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workspaces_organization_id_idx ON workspaces(organization_id);

-- ---------------------------------------------------------------------------
-- Knowledge (RAG)
-- ---------------------------------------------------------------------------
CREATE TYPE knowledge_base_status AS ENUM ('empty', 'processing', 'ready', 'error');
CREATE TYPE knowledge_source_type AS ENUM ('url', 'file', 'text');
CREATE TYPE knowledge_source_status AS ENUM (
  'pending', 'ingesting', 'processing', 'chunking', 'embedding', 'indexing', 'ready', 'failed'
);

CREATE TABLE knowledge_bases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  status           knowledge_base_status NOT NULL DEFAULT 'empty',
  embedding_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_bases_workspace_id_idx ON knowledge_bases(workspace_id, updated_at DESC);

CREATE TABLE knowledge_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  type              knowledge_source_type NOT NULL,
  name              text NOT NULL,
  uri               text,
  content           text,
  status            knowledge_source_status NOT NULL DEFAULT 'pending',
  chunk_count       integer NOT NULL DEFAULT 0,
  token_count       integer NOT NULL DEFAULT 0,
  error             text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_sources_kb_idx ON knowledge_sources(knowledge_base_id, created_at DESC);
CREATE INDEX knowledge_sources_workspace_idx ON knowledge_sources(workspace_id);

-- ---------------------------------------------------------------------------
-- Chatbots
-- ---------------------------------------------------------------------------
CREATE TYPE chatbot_status AS ENUM ('draft', 'active', 'paused', 'archived');

CREATE TABLE chatbots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  status          chatbot_status NOT NULL DEFAULT 'draft',
  instructions    text NOT NULL DEFAULT '',
  welcome_message text NOT NULL DEFAULT 'Hi! How can I help you today?',
  model_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  appearance      jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  embed_key       text NOT NULL UNIQUE,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
CREATE INDEX chatbots_workspace_id_idx ON chatbots(workspace_id, updated_at DESC);

CREATE TABLE chatbot_knowledge_bases (
  chatbot_id        uuid NOT NULL REFERENCES chatbots(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (chatbot_id, knowledge_base_id)
);

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------
CREATE TYPE agent_status AS ENUM ('draft', 'active', 'paused', 'archived');

CREATE TABLE agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  status            agent_status NOT NULL DEFAULT 'draft',
  instructions      text NOT NULL DEFAULT '',
  model_config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  tools             jsonb NOT NULL DEFAULT '[]'::jsonb,
  memory_config     jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_schema     jsonb,
  requires_approval boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_workspace_id_idx ON agents(workspace_id, updated_at DESC);

CREATE TABLE agent_knowledge_bases (
  agent_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, knowledge_base_id)
);

-- ---------------------------------------------------------------------------
-- Workflows
-- ---------------------------------------------------------------------------
CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'paused', 'archived');
CREATE TYPE workflow_run_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'waiting_approval');

CREATE TABLE workflows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  status       workflow_status NOT NULL DEFAULT 'draft',
  definition   jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  version      integer NOT NULL DEFAULT 1,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflows_workspace_id_idx ON workflows(workspace_id, updated_at DESC);

CREATE TABLE workflow_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workflow_id  uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status       workflow_run_status NOT NULL DEFAULT 'queued',
  trigger      jsonb NOT NULL DEFAULT '{}'::jsonb,
  input        jsonb,
  output       jsonb,
  steps        jsonb NOT NULL DEFAULT '[]'::jsonb,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_workflow_idx ON workflow_runs(workflow_id, created_at DESC);
CREATE INDEX workflow_runs_workspace_idx ON workflow_runs(workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
CREATE TYPE contact_stage AS ENUM ('lead', 'prospect', 'customer', 'churned');

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        citext,
  name         text,
  phone        text,
  company      text,
  stage        contact_stage NOT NULL DEFAULT 'lead',
  source       text,
  tags         text[] NOT NULL DEFAULT '{}',
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_summary   text,
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contacts_workspace_email_key ON contacts(workspace_id, email) WHERE email IS NOT NULL;
CREATE INDEX contacts_workspace_id_idx ON contacts(workspace_id, updated_at DESC);
CREATE INDEX contacts_tags_idx ON contacts USING gin(tags);

CREATE TABLE contact_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_notes_contact_idx ON contact_notes(contact_id, created_at DESC);

CREATE TABLE contact_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  type         text NOT NULL,
  description  text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_activities_contact_idx ON contact_activities(contact_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
CREATE TYPE conversation_channel AS ENUM ('widget', 'playground', 'api', 'agent');
CREATE TYPE conversation_status AS ENUM ('open', 'resolved', 'escalated');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool');

CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chatbot_id      uuid REFERENCES chatbots(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES agents(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  channel         conversation_channel NOT NULL DEFAULT 'widget',
  status          conversation_status NOT NULL DEFAULT 'open',
  title           text,
  message_count   integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_workspace_idx ON conversations(workspace_id, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_chatbot_idx ON conversations(chatbot_id);
CREATE INDEX conversations_contact_idx ON conversations(contact_id);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            message_role NOT NULL,
  content         text NOT NULL,
  sources         jsonb,
  tool_calls      jsonb,
  usage           jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Integrations, API keys, usage, activity
-- ---------------------------------------------------------------------------
CREATE TYPE integration_status AS ENUM ('connected', 'disconnected', 'error');

CREATE TABLE integrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  name         text NOT NULL,
  status       integration_status NOT NULL DEFAULT 'disconnected',
  -- Non-secret configuration only. Secrets are stored by reference.
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref   text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL UNIQUE,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_workspace_idx ON api_keys(workspace_id);

CREATE TABLE usage_events (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         text NOT NULL,          -- e.g. 'message', 'tokens_in', 'tokens_out', 'workflow_run', 'embedding'
  quantity     bigint NOT NULL DEFAULT 1,
  ref_type     text,
  ref_id       uuid,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_workspace_time_idx ON usage_events(workspace_id, occurred_at DESC);

CREATE TABLE activity_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  action       text NOT NULL,
  summary      text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_log_workspace_idx ON activity_log(workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','organizations','workspaces','knowledge_bases','knowledge_sources','chatbots',
    'agents','workflows','contacts','conversations','integrations'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row Level Security (defense in depth)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'knowledge_bases','knowledge_sources','chatbots','chatbot_knowledge_bases','agents','agent_knowledge_bases',
    'workflows','workflow_runs','contacts','contact_notes','contact_activities','conversations','messages',
    'integrations','api_keys','usage_events','activity_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- When app.workspace_id is unset (system jobs, migrations) the policy is permissive
    -- for the table owner; when set, rows are restricted to that workspace.
    EXECUTE format(
      'CREATE POLICY %I_workspace_isolation ON %I USING (
         current_setting(''app.workspace_id'', true) IS NULL
         OR current_setting(''app.workspace_id'', true) = ''''
         OR workspace_id = current_setting(''app.workspace_id'', true)::uuid
       ) WITH CHECK (
         current_setting(''app.workspace_id'', true) IS NULL
         OR current_setting(''app.workspace_id'', true) = ''''
         OR workspace_id = current_setting(''app.workspace_id'', true)::uuid
       )', t, t);
  END LOOP;
END $$;
