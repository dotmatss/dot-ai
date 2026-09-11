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

/**
 * Effect of running a step, as the executor would perform it today.
 *
 * The preview states this out loud so a diagram can never suggest that a step
 * reached an external system when `execution.ts` would only record what it
 * would have sent. Keep this in step with the simulation branches there.
 */
export type NodeEffect = "none" | "simulated" | "live";

export function describeNodeEffect(node: WorkflowNode): NodeEffect {
  switch (node.type) {
    case "tool.http_request": {
      const parsed = httpRequestConfigSchema.safeParse(node.config);
      // An unparsable config cannot opt in, so it cannot reach the network.
      return parsed.success && parsed.data.allowOutbound ? "live" : "simulated";
    }
    case "action.create_contact":
    case "action.send_notification":
      return "simulated";
    default:
      return "none";
  }
}

export interface NodeDetail {
  label: string;
  value: string;
}

/**
 * A handful of configuration values worth reading in the preview inspector.
 *
 * This is deliberately not the configuration form: it answers "what does this
 * step do" in a few lines. Secrets never appear — header *values* in
 * particular are dropped, because an Authorization header is a credential.
 */
export function describeNodeDetails(node: WorkflowNode): NodeDetail[] {
  switch (node.type) {
    case "trigger.manual": {
      const parsed = manualTriggerConfigSchema.safeParse(node.config);
      return parsed.success && parsed.data.note.length > 0 ? [{ label: "Note", value: clip(parsed.data.note, 120) }] : [];
    }
    case "trigger.webhook": {
      const parsed = webhookTriggerConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Path", value: `/webhooks/${parsed.data.path}` },
        { label: "Signature", value: parsed.data.requireSignature ? "Required" : "Not required" },
      ];
    }
    case "trigger.conversation_started": {
      const parsed = conversationTriggerConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      const details: NodeDetail[] = [
        { label: "Channel", value: parsed.data.channel === "any" ? "Any channel" : parsed.data.channel },
      ];
      if (parsed.data.keyword.length > 0) details.push({ label: "Keyword", value: clip(parsed.data.keyword, 60) });
      return details;
    }
    case "input.form": {
      const parsed = formInputConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Title", value: clip(parsed.data.title, 60) },
        { label: "Fields", value: parsed.data.fields.join(", ") },
      ];
    }
    case "ai.generate": {
      const parsed = aiGenerateConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Model", value: parsed.data.model || "Workspace default" },
        { label: "Prompt", value: clip(parsed.data.prompt, 160) },
        { label: "Stores", value: `{{vars.${parsed.data.outputKey}}}` },
      ];
    }
    case "ai.classify": {
      const parsed = aiClassifyConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Model", value: parsed.data.model || "Workspace default" },
        { label: "Input", value: clip(parsed.data.input, 120) },
        { label: "Categories", value: parsed.data.categories.join(", ") },
        { label: "Stores", value: `{{vars.${parsed.data.outputKey}}}` },
      ];
    }
    case "condition.branch": {
      const parsed = branchConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      const { left, operator, right, caseSensitive } = parsed.data;
      return [
        {
          label: "Test",
          value: clip(
            operator === "exists"
              ? `${left} ${CONDITION_OPERATOR_LABELS[operator]}`
              : `${left} ${CONDITION_OPERATOR_LABELS[operator]} ${right}`,
            120,
          ),
        },
        { label: "Case sensitive", value: caseSensitive ? "Yes" : "No" },
      ];
    }
    case "tool.http_request": {
      const parsed = httpRequestConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      const headerNames = Object.keys(parsed.data.headers);
      const details: NodeDetail[] = [
        { label: "Request", value: `${parsed.data.method} ${clip(parsed.data.url, 80)}` },
        { label: "Timeout", value: `${parsed.data.timeoutMs}ms` },
      ];
      // Names only: a header value is a credential often enough that showing
      // one in a shareable diagram is never worth it.
      if (headerNames.length > 0) details.push({ label: "Headers", value: headerNames.join(", ") });
      if (parsed.data.allowedHosts.length > 0) details.push({ label: "Allowed hosts", value: parsed.data.allowedHosts.join(", ") });
      return details;
    }
    case "action.create_contact": {
      const parsed = createContactConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      const details: NodeDetail[] = [
        { label: "Email", value: clip(parsed.data.email, 80) },
        { label: "Stage", value: parsed.data.stage },
      ];
      if (parsed.data.tags.length > 0) details.push({ label: "Tags", value: parsed.data.tags.join(", ") });
      return details;
    }
    case "action.send_notification": {
      const parsed = sendNotificationConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Channel", value: parsed.data.channel },
        { label: "To", value: clip(parsed.data.to, 80) },
        { label: "Message", value: clip(parsed.data.message, 160) },
      ];
    }
    case "output.respond": {
      const parsed = respondConfigSchema.safeParse(node.config);
      if (!parsed.success) return [];
      return [
        { label: "Response", value: clip(parsed.data.message, 160) },
        { label: "Output key", value: parsed.data.outputKey },
      ];
    }
  }
}
