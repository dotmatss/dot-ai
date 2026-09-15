import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_GAP_COVERAGE_THRESHOLD,
  KNOWLEDGE_GAP_MIN_CONVERSATIONS,
} from "@/features/intelligence/constants";
import {
  containmentRate,
  coverageRate,
  deriveOutcome,
  escalationRate,
  formatRate,
  isGrounded,
  isKnowledgeGap,
  knowledgeGapScore,
  overviewContainmentRate,
  rate,
} from "@/features/intelligence/metrics";

const topic = (conversationCount: number, grounded: number, contained = 0, escalated = 0) => ({
  conversationCount,
  groundedCount: grounded,
  containedCount: contained,
  escalatedCount: escalated,
});

describe("deriveOutcome", () => {
  it("counts a resolved thread nobody touched as contained", () => {
    expect(deriveOutcome({ status: "resolved", humanReplyCount: 0 })).toBe("contained");
  });

  it("treats a human reply as a hand-off even when the thread was resolved", () => {
    // The property the whole containment metric rests on: inbox hygiene must
    // not be able to inflate the assistant's deflection rate.
    expect(deriveOutcome({ status: "resolved", humanReplyCount: 1 })).toBe("handed_off");
  });

  it("treats a human reply as a hand-off even when the thread was escalated", () => {
    expect(deriveOutcome({ status: "escalated", humanReplyCount: 2 })).toBe("handed_off");
  });

  it("reports an escalation nobody has answered yet", () => {
    expect(deriveOutcome({ status: "escalated", humanReplyCount: 0 })).toBe("escalated");
  });

  it("reports an untouched open thread as unresolved", () => {
    expect(deriveOutcome({ status: "open", humanReplyCount: 0 })).toBe("unresolved");
  });
});

describe("isGrounded", () => {
  it("is true when any reply cited a source", () => {
    expect(isGrounded(1)).toBe(true);
    expect(isGrounded(12)).toBe(true);
  });

  it("is false when nothing was cited", () => {
    expect(isGrounded(0)).toBe(false);
  });
});

describe("rate", () => {
  it("returns 0 rather than NaN when there is nothing to divide by", () => {
    expect(rate(0, 0)).toBe(0);
    expect(rate(5, 0)).toBe(0);
  });

  it("clamps out-of-range inputs instead of reporting over 100%", () => {
    expect(rate(12, 10)).toBe(1);
    expect(rate(-3, 10)).toBe(0);
  });

  it("divides normally", () => {
    expect(rate(1, 4)).toBe(0.25);
  });
});

describe("topic rates", () => {
  it("computes containment, coverage and escalation from the counters", () => {
    const value = topic(10, 4, 7, 2);
    expect(containmentRate(value)).toBe(0.7);
    expect(coverageRate(value)).toBe(0.4);
    expect(escalationRate(value)).toBe(0.2);
  });

  it("reports an empty topic as zero across the board", () => {
    const value = topic(0, 0, 0, 0);
    expect(containmentRate(value)).toBe(0);
    expect(coverageRate(value)).toBe(0);
    expect(escalationRate(value)).toBe(0);
  });
});

describe("isKnowledgeGap", () => {
  it("ignores topics below the volume floor however badly covered", () => {
    // Coverage over one conversation is 0 or 1, so without the floor every new
    // topic would report as a total gap.
    expect(isKnowledgeGap(topic(KNOWLEDGE_GAP_MIN_CONVERSATIONS - 1, 0))).toBe(false);
  });

  it("flags a topic at or below the coverage threshold", () => {
    expect(isKnowledgeGap(topic(10, 5))).toBe(true);
    expect(isKnowledgeGap(topic(10, 0))).toBe(true);
  });

  it("does not flag a well-covered topic", () => {
    expect(isKnowledgeGap(topic(10, 9))).toBe(false);
  });

  it("uses the same threshold the constant declares", () => {
    const atThreshold = Math.floor(10 * KNOWLEDGE_GAP_COVERAGE_THRESHOLD);
    expect(isKnowledgeGap(topic(10, atThreshold))).toBe(true);
    expect(isKnowledgeGap(topic(10, atThreshold + 1))).toBe(false);
  });
});

describe("knowledgeGapScore", () => {
  it("ranks volume above severity", () => {
    // 50 conversations at 40% coverage is more documentation work worth doing
    // than 4 at 0%, which is the ordering the topic list sorts by.
    expect(knowledgeGapScore(topic(50, 20))).toBeGreaterThan(knowledgeGapScore(topic(4, 0)));
  });

  it("scores topics under the volume floor as zero so sorting is enough", () => {
    expect(knowledgeGapScore(topic(KNOWLEDGE_GAP_MIN_CONVERSATIONS - 1, 0))).toBe(0);
  });

  it("reduces to conversations minus grounded, which is what the SQL sorts on", () => {
    // The repository sorts by `conversation_count - grounded_count`. If this
    // identity ever stops holding, the list order and this score disagree.
    for (const [total, grounded] of [
      [10, 4],
      [50, 20],
      [7, 7],
      [3, 0],
    ] as const) {
      expect(knowledgeGapScore(topic(total, grounded))).toBeCloseTo(total - grounded, 10);
    }
  });
});

describe("overviewContainmentRate", () => {
  it("divides contained conversations by everything analyzed", () => {
    expect(overviewContainmentRate({ containedCount: 30, conversationsAnalyzed: 120 })).toBe(0.25);
  });

  it("is zero before anything has been analyzed", () => {
    expect(overviewContainmentRate({ containedCount: 0, conversationsAnalyzed: 0 })).toBe(0);
  });
});

describe("formatRate", () => {
  it("rounds to whole percentages", () => {
    expect(formatRate(0.5732)).toBe("57%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(1)).toBe("100%");
  });
});
