import {
  Bell,
  FormInput,
  GitBranch,
  Globe,
  MessageSquarePlus,
  MousePointerClick,
  Reply,
  Sparkles,
  Tags,
  UserPlus,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { z } from "zod";

/**
 * The node type registry is the extension seam of the workflow engine: the
 * builder UI, the validator and the executor all read node behaviour from
 * here, so adding a capability means adding one entry instead of touching
 * three layers. Icons are Lucide components so the registry can be read from
 * both Server and Client Components.
 */

export const NODE_CATEGORIES = ["trigger", "input", "ai", "condition", "tool", "action", "output"] as const;
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

export const NODE_CATEGORY_META: Record<NodeCategory, { label: string; description: string }> = {
  trigger: { label: "Triggers", description: "Start a run." },
  input: { label: "Input", description: "Collect values before the run continues." },
  ai: { label: "AI", description: "Generate or classify text with a model." },
  condition: { label: "Logic", description: "Branch on run variables." },
  tool: { label: "Tools", description: "Call an external system." },
  action: { label: "Actions", description: "Change data or notify people." },
  output: { label: "Output", description: "Finish the run with a result." },
};

export const WORKFLOW_NODE_TYPES = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.conversation_started",
  "input.form",
  "ai.generate",
  "ai.classify",
  "condition.branch",
  "tool.http_request",
  "action.create_contact",
  "action.send_notification",
  "output.respond",
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const CONDITION_OPERATORS = ["equals", "contains", "gt", "lt", "exists"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: "equals",
  contains: "contains",
  gt: "is greater than",
  lt: "is less than",
  exists: "has a value",
};

/**
 * Controls the generic configuration form knows how to render. Validation is
 * always the node type configSchema; a descriptor only decides which App*
 * control a field gets, so a canvas builder can reuse the same descriptors.
 */
export type NodeConfigControl = "text" | "template" | "textarea" | "number" | "select" | "switch" | "lines" | "headers";

export interface NodeConfigFieldDescriptor {
  name: string;
  label: string;
  control: NodeConfigControl;
  description?: string;
  placeholder?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface NodePort {
  id: string;
  label: string;
  description: string;
}

export interface NodeTypeDefinition {
  id: WorkflowNodeType;
  category: NodeCategory;
  label: string;
  description: string;
  icon: LucideIcon;
  configSchema: z.ZodObject;
  defaultConfig: Record<string, unknown>;
  fields: ReadonlyArray<NodeConfigFieldDescriptor>;
  inputs: ReadonlyArray<NodePort>;
  outputs: ReadonlyArray<NodePort>;
}

const variableKeySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, { error: "Start with a letter; use letters, numbers and underscores" });

/**
 * Hostnames and IPv4 literals are both accepted here; refusing private and
 * loopback targets is the egress guard's job at run time, so the message the
 * author sees explains the real reason instead of a generic format error.
 */
const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$|^\d{1,3}(\.\d{1,3}){3}$/, {
    error: "Enter a hostname such as api.example.com or *.example.com",
  });

const IN_PORT: NodePort = { id: "in", label: "In", description: "Receives the run from the previous step." };
const NEXT_PORT: NodePort = { id: "next", label: "Next", description: "Continues to the next step." };

const MODEL_FIELD_OPTIONS = [
  { value: "", label: "Workspace default" },
  { value: "fast", label: "Fast (lower cost)" },
  { value: "balanced", label: "Balanced" },
  { value: "quality", label: "Highest quality" },
] as const;

const TEMPLATE_HINT = "Supports {{input.field}}, {{vars.key}}, {{nodes.<id>.text}} and {{trigger.field}} placeholders.";

export const manualTriggerConfigSchema = z.object({
  note: z.string().trim().max(200).default(""),
});

export const webhookTriggerConfigSchema = z.object({
  path: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,60}$/, { error: "Use lowercase letters, numbers and dashes" }),
  requireSignature: z.boolean().default(true),
});

export const conversationTriggerConfigSchema = z.object({
  channel: z.enum(["any", "widget", "api", "playground"]).default("any"),
  keyword: z.string().trim().max(80).default(""),
});

export const formInputConfigSchema = z.object({
  title: z.string().trim().min(1, { error: "Enter a title" }).max(80),
  fields: z.array(variableKeySchema).min(1, { error: "Add at least one field" }).max(20),
});

export const aiGenerateConfigSchema = z.object({
  prompt: z.string().trim().min(1, { error: "Enter a prompt" }).max(8000),
  system: z.string().trim().max(4000).default(""),
  model: z.string().trim().max(100).default(""),
  temperature: z.coerce.number().min(0, { error: "Minimum is 0" }).max(2, { error: "Maximum is 2" }).default(0.3),
  maxTokens: z.coerce
    .number()
    .int()
    .min(64, { error: "Minimum is 64" })
    .max(8192, { error: "Maximum is 8192" })
    .default(1024),
  outputKey: variableKeySchema.default("generated"),
});

export const aiClassifyConfigSchema = z.object({
  input: z.string().trim().min(1, { error: "Enter the text to classify" }).max(4000),
  categories: z
    .array(z.string().trim().min(1).max(60))
    .min(2, { error: "Add at least two categories" })
    .max(20, { error: "Up to 20 categories" }),
  instructions: z.string().trim().max(2000).default(""),
  fallbackCategory: z.string().trim().max(60).default(""),
  model: z.string().trim().max(100).default(""),
  outputKey: variableKeySchema.default("category"),
});

export const branchConfigSchema = z.object({
  left: z.string().trim().min(1, { error: "Enter a value or {{variable}}" }).max(1000),
  operator: z.enum(CONDITION_OPERATORS).default("equals"),
  right: z.string().trim().max(1000).default(""),
  caseSensitive: z.boolean().default(false),
});

export const httpRequestConfigSchema = z.object({
  url: z.string().trim().min(1, { error: "Enter a URL" }).max(2000),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string().trim().min(1).max(100), z.string().max(1000)).default({}),
  bodyTemplate: z.string().max(8000).default(""),
  allowOutbound: z.boolean().default(false),
  allowedHosts: z.array(hostnameSchema).max(20, { error: "Up to 20 hosts" }).default([]),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(1000, { error: "Minimum is 1000ms" })
    .max(15_000, { error: "Maximum is 15000ms" })
    .default(5000),
});

export const createContactConfigSchema = z.object({
  email: z.string().trim().min(1, { error: "Enter an email or {{variable}}" }).max(320),
  name: z.string().trim().max(200).default(""),
  company: z.string().trim().max(200).default(""),
  stage: z.enum(["lead", "prospect", "customer", "churned"]).default("lead"),
  tags: z.array(z.string().trim().min(1).max(40)).max(10, { error: "Up to 10 tags" }).default([]),
});

export const sendNotificationConfigSchema = z.object({
  channel: z.enum(["email", "in_app", "slack"]).default("in_app"),
  to: z.string().trim().min(1, { error: "Enter a recipient" }).max(320),
  subject: z.string().trim().max(200).default(""),
  message: z.string().trim().min(1, { error: "Enter a message" }).max(4000),
});

export const respondConfigSchema = z.object({
  message: z.string().trim().min(1, { error: "Enter the response" }).max(8000),
  outputKey: variableKeySchema.default("message"),
});

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeDefinition> = {
  "trigger.manual": {
    id: "trigger.manual",
    category: "trigger",
    label: "Manual trigger",
    description: "Someone starts the workflow from the dashboard or the API.",
    icon: MousePointerClick,
    configSchema: manualTriggerConfigSchema,
    defaultConfig: { note: "" },
    fields: [
      {
        name: "note",
        label: "Note for the operator",
        control: "text",
        description: "Shown in the run dialog to explain what this workflow does.",
        placeholder: "Qualifies a new lead and creates a contact",
      },
    ],
    inputs: [],
    outputs: [NEXT_PORT],
  },
  "trigger.webhook": {
    id: "trigger.webhook",
    category: "trigger",
    label: "Webhook trigger",
    description: "An external system posts JSON to a workspace endpoint.",
    icon: Webhook,
    configSchema: webhookTriggerConfigSchema,
    defaultConfig: { path: "incoming-lead", requireSignature: true },
    fields: [
      {
        name: "path",
        label: "Path",
        control: "text",
        description: "Appended to the workspace webhook URL.",
        placeholder: "incoming-lead",
      },
      {
        name: "requireSignature",
        label: "Require a signed payload",
        control: "switch",
        description: "Reject requests without a valid signature header.",
      },
    ],
    inputs: [],
    outputs: [NEXT_PORT],
  },
  "trigger.conversation_started": {
    id: "trigger.conversation_started",
    category: "trigger",
    label: "Conversation started",
    description: "A visitor or customer starts a new conversation.",
    icon: MessageSquarePlus,
    configSchema: conversationTriggerConfigSchema,
    defaultConfig: { channel: "any", keyword: "" },
    fields: [
      {
        name: "channel",
        label: "Channel",
        control: "select",
        options: [
          { value: "any", label: "Any channel" },
          { value: "widget", label: "Website widget" },
          { value: "api", label: "API" },
          { value: "playground", label: "Playground" },
        ],
      },
      {
        name: "keyword",
        label: "Only when the first message contains",
        control: "text",
        description: "Leave empty to run for every new conversation.",
        placeholder: "pricing",
      },
    ],
    inputs: [],
    outputs: [NEXT_PORT],
  },
  "input.form": {
    id: "input.form",
    category: "input",
    label: "Collect input",
    description: "Require named values before the run continues.",
    icon: FormInput,
    configSchema: formInputConfigSchema,
    defaultConfig: { title: "Run details", fields: ["email"] },
    fields: [
      { name: "title", label: "Title", control: "text", placeholder: "Lead details" },
      {
        name: "fields",
        label: "Fields",
        control: "lines",
        description: "One field name per line. Values are available as {{input.<name>}}.",
        placeholder: "email",
        rows: 4,
      },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "ai.generate": {
    id: "ai.generate",
    category: "ai",
    label: "Generate text",
    description: "Render a prompt template and collect the model response.",
    icon: Sparkles,
    configSchema: aiGenerateConfigSchema,
    defaultConfig: {
      prompt: "Write a short, friendly reply to: {{input.message}}",
      system: "",
      model: "",
      temperature: 0.3,
      maxTokens: 1024,
      outputKey: "generated",
    },
    fields: [
      {
        name: "prompt",
        label: "Prompt",
        control: "template",
        description: TEMPLATE_HINT,
        rows: 6,
        placeholder: "Answer the question: {{input.question}}",
      },
      {
        name: "system",
        label: "System instructions",
        control: "textarea",
        rows: 3,
        description: "Optional guidance applied before the prompt.",
      },
      {
        name: "model",
        label: "Model",
        control: "select",
        description: "Identifiers are passed to the AI gateway unchanged.",
        options: MODEL_FIELD_OPTIONS,
      },
      { name: "temperature", label: "Temperature", control: "number", min: 0, max: 2, step: 0.1 },
      { name: "maxTokens", label: "Max tokens", control: "number", min: 64, max: 8192, step: 64 },
      { name: "outputKey", label: "Store result as", control: "text", description: "Available downstream as {{vars.key}}." },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "ai.classify": {
    id: "ai.classify",
    category: "ai",
    label: "Classify",
    description: "Pick one of a fixed set of categories for a piece of text.",
    icon: Tags,
    configSchema: aiClassifyConfigSchema,
    defaultConfig: {
      input: "{{trigger.message}}",
      categories: ["qualified", "not_qualified"],
      instructions: "",
      fallbackCategory: "",
      model: "",
      outputKey: "category",
    },
    fields: [
      { name: "input", label: "Text to classify", control: "template", description: TEMPLATE_HINT, rows: 3 },
      { name: "categories", label: "Categories", control: "lines", description: "One category per line; at least two.", rows: 4 },
      {
        name: "instructions",
        label: "Extra instructions",
        control: "textarea",
        rows: 3,
        description: "How to choose between the categories.",
      },
      {
        name: "fallbackCategory",
        label: "Fallback category",
        control: "text",
        description: "Used when the model answer matches no category.",
      },
      { name: "model", label: "Model", control: "select", options: MODEL_FIELD_OPTIONS },
      { name: "outputKey", label: "Store result as", control: "text", description: "Available downstream as {{vars.key}}." },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "condition.branch": {
    id: "condition.branch",
    category: "condition",
    label: "Branch",
    description: "Send the run down one of two paths based on a comparison.",
    icon: GitBranch,
    configSchema: branchConfigSchema,
    defaultConfig: { left: "{{vars.category}}", operator: "equals", right: "qualified", caseSensitive: false },
    fields: [
      { name: "left", label: "Value", control: "template", description: TEMPLATE_HINT, placeholder: "{{vars.category}}" },
      {
        name: "operator",
        label: "Comparison",
        control: "select",
        options: CONDITION_OPERATORS.map((operator) => ({ value: operator, label: CONDITION_OPERATOR_LABELS[operator] })),
      },
      { name: "right", label: "Compare with", control: "template", description: "Ignored when the comparison is “has a value”." },
      { name: "caseSensitive", label: "Case sensitive", control: "switch" },
    ],
    inputs: [IN_PORT],
    outputs: [
      { id: "true", label: "If true", description: "Taken when the comparison succeeds." },
      { id: "false", label: "Otherwise", description: "Taken when the comparison fails." },
    ],
  },
  "tool.http_request": {
    id: "tool.http_request",
    category: "tool",
    label: "HTTP request",
    description: "Call an external endpoint. Simulated unless outbound calls are allowed.",
    icon: Globe,
    configSchema: httpRequestConfigSchema,
    defaultConfig: {
      url: "https://api.example.com/hooks/lead",
      method: "POST",
      headers: {},
      bodyTemplate: "",
      allowOutbound: false,
      allowedHosts: [],
      timeoutMs: 5000,
    },
    fields: [
      {
        name: "url",
        label: "URL",
        control: "template",
        description: TEMPLATE_HINT,
        placeholder: "https://api.example.com/hooks/lead",
      },
      {
        name: "method",
        label: "Method",
        control: "select",
        options: [
          { value: "GET", label: "GET" },
          { value: "POST", label: "POST" },
          { value: "PUT", label: "PUT" },
          { value: "PATCH", label: "PATCH" },
          { value: "DELETE", label: "DELETE" },
        ],
      },
      { name: "headers", label: "Headers", control: "headers", description: "One “Name: value” pair per line.", rows: 3 },
      { name: "bodyTemplate", label: "Body", control: "template", description: TEMPLATE_HINT, rows: 5 },
      {
        name: "allowOutbound",
        label: "Allow real outbound requests",
        control: "switch",
        description: "Off by default: the step records what it would have sent.",
      },
      {
        name: "allowedHosts",
        label: "Allowed hosts",
        control: "lines",
        description: "Required for real requests. One host per line; private and loopback addresses are always refused.",
        rows: 3,
      },
      { name: "timeoutMs", label: "Timeout (ms)", control: "number", min: 1000, max: 15_000, step: 500 },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "action.create_contact": {
    id: "action.create_contact",
    category: "action",
    label: "Create contact",
    description: "Add or update a CRM contact. Simulated in this release.",
    icon: UserPlus,
    configSchema: createContactConfigSchema,
    defaultConfig: { email: "{{input.email}}", name: "", company: "", stage: "lead", tags: [] },
    fields: [
      { name: "email", label: "Email", control: "template", description: TEMPLATE_HINT, placeholder: "{{input.email}}" },
      { name: "name", label: "Name", control: "template" },
      { name: "company", label: "Company", control: "template" },
      {
        name: "stage",
        label: "Stage",
        control: "select",
        options: [
          { value: "lead", label: "Lead" },
          { value: "prospect", label: "Prospect" },
          { value: "customer", label: "Customer" },
          { value: "churned", label: "Churned" },
        ],
      },
      { name: "tags", label: "Tags", control: "lines", description: "One tag per line.", rows: 3 },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "action.send_notification": {
    id: "action.send_notification",
    category: "action",
    label: "Send notification",
    description: "Notify a person or channel. Simulated in this release.",
    icon: Bell,
    configSchema: sendNotificationConfigSchema,
    defaultConfig: { channel: "in_app", to: "team@example.com", subject: "", message: "Workflow finished." },
    fields: [
      {
        name: "channel",
        label: "Channel",
        control: "select",
        options: [
          { value: "in_app", label: "In app" },
          { value: "email", label: "Email" },
          { value: "slack", label: "Slack" },
        ],
      },
      { name: "to", label: "Recipient", control: "template", placeholder: "team@example.com" },
      { name: "subject", label: "Subject", control: "template" },
      { name: "message", label: "Message", control: "template", description: TEMPLATE_HINT, rows: 4 },
    ],
    inputs: [IN_PORT],
    outputs: [NEXT_PORT],
  },
  "output.respond": {
    id: "output.respond",
    category: "output",
    label: "Respond",
    description: "Finish the run with a message returned to the caller.",
    icon: Reply,
    configSchema: respondConfigSchema,
    defaultConfig: { message: "Thanks! We have received your request.", outputKey: "message" },
    fields: [
      { name: "message", label: "Response", control: "template", description: TEMPLATE_HINT, rows: 4 },
      { name: "outputKey", label: "Output key", control: "text", description: "Key used in the run output object." },
    ],
    inputs: [IN_PORT],
    outputs: [],
  },
};

export function isTriggerType(type: WorkflowNodeType): boolean {
  return NODE_TYPES[type].category === "trigger";
}

export function isBranchType(type: WorkflowNodeType): boolean {
  return NODE_TYPES[type].category === "condition";
}

/** Node types grouped for the "add step" picker, in registry order. */
export function nodeTypesByCategory(): Array<{ category: NodeCategory; types: NodeTypeDefinition[] }> {
  return NODE_CATEGORIES.map((category) => ({
    category,
    types: WORKFLOW_NODE_TYPES.map((type) => NODE_TYPES[type]).filter((definition) => definition.category === category),
  })).filter((group) => group.types.length > 0);
}
