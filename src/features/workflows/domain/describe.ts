import type { WorkflowNode } from "@/features/workflows/domain/definition";
import {
  aiClassifyConfigSchema,
  aiGenerateConfigSchema,
  branchConfigSchema,
  CONDITION_OPERATOR_LABELS,
  conversationTriggerConfigSchema,
  createContactConfigSchema,
  formInputConfigSchema,
  httpRequestConfigSchema,
  manualTriggerConfigSchema,
  NODE_TYPES,
  respondConfigSchema,
  sendNotificationConfigSchema,
  webhookTriggerConfigSchema,
} from "@/features/workflows/domain/node-types";

/** One-line summary of a step's configuration for the builder list. */

function clip(value: string, max = 70): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function describeNodeConfig(node: WorkflowNode): string {
  const fallback = NODE_TYPES[node.type].description;
  switch (node.type) {
    case "trigger.manual": {
      const parsed = manualTriggerConfigSchema.safeParse(node.config);
      return parsed.success && parsed.data.note.length > 0 ? clip(parsed.data.note) : "Started by a person";
    }
    case "trigger.webhook": {
      const parsed = webhookTriggerConfigSchema.safeParse(node.config);
      return parsed.success ? `POST /webhooks/${parsed.data.path}` : fallback;
    }
    case "trigger.conversation_started": {
      const parsed = conversationTriggerConfigSchema.safeParse(node.config);
      if (!parsed.success) return fallback;
      const channel = parsed.data.channel === "any" ? "any channel" : parsed.data.channel;
      return parsed.data.keyword.length > 0 ? `${channel} · contains “${clip(parsed.data.keyword, 30)}”` : channel;
    }
    case "input.form": {
      const parsed = formInputConfigSchema.safeParse(node.config);
      return parsed.success ? `Collects ${parsed.data.fields.join(", ")}` : fallback;
    }
    case "ai.generate": {
      const parsed = aiGenerateConfigSchema.safeParse(node.config);
      return parsed.success ? clip(parsed.data.prompt) : fallback;
    }
    case "ai.classify": {
      const parsed = aiClassifyConfigSchema.safeParse(node.config);
      return parsed.success ? `Into ${parsed.data.categories.join(" / ")}` : fallback;
    }
    case "condition.branch": {
      const parsed = branchConfigSchema.safeParse(node.config);
      if (!parsed.success) return fallback;
      const { left, operator, right } = parsed.data;
      return clip(
        operator === "exists"
          ? `${left} ${CONDITION_OPERATOR_LABELS[operator]}`
          : `${left} ${CONDITION_OPERATOR_LABELS[operator]} ${right}`,
      );
    }
    case "tool.http_request": {
      const parsed = httpRequestConfigSchema.safeParse(node.config);
      if (!parsed.success) return fallback;
      return `${parsed.data.method} ${clip(parsed.data.url, 48)}${parsed.data.allowOutbound ? "" : " · simulated"}`;
    }
    case "action.create_contact": {
      const parsed = createContactConfigSchema.safeParse(node.config);
      return parsed.success ? `${clip(parsed.data.email, 40)} as ${parsed.data.stage} · simulated` : fallback;
    }
    case "action.send_notification": {
      const parsed = sendNotificationConfigSchema.safeParse(node.config);
      return parsed.success ? `${parsed.data.channel} → ${clip(parsed.data.to, 36)} · simulated` : fallback;
    }
    case "output.respond": {
      const parsed = respondConfigSchema.safeParse(node.config);
      return parsed.success ? clip(parsed.data.message) : fallback;
    }
  }
}
