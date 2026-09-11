import { describe, expect, it } from "vitest";

import { decodeHtmlEntities, extractHtmlTitle, htmlToText, looksLikeText } from "@/features/knowledge/html-text";

describe("htmlToText", () => {
  it("drops scripts, styles and head content", () => {
    const html = `<!doctype html><html><head><title>Docs</title><style>.a{color:red}</style>
      <meta name="description" content="hidden"></head>
      <body><script>window.secret = "leak";</script><p>Visible copy.</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toBe("Visible copy.");
    expect(text).not.toContain("leak");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("hidden");
  });

  it("drops an unterminated script block rather than leaking its tail", () => {
    expect(htmlToText("<p>Before.</p><script>var a = 1; // truncated download")).toBe("Before.");
  });

  it("turns block elements into paragraph breaks and <br> into newlines", () => {
    const html = "<h1>Refunds</h1><p>Within 30 days.</p><ul><li>Item one</li><li>Item two</li></ul><p>Line<br>break</p>";
    expect(htmlToText(html)).toBe("Refunds\n\nWithin 30 days.\n\nItem one\n\nItem two\n\nLine\nbreak");
  });

  it("keeps inline elements on one line", () => {
    expect(htmlToText("<p>A <strong>bold</strong> claim.</p>")).toBe("A bold claim.");
  });

  it("collapses source whitespace and removes comments", () => {
    // Blank lines inside a block are not paragraph breaks in HTML, so only the
    // block tags create them.
    expect(htmlToText("<p>a   \n\n   b</p><!-- note --><p>c</p>")).toBe("a b\n\nc");
  });

  it("treats a decoded non-breaking space as ordinary whitespace", () => {
    expect(htmlToText("<p>30&nbsp;days</p>")).toBe("30 days");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<html><head><title>t</title></head><body><script>x</script></body></html>")).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named, decimal and hexadecimal entities", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry &lt;3 &quot;quotes&quot;")).toBe('Tom & Jerry <3 "quotes"');
    expect(decodeHtmlEntities("caf&#233; &#x2014; open")).toBe("café — open");
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a\u00a0b");
  });

  it("leaves unknown and malformed entities untouched", () => {
    expect(decodeHtmlEntities("&notarealentity; &#; 5 &lt 6")).toBe("&notarealentity; &#; 5 &lt 6");
  });

  it("does not decode a script tag out of an escaped entity", () => {
    // &lt;script&gt; must stay inert text after extraction.
    expect(htmlToText("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<script>alert(1)</script>");
  });
});

describe("extractHtmlTitle", () => {
  it("returns the decoded, collapsed title", () => {
    expect(extractHtmlTitle("<head><title>  Refunds &amp;\n  Returns </title></head>")).toBe("Refunds & Returns");
  });

  it("returns null when there is no usable title", () => {
    expect(extractHtmlTitle("<head></head>")).toBeNull();
    expect(extractHtmlTitle("<head><title>   </title></head>")).toBeNull();
  });
});

describe("looksLikeText", () => {
  it("rejects payloads containing NUL bytes", () => {
    expect(looksLikeText("hello\u0000world")).toBe(false);
  });

  it("rejects payloads that are mostly replacement characters", () => {
    expect(looksLikeText("\ufffd".repeat(50))).toBe(false);
  });

  it("accepts prose with the occasional replacement character", () => {
    expect(looksLikeText("a".repeat(1000))).toBe(true);
    expect(looksLikeText(`${"a".repeat(1000)}\ufffd`)).toBe(true);
  });
});
