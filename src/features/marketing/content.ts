import {
  BarChart3,
  Bot,
  BookOpen,
  Code2,
  Cpu,
  Globe,
  MessagesSquare,
  Plug,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Landing-page copy describes capabilities that exist in the product. Anything
 * still on the roadmap is marked and phrased as such, so the page never
 * promises something a new customer cannot find after signing up.
 */

export interface Capability {
  key: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Column span on the large bento grid (6 columns). */
  span: 2 | 3 | 4 | 6;
  tall?: boolean;
  docsHref?: string;
}

export const CAPABILITIES: Capability[] = [
  {
    key: "chatbots",
    eyebrow: "Chatbots",
    title: "Ship a grounded chatbot in an afternoon",
    description:
      "Write the instructions, attach a knowledge base, try it in the playground, then publish. Replies stream token by token and cite the sources they used.",
    icon: Bot,
    span: 3,
    tall: true,
    docsHref: "/docs/chatbots",
  },
  {
    key: "agents",
    eyebrow: "Agents",
    title: "Agents with tools, memory and a human in the loop",
    description:
      "Give an agent a tool set, a memory window and a structured output shape. Every tool request is shown with its decision, and nothing runs without approval.",
    icon: Cpu,
    span: 3,
    docsHref: "/docs/agents",
  },
  {
    key: "workflows",
    eyebrow: "Workflows",
    title: "Compose triggers, AI steps and conditions",
    description:
      "Build a workflow from typed nodes, validate it before it runs, and read every run as a step-by-step timeline with its inputs, outputs and failures.",
    icon: Workflow,
    span: 3,
    docsHref: "/docs/workflows",
  },
  {
    key: "knowledge",
    eyebrow: "Knowledge",
    title: "RAG that shows its work",
    description:
      "Add text, a URL or a file. Watch it move through ingestion, chunking, embedding and indexing, then test retrieval before a chatbot ever uses it.",
    icon: BookOpen,
    span: 2,
    docsHref: "/docs/knowledge-base",
  },
  {
    key: "api",
    eyebrow: "API",
    title: "Call it from your own application",
    description:
      "A workspace API key and one endpoint. The same streaming contract the widget uses, so your app, your backend and your mobile client all behave alike.",
    icon: Code2,
    span: 4,
    docsHref: "/docs/api/chat",
  },
  {
    key: "embed",
    eyebrow: "Embed",
    title: "Two lines on your website",
    description:
      "Paste a script tag, allow your domains, and the widget appears in your brand colour. No credentials ever reach the page.",
    icon: Globe,
    span: 2,
    docsHref: "/docs/embed",
  },
  {
    key: "conversations",
    eyebrow: "Conversations",
    title: "One inbox for every channel",
    description:
      "Widget, API, playground and agent runs land in the same place, with AI summaries and a reply box when a person should step in.",
    icon: MessagesSquare,
    span: 2,
    docsHref: "/docs/conversations",
  },
  {
    key: "crm",
    eyebrow: "CRM",
    title: "The people behind the conversations",
    description:
      "Contacts, stages, tags, notes and a merged activity timeline, linked to the conversations they came from.",
    icon: Users,
    span: 2,
    docsHref: "/docs/crm",
  },
  {
    key: "analytics",
    eyebrow: "Analytics",
    title: "Know what it costs and what it returns",
    description:
      "Conversations, messages, resolution rate and token spend over time, compared against the period before.",
    icon: BarChart3,
    span: 2,
    docsHref: "/docs/analytics",
  },
  {
    key: "integrations",
    eyebrow: "Integrations",
    title: "Connect the rest of your stack",
    description:
      "Outgoing webhooks, Slack and SMTP today, with credentials encrypted at rest and never returned to the browser.",
    icon: Plug,
    span: 6,
    docsHref: "/docs/integrations",
  },
];

export interface JourneyStep {
  step: string;
  title: string;
  description: string;
}

export const JOURNEY: JourneyStep[] = [
  {
    step: "01",
    title: "Build",
    description: "Create a chatbot or an agent, write its instructions and pick a model. No infrastructure to stand up.",
  },
  {
    step: "02",
    title: "Ground",
    description: "Attach a knowledge base so answers come from your content, with citations back to the source.",
  },
  {
    step: "03",
    title: "Test",
    description: "Run it in the playground against the exact configuration you are about to publish.",
  },
  {
    step: "04",
    title: "Deploy",
    description: "Embed it on your site or call it from your own application with an API key. Same assistant, same contract.",
  },
  {
    step: "05",
    title: "Monitor",
    description: "Read conversations, follow up in the CRM, and watch usage and cost in analytics.",
  },
];
