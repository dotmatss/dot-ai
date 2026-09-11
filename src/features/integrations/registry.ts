import { Building2, Mail, MessageSquare, Sheet, Webhook, Zap, type LucideIcon } from "lucide-react";
import { z } from "zod";

import {
  INTEGRATION_PROVIDERS,
  type IntegrationAvailability,
  type IntegrationCategory,
  type IntegrationProvider,
} from "@/features/integrations/types";
import { isPublicHttpUrl } from "@/features/integrations/url-safety";

/**
 * Catalogue of everything a workspace can connect to.
 *
 * Two rules make this file safe to import from the browser:
 *  - `configSchema` describes NON-SECRET values only. Secret material is
 *    declared by name in `secretFields` and never appears in config, in a query
 *    cache or in an API response.
 *  - the module is a leaf: pure data plus Zod schemas, no server imports, so the
 *    same definitions validate a form on the client and a request body on the
 *    server.
 */

export const WEBHOOK_EVENTS = [
  { value: "conversation.started", label: "Conversation started" },
  { value: "conversation.resolved", label: "Conversation resolved" },
  { value: "message.created", label: "Message created" },
  { value: "contact.created", label: "Contact created" },
  { value: "workflow.run.completed", label: "Workflow run completed" },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["value"];

const WEBHOOK_EVENT_IDS = WEBHOOK_EVENTS.map((event) => event.value) as unknown as readonly [WebhookEvent, ...WebhookEvent[]];

/**
 * Render descriptor for one configuration input. Validation always comes from
 * `configSchema`; this only says how to present the field, because deriving
 * labels and control types from a Zod schema at runtime is brittle. A unit test
 * keeps the two in lockstep.
 */
export interface IntegrationConfigField {
  key: string;
  label: string;
  kind: "text" | "url" | "number" | "checkbox-group";
  description?: string;
  placeholder?: string;
  required?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
}

/** A write-only credential: encrypted at rest, never read back to any client. */
export interface IntegrationSecretField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  required: boolean;
}

export interface IntegrationDefinition {
  readonly id: IntegrationProvider;
  readonly name: string;
  readonly description: string;
  readonly category: IntegrationCategory;
  readonly icon: LucideIcon;
  readonly configSchema: z.ZodObject;
  readonly defaultConfig: Record<string, unknown>;
  readonly configFields: readonly IntegrationConfigField[];
  readonly secretFields: readonly IntegrationSecretField[];
  readonly docsUrl: string;
  readonly status: IntegrationAvailability;
  /** True when the server can verify the connection with one outbound request. */
  readonly testable: boolean;
}

const publicHttpUrl = z
  .string()
  .trim()
  .min(1, { error: "Enter the endpoint URL" })
  .max(2000, { error: "Keep the URL under 2000 characters" })
  .refine(isPublicHttpUrl, {
    error: "Use a public http(s) endpoint on a standard port. Loopback, link-local and private addresses are rejected.",
  });

const eventSelection = z
  .array(z.enum(WEBHOOK_EVENT_IDS))
  .min(1, { error: "Choose at least one event" })
  .max(WEBHOOK_EVENTS.length);

const webhookConfigSchema = z.object({
  url: publicHttpUrl,
  events: eventSelection,
});

const slackConfigSchema = z.object({
  channel: z.string().trim().max(80, { error: "Keep the channel under 80 characters" }).default(""),
  events: eventSelection,
});

/** Zapier authenticates with a workspace API key, so there is nothing else to store. */
const zapierConfigSchema = z.object({});

const emailSmtpConfigSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: "Enter the SMTP host" })
    .max(255)
    .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, { error: "Enter a hostname such as smtp.example.com" }),
  port: z.coerce
    .number({ error: "Enter a port" })
    .int({ error: "Enter a whole number" })
    .min(1, { error: "Minimum is 1" })
    .max(65_535, { error: "Maximum is 65535" }),
  username: z.string().trim().min(1, { error: "Enter the SMTP username" }).max(200),
});

const emptyConfigSchema = z.object({});

export const INTEGRATIONS: Record<IntegrationProvider, IntegrationDefinition> = {
  webhook: {
    id: "webhook",
    name: "Outgoing webhook",
    description: "POST a signed JSON payload to your endpoint whenever the events you choose happen.",
    category: "automation",
    icon: Webhook,
    configSchema: webhookConfigSchema,
    defaultConfig: { url: "", events: ["conversation.resolved"] },
    configFields: [
      {
        key: "url",
        label: "Endpoint URL",
        kind: "url",
        required: true,
        placeholder: "https://example.com/hooks/dot",
        description: "Must be publicly reachable over http or https on a standard port.",
      },
      {
        key: "events",
        label: "Events",
        kind: "checkbox-group",
        required: true,
        options: WEBHOOK_EVENTS,
        description: "Only these events are delivered.",
      },
    ],
    secretFields: [
      {
        key: "signingSecret",
        label: "Signing secret",
        required: false,
        placeholder: "Leave blank to skip signing",
        description: "Deliveries are signed with HMAC-SHA256 in the X-Dot-Signature header so you can verify they came from us.",
      },
    ],
    docsUrl: "https://docs.example.com/integrations/webhooks",
    status: "available",
    testable: true,
  },
  slack: {
    id: "slack",
    name: "Slack",
    description: "Post notifications into a Slack channel through an incoming webhook.",
    category: "messaging",
    icon: MessageSquare,
    configSchema: slackConfigSchema,
    defaultConfig: { channel: "", events: ["conversation.resolved"] },
    configFields: [
      {
        key: "channel",
        label: "Channel",
        kind: "text",
        placeholder: "#support",
        description: "Shown in this list only. The incoming webhook itself decides where messages land.",
      },
      { key: "events", label: "Events", kind: "checkbox-group", required: true, options: WEBHOOK_EVENTS },
    ],
    secretFields: [
      {
        key: "webhookUrl",
        label: "Incoming webhook URL",
        required: true,
        placeholder: "https://hooks.slack.com/services/...",
        // Anyone holding a Slack incoming-webhook URL can post as the app, so it
        // is stored encrypted and never returned, exactly like a password.
        description: "Treated as a secret: encrypted at rest and never shown again.",
      },
    ],
    docsUrl: "https://docs.example.com/integrations/slack",
    status: "available",
    testable: true,
  },
  zapier: {
    id: "zapier",
    name: "Zapier",
    description: "Trigger Zaps from your workspace data using an API key - no extra credentials stored here.",
    category: "automation",
    icon: Zap,
    configSchema: zapierConfigSchema,
    defaultConfig: {},
    configFields: [],
    secretFields: [],
    docsUrl: "https://docs.example.com/integrations/zapier",
    status: "available",
    testable: false,
  },
  email_smtp: {
    id: "email_smtp",
    name: "Email (SMTP)",
    description: "Send transactional email through your own SMTP server instead of the shared sender.",
    category: "email",
    icon: Mail,
    configSchema: emailSmtpConfigSchema,
    defaultConfig: { host: "", port: 587, username: "" },
    configFields: [
      { key: "host", label: "SMTP host", kind: "text", required: true, placeholder: "smtp.example.com" },
      {
        key: "port",
        label: "Port",
        kind: "number",
        required: true,
        min: 1,
        max: 65_535,
        description: "587 for STARTTLS, 465 for implicit TLS.",
      },
      { key: "username", label: "Username", kind: "text", required: true, placeholder: "postmaster@example.com" },
    ],
    secretFields: [{ key: "password", label: "Password", required: true, description: "Encrypted at rest and never shown again." }],
    docsUrl: "https://docs.example.com/integrations/smtp",
    status: "available",
    testable: false,
  },
  google_sheets: {
    id: "google_sheets",
    name: "Google Sheets",
    description: "Append conversations, contacts and workflow results to a spreadsheet.",
    category: "data",
    icon: Sheet,
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    configFields: [],
    secretFields: [],
    docsUrl: "https://docs.example.com/integrations/google-sheets",
    status: "coming_soon",
    testable: false,
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    description: "Sync contacts and conversation summaries with your HubSpot CRM.",
    category: "data",
    icon: Building2,
    configSchema: emptyConfigSchema,
    defaultConfig: {},
    configFields: [],
    secretFields: [],
    docsUrl: "https://docs.example.com/integrations/hubspot",
    status: "coming_soon",
    testable: false,
  },
};

export const INTEGRATION_DEFINITIONS: readonly IntegrationDefinition[] = INTEGRATION_PROVIDERS.map(
  (provider) => INTEGRATIONS[provider],
);

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return Object.prototype.hasOwnProperty.call(INTEGRATIONS, value);
}

export function getIntegrationDefinition(provider: IntegrationProvider): IntegrationDefinition {
  return INTEGRATIONS[provider];
}

/** Keys the provider's Zod schema accepts. Used to keep the render descriptors honest. */
export function configKeysFor(provider: IntegrationProvider): string[] {
  return Object.keys(INTEGRATIONS[provider].configSchema.shape);
}
