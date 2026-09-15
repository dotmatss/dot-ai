import { describe, expect, it } from "vitest";

import { buildArticlePrompt, clampArticle, deriveArticleTitle } from "@/features/intelligence/article-prompt";
import { MAX_ARTICLE_CHARS, MAX_TOPIC_LABEL_CHARS } from "@/features/intelligence/constants";
import { buildLabelPrompt, deriveFallbackLabel, parseLabelReply } from "@/features/intelligence/label-prompt";

describe("parseLabelReply", () => {
  it("reads the documented two-line format", () => {
    const parsed = parseLabelReply("LABEL: Refund timing\nSUMMARY: People want to know when money arrives.");
    expect(parsed.label).toBe("Refund timing");
    expect(parsed.summary).toBe("People want to know when money arrives.");
  });

  it("tolerates markdown decoration around the keys", () => {
    const parsed = parseLabelReply("**LABEL:** Refund timing\n**SUMMARY:** Where is my money.");
    expect(parsed.label).toBe("Refund timing");
    expect(parsed.summary).toBe("Where is my money.");
  });

  it("strips quotes and trailing punctuation from a label", () => {
    expect(parseLabelReply('LABEL: "Refund timing."').label).toBe("Refund timing");
  });

  it("ignores a preamble before the format", () => {
    const parsed = parseLabelReply("Sure, here you go:\n\nLABEL: Password resets\nSUMMARY: Locked out users.");
    expect(parsed.label).toBe("Password resets");
  });

  it("returns nulls for prose it does not recognize", () => {
    // The mock gateway replies in prose and will never emit this format, so an
    // unparseable reply has to be an ordinary outcome rather than an error.
    const parsed = parseLabelReply("This is a simulated response from the mock AI gateway.");
    expect(parsed.label).toBeNull();
  });

  it("returns nulls for an empty reply", () => {
    expect(parseLabelReply("   ")).toEqual({ label: null, summary: null });
  });

  it("clips an over-long label", () => {
    const parsed = parseLabelReply(`LABEL: ${"word ".repeat(60)}`);
    expect((parsed.label ?? "").length).toBeLessThanOrEqual(MAX_TOPIC_LABEL_CHARS + 1);
  });
});

describe("deriveFallbackLabel", () => {
  it("prefers the shortest question carrying real words", () => {
    const label = deriveFallbackLabel([
      "I was wondering whether it might be possible to get a refund on my most recent order",
      "How do I get a refund",
      "Refund policy for annual plans and what the window is",
    ]);
    expect(label).toBe("How do I get a refund");
  });

  it("skips questions with too few meaningful words", () => {
    // "help?" is shorter but names nothing.
    const label = deriveFallbackLabel(["help?", "Where do I change my billing address"]);
    expect(label).toBe("Where do I change my billing address");
  });

  it("strips trailing question marks", () => {
    expect(deriveFallbackLabel(["Where is my invoice?"])).toBe("Where is my invoice");
  });

  it("falls back to something readable when every question is trivial", () => {
    expect(deriveFallbackLabel(["hi", "yo"]).length).toBeGreaterThan(0);
  });

  it("never returns an empty string, because the column is NOT NULL", () => {
    expect(deriveFallbackLabel([])).toBe("Unlabelled topic");
    expect(deriveFallbackLabel(["   "])).toBe("Unlabelled topic");
  });

  it("clips a very long question to the label limit", () => {
    const label = deriveFallbackLabel([`${"a".repeat(400)} refund policy`]);
    expect(label.length).toBeLessThanOrEqual(MAX_TOPIC_LABEL_CHARS + 1);
  });
});

describe("buildLabelPrompt", () => {
  it("lists the questions", () => {
    const prompt = buildLabelPrompt(["How do I get a refund", "Refund window?"]);
    expect(prompt).toContain("- How do I get a refund");
    expect(prompt).toContain("- Refund window?");
  });

  it("caps how many questions reach the model", () => {
    const questions = Array.from({ length: 100 }, (_, index) => `Question number ${index}`);
    const lines = buildLabelPrompt(questions).split("\n").filter((line) => line.startsWith("- "));
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  it("collapses whitespace so a pasted transcript cannot reshape the prompt", () => {
    expect(buildLabelPrompt(["How\n\ndo   I\trefund"])).toContain("- How do I refund");
  });
});

describe("buildArticlePrompt", () => {
  const input = {
    topicLabel: "Refund timing",
    topicSummary: "People want to know when money arrives.",
    questions: ["How long do refunds take", "When will I see the money"],
    ungroundedCount: 8,
    conversationCount: 10,
  };

  it("gives the model the volume and the coverage shortfall", () => {
    const prompt = buildArticlePrompt(input);
    expect(prompt).toContain("Topic: Refund timing");
    expect(prompt).toContain("10 conversations");
    expect(prompt).toContain("8 were answered with no supporting document");
  });

  it("omits the summary line when there is none", () => {
    expect(buildArticlePrompt({ ...input, topicSummary: null })).not.toContain("What we know about it");
  });

  it("handles a single conversation without mangling the plural", () => {
    const prompt = buildArticlePrompt({ ...input, conversationCount: 1, ungroundedCount: 1 });
    expect(prompt).toContain("1 conversation,");
  });
});

describe("deriveArticleTitle", () => {
  it("takes the leading markdown heading", () => {
    expect(deriveArticleTitle("# Refund timing\n\nSome scope note.", "Fallback")).toBe("Refund timing");
  });

  it("takes a plain first line", () => {
    expect(deriveArticleTitle("Refund timing\n\nSome scope note.", "Fallback")).toBe("Refund timing");
  });

  it("falls back to the topic label when the article opens with a paragraph", () => {
    const article = `${"This is a long opening paragraph. ".repeat(10)}`;
    expect(deriveArticleTitle(article, "Refund timing")).toBe("Refund timing");
  });

  it("falls back when there is no content at all", () => {
    expect(deriveArticleTitle("   ", "Refund timing")).toBe("Refund timing");
  });
});

describe("clampArticle", () => {
  it("caps what gets stored regardless of what the model returned", () => {
    expect(clampArticle("x".repeat(MAX_ARTICLE_CHARS + 500))).toHaveLength(MAX_ARTICLE_CHARS);
  });

  it("trims surrounding whitespace", () => {
    expect(clampArticle("\n\n  Hello  \n")).toBe("Hello");
  });
});
