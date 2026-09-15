import { Bot, Cpu, Workflow, type LucideIcon } from "lucide-react";

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
  /** Occupies the full height of the grid rather than a single row. */
  tall?: boolean;
  docsHref?: string;
}

export const CAPABILITIES: Capability[] = [
  {
    key: "chatbots",
    eyebrow: "Chatbots",
    title: "Ship a grounded chatbot in an afternoon",
    description:
      "Write the instructions, attach a collection, try it in the playground, then publish. Replies stream token by token and cite the sources they used.",
    icon: Bot,
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
    docsHref: "/docs/agents",
  },
  {
    key: "workflows",
    eyebrow: "Workflows",
    title: "Compose triggers, AI steps and conditions",
    description:
      "Build a workflow from typed nodes, validate it before it runs, and read every run as a step-by-step timeline with its inputs, outputs and failures.",
    icon: Workflow,
    docsHref: "/docs/workflows",
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
    description: "Attach a collection so answers come from your content, with citations back to the source.",
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

export interface FaqItem {
  key: string;
  question: string;
  answer: string;
  /** Optional pointer to the page that answers the question in full. */
  link?: { href: string; label: string };
}

/**
 * Questions a visitor asks before signing up, answered against what the
 * product does today. Where the honest answer is "not yet", it says so and
 * links to the page that keeps the detail current, rather than restating it
 * here where it would drift.
 */
export const FAQS: FaqItem[] = [
  {
    key: "what",
    question: "What can I actually build with it?",
    answer:
      "Three things, in one workspace: a chatbot that answers from your content, an agent that can use tools to get something done, and a workflow that runs a sequence of steps off a trigger. They compose, so an agent can call a workflow, and whatever happens lands in the same inbox.",
    link: { href: "/docs/concepts", label: "How the pieces fit together" },
  },
  {
    key: "code",
    question: "Do I need to write code?",
    answer:
      "Not for the common case. Create a chatbot, attach a collection, then paste a two-line script tag on your site. The API is there for when you want the assistant inside your own product instead of beside it, and it is the same assistant either way.",
    link: { href: "/docs/embed", label: "Embedding guide" },
  },
  {
    key: "grounding",
    question: "How does it know anything about my business?",
    answer:
      "You add content to a knowledge collection as text, a URL or a file. You can watch it move through ingestion, chunking, embedding and indexing, and test retrieval before a chatbot ever uses it. Answers cite the sources they came from, so you can check them instead of trusting them.",
    link: { href: "/docs/knowledge", label: "Knowledge and retrieval" },
  },
  {
    key: "models",
    question: "Which models can I use?",
    answer:
      "The ones the platform catalogue offers your workspace, which covers OpenAI, Anthropic and Google directly, plus OpenRouter, Azure OpenAI and custom gateways. You choose the model per chatbot and per agent, and changing it does not mean rebuilding anything around it.",
  },
  {
    key: "handoff",
    question: "What happens when it cannot answer?",
    answer:
      "The conversation reaches the inbox like every other one, with an AI summary of what was asked, and a person can read the thread and reply in the same place. Widget, API, playground and agent runs all arrive there, so there is nowhere for a question to go missing.",
    link: { href: "/docs/conversations", label: "Conversations and handover" },
  },
  {
    key: "agents",
    question: "Can an agent take actions, or only talk?",
    answer:
      "It can take actions. An agent is given a tool set, a memory window and a structured output shape, and every tool request is shown alongside the decision behind it. Nothing runs without approval, so you see what it intends to do before it does it.",
    link: { href: "/docs/agents", label: "Agents and tools" },
  },
  {
    key: "isolation",
    question: "Is my data separated from other customers?",
    answer:
      "Yes, and the separation is enforced in the database rather than trusted to application code. Every tenant query runs inside a transaction pinned to your workspace, with PostgreSQL row-level security policies on top of it. Integration credentials are encrypted at rest and never returned to the browser.",
    link: { href: "/privacy", label: "What we store, and why" },
  },
  {
    key: "cost",
    question: "What does it cost?",
    answer:
      "Nothing today. Billing is not implemented, no payment details are collected, and usage is measured but never invoiced. The pricing page shows the shape we are working towards and marks every value that is still undecided rather than guessing at it.",
    link: { href: "/pricing", label: "See the plans" },
  },
];
