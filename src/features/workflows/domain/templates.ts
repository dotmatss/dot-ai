import { EMPTY_DEFINITION, type WorkflowDefinition } from "@/features/workflows/domain/definition";
import { NODE_TYPES } from "@/features/workflows/domain/node-types";

/**
 * Starting points offered in the create dialog. Templates are plain
 * definitions built from registry defaults, so they stay valid whenever a node
 * type gains a config field (a template only overrides what it cares about).
 */

export const WORKFLOW_TEMPLATE_IDS = ["blank", "lead_qualification", "faq_responder"] as const;
export type WorkflowTemplateId = (typeof WORKFLOW_TEMPLATE_IDS)[number];

export interface WorkflowTemplate {
  id: WorkflowTemplateId;
  label: string;
  description: string;
  /** Step summary shown in the dialog so the shape is obvious before creating. */
  outline: string[];
  definition: WorkflowDefinition;
}

function config(type: keyof typeof NODE_TYPES, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(NODE_TYPES[type].defaultConfig), ...overrides };
}

const LEAD_QUALIFICATION: WorkflowDefinition = {
  nodes: [
    {
      id: "conversation",
      type: "trigger.conversation_started",
      label: "New conversation",
      config: config("trigger.conversation_started", { channel: "any" }),
    },
    {
      id: "classify",
      type: "ai.classify",
      label: "Qualify the lead",
      config: config("ai.classify", {
        input: "{{trigger.message}}",
        categories: ["qualified", "not_qualified"],
        instructions: "Answer “qualified” when the visitor describes a concrete business need, a company or a budget.",
        fallbackCategory: "not_qualified",
        outputKey: "category",
      }),
    },
    {
      id: "branch",
      type: "condition.branch",
      label: "Qualified?",
      config: config("condition.branch", { left: "{{vars.category}}", operator: "equals", right: "qualified" }),
    },
    {
      id: "create_contact",
      type: "action.create_contact",
      label: "Create the contact",
      config: config("action.create_contact", {
        email: "{{trigger.email}}",
        name: "{{trigger.name}}",
        company: "{{trigger.company}}",
        stage: "lead",
        tags: ["workflow"],
      }),
    },
    {
      id: "respond",
      type: "output.respond",
      label: "Hand over to sales",
      config: config("output.respond", {
        message: "Thanks! A specialist will follow up shortly.",
        outputKey: "message",
      }),
    },
    {
      id: "nurture",
      type: "output.respond",
      label: "Share resources",
      config: config("output.respond", {
        message: "Thanks for reaching out — here are some resources that should help in the meantime.",
        outputKey: "message",
      }),
    },
  ],
  edges: [
    { id: "e1", from: "conversation", to: "classify" },
    { id: "e2", from: "classify", to: "branch" },
    { id: "e3", from: "branch", to: "create_contact", condition: "true" },
    { id: "e4", from: "create_contact", to: "respond" },
    { id: "e5", from: "branch", to: "nurture", condition: "false" },
  ],
};

const FAQ_RESPONDER: WorkflowDefinition = {
  nodes: [
    {
      id: "conversation",
      type: "trigger.conversation_started",
      label: "New conversation",
      config: config("trigger.conversation_started", { channel: "widget" }),
    },
    {
      id: "answer",
      type: "ai.generate",
      label: "Draft an answer",
      config: config("ai.generate", {
        prompt: "Answer the visitor question using a friendly, concise tone.\n\nQuestion: {{trigger.message}}",
        system: "You are a support assistant. If you are unsure, offer to connect the visitor with a human.",
        outputKey: "answer",
      }),
    },
    {
      id: "respond",
      type: "output.respond",
      label: "Send the answer",
      config: config("output.respond", { message: "{{vars.answer}}", outputKey: "message" }),
    },
  ],
  edges: [
    { id: "e1", from: "conversation", to: "answer" },
    { id: "e2", from: "answer", to: "respond" },
  ],
};

const BLANK: WorkflowDefinition = {
  nodes: [
    {
      id: "manual",
      type: "trigger.manual",
      label: "Manual trigger",
      config: config("trigger.manual"),
    },
  ],
  edges: [],
};

export const WORKFLOW_TEMPLATES: ReadonlyArray<WorkflowTemplate> = [
  {
    id: "blank",
    label: "Blank",
    description: "A manual trigger and nothing else. Build the flow step by step.",
    outline: ["Manual trigger"],
    definition: BLANK,
  },
  {
    id: "lead_qualification",
    label: "Lead qualification",
    description: "Classify an incoming conversation, create a contact for qualified leads and reply.",
    outline: ["Conversation started", "Classify", "Branch", "Create contact", "Respond"],
    definition: LEAD_QUALIFICATION,
  },
  {
    id: "faq_responder",
    label: "FAQ responder",
    description: "Draft an answer to a visitor question with a model and send it back.",
    outline: ["Conversation started", "Generate text", "Respond"],
    definition: FAQ_RESPONDER,
  },
];

export function templateDefinition(id: WorkflowTemplateId): WorkflowDefinition {
  const template = WORKFLOW_TEMPLATES.find((candidate) => candidate.id === id);
  // Cloned so callers can edit the result without mutating the template.
  return structuredClone(template?.definition ?? EMPTY_DEFINITION);
}
