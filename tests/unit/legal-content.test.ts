import { describe, expect, it } from "vitest";

import { COOKIE_POLICY } from "@/features/legal/content/cookies";
import { PRIVACY_POLICY } from "@/features/legal/content/privacy";
import { TERMS_OF_SERVICE } from "@/features/legal/content/terms";
import { LEGAL_PLACEHOLDERS, isDeclaredPlaceholder, placeholdersIn } from "@/features/legal/placeholders";
import { LEGAL_DOCUMENTS, findLegalDocument, legalLinks } from "@/features/legal/registry";
import { REVIEW_NOTES } from "@/features/legal/review-notes";
import { legalHeadings, legalText } from "@/features/legal/types";

const ALL_DOCUMENTS = [TERMS_OF_SERVICE, PRIVACY_POLICY, COOKIE_POLICY];

function allText(): string {
  return ALL_DOCUMENTS.map(legalText).join("\n");
}

describe("legal documents", () => {
  it("registers terms and privacy, and cookies while cookies are in use", () => {
    const slugs = LEGAL_DOCUMENTS.map((document) => document.slug);
    expect(slugs).toContain("terms");
    expect(slugs).toContain("privacy");
    expect(slugs).toContain("cookies");
  });

  it("resolves each document by slug and nothing else", () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(findLegalDocument(document.slug)).toBe(document);
    }
    expect(findLegalDocument("refunds")).toBeUndefined();
  });

  it("gives every document a title, a description and content", () => {
    for (const document of ALL_DOCUMENTS) {
      expect(document.title.length, document.slug).toBeGreaterThan(4);
      expect(document.description.length, document.slug).toBeGreaterThan(20);
      expect(document.blocks.length, document.slug).toBeGreaterThan(8);
    }
  });

  it("keeps heading ids unique and anchorable within a document", () => {
    for (const document of ALL_DOCUMENTS) {
      const ids = legalHeadings(document).map((heading) => heading.id);
      expect(ids.length, document.slug).toBeGreaterThan(3);
      expect(new Set(ids).size, document.slug).toBe(ids.length);
      for (const id of ids) expect(id, `${document.slug} heading id`).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("opens every document with a notice that it has not been reviewed", () => {
    for (const document of ALL_DOCUMENTS) {
      const first = document.blocks[0];
      expect(first?.type, document.slug).toBe("callout");
      expect(JSON.stringify(first), document.slug).toMatch(/review/i);
    }
  });

  it("links only to pages that exist", () => {
    const known = ["/privacy", "/terms", "/cookies", "/docs", "/docs/api/rate-limits"];
    const links = [...allText().matchAll(/\[[^\]]+\]\((\/[^)]*)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThan(0);
    expect(links.filter((href) => !known.includes(href))).toEqual([]);
  });
});

describe("legal placeholders", () => {
  it("uses only declared placeholders", () => {
    const undeclared = placeholdersIn(allText()).filter((name) => !isDeclaredPlaceholder(name));
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("declares no placeholder that is never used", () => {
    const used = new Set(placeholdersIn(allText()));
    const unused = LEGAL_PLACEHOLDERS.filter((placeholder) => !used.has(placeholder.name)).map((p) => p.name);
    expect(unused).toEqual([]);
  });

  it("leaves the effective date of every document unset until it is reviewed", () => {
    // A date implies the text was settled that day. None of these have been.
    for (const document of ALL_DOCUMENTS) {
      expect(document.effectiveDate, document.slug).toBe("[[EFFECTIVE_DATE]]");
    }
  });

  it("assigns every placeholder an owner who can actually answer it", () => {
    for (const placeholder of LEGAL_PLACEHOLDERS) {
      expect(["company", "legal", "engineering"]).toContain(placeholder.owner);
      expect(placeholder.describes.length, placeholder.name).toBeGreaterThan(15);
    }
  });
});

describe("legal content invents nothing", () => {
  const text = allText();

  it("contains no contact email address", () => {
    // Every address in the text must be a placeholder, never a working one.
    const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) ?? [];
    expect(emails).toEqual([]);
  });

  it("names no legal entity", () => {
    expect(text).not.toMatch(/\b(Inc\.|LLC|Ltd\.?|GmbH|B\.V\.|S\.A\.R\.L|Pty|PLC)\b/);
  });

  it("claims no governing law, court or supervisory authority", () => {
    expect(text).not.toMatch(/\b(laws? of (England|Wales|Scotland|Ireland|Delaware|California|New York|Singapore))\b/i);
    expect(text).not.toMatch(/\b(courts of (London|Dublin|Delaware|California|New York|Singapore))\b/i);
    expect(text).not.toMatch(/\b(Information Commissioner|CNIL|Garante|Datatilsynet)\b/i);
  });

  it("states no street address, postcode or telephone number", () => {
    expect(text).not.toMatch(/\b\d{1,4}\s+\w+\s+(Street|St\.|Avenue|Ave\.|Road|Rd\.|Lane|Boulevard|Blvd\.)\b/i);
    expect(text).not.toMatch(/\+\d{1,3}[\s-]?\d{3,}/);
  });

  it("names no AI or hosting vendor beyond the gateway that is actually in the code", () => {
    // Cloudflare AI Gateway is real: it is the configured target in
    // `src/server/ai/`. The model behind it is not chosen, so no model vendor
    // may be named.
    expect(text).not.toMatch(/\b(OpenAI|Anthropic|Google Gemini|Mistral|Cohere|AWS Bedrock|Azure OpenAI)\b/);
    expect(text).not.toMatch(/\b(Vercel|Supabase|Neon|Heroku|DigitalOcean|Render)\b/);
    expect(text).toMatch(/Cloudflare AI Gateway/);
  });

  it("never claims compliance with a named law", () => {
    const claims = /\b(we (are|remain) (fully )?compliant|GDPR[- ]compliant|CCPA[- ]compliant|HIPAA[- ]compliant|fully compliant)\b/i;
    expect(text).not.toMatch(claims);
  });

  it("promises no uptime, support time or certification", () => {
    expect(text).not.toMatch(/\b99\.9|\bSLA\b|\bISO ?27001\b|\bSOC ?2\b/i);
  });

  it("contains no credential, key or connection string", () => {
    expect(text).not.toMatch(/dot_live_[A-Za-z0-9_-]{16,}/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(text).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe("legal review notes", () => {
  it("records an open question for every area a document claims to cover", () => {
    for (const document of ALL_DOCUMENTS) {
      for (const area of document.reviewAreas) {
        expect(
          REVIEW_NOTES.some((note) => note.area === area),
          `${document.slug} declares the ${area} area but no note covers it`,
        ).toBe(true);
      }
    }
  });

  it("pairs every question with what the code does today", () => {
    for (const note of REVIEW_NOTES) {
      expect(note.question.length).toBeGreaterThan(40);
      expect(note.currentState.length, note.question.slice(0, 40)).toBeGreaterThan(30);
    }
  });

  it("covers the areas a reviewer will certainly ask about", () => {
    const areas = new Set(REVIEW_NOTES.map((note) => note.area));
    expect(areas).toContain("jurisdiction");
    expect(areas).toContain("privacy");
    expect(areas).toContain("ai");
    expect(areas).toContain("cookies");
  });
});

describe("legal footer links", () => {
  it("offers one link per registered document", () => {
    const links = legalLinks();
    expect(links).toHaveLength(LEGAL_DOCUMENTS.length);
    expect(links.map((link) => link.href)).toEqual(LEGAL_DOCUMENTS.map((document) => `/${document.slug}`));
    for (const link of links) expect(link.label.length).toBeGreaterThan(3);
  });
});
