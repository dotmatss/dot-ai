import { describe, expect, it } from "vitest";

import {
  extensionOf,
  formatBytes,
  UPLOAD_ACCEPT_ATTRIBUTE,
  UPLOAD_MAX_BYTES,
  validateUpload,
} from "@/features/knowledge/uploads";

function file(name: string, type: string, size = 1_024) {
  return { name, type, size };
}

function messageFor(candidate: { name: string; type: string; size: number }): string {
  const result = validateUpload(candidate);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.message;
}

describe("UPLOAD_ACCEPT_ATTRIBUTE", () => {
  it("lists exactly the supported extensions", () => {
    expect(UPLOAD_ACCEPT_ATTRIBUTE).toBe(".txt,.md,.csv,.json,.html");
  });
});

describe("extensionOf", () => {
  it("returns the lowercased final extension", () => {
    expect(extensionOf("Notes.TXT")).toBe(".txt");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
  });

  it("returns an empty string when there is no extension", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("validateUpload", () => {
  it("accepts every supported format with its usual content type", () => {
    const accepted = [
      file("notes.txt", "text/plain"),
      file("guide.md", "text/markdown"),
      file("guide.md", ""),
      file("rows.csv", "text/csv"),
      file("config.json", "application/json"),
      file("page.html", "text/html"),
      file("PAGE.HTML", "text/html"),
    ];
    for (const candidate of accepted) {
      const result = validateUpload(candidate);
      expect(result.ok, `${candidate.name} / ${candidate.type}`).toBe(true);
    }
  });

  it("accepts a charset parameter on the content type", () => {
    expect(validateUpload(file("notes.txt", "text/plain; charset=utf-8")).ok).toBe(true);
  });

  it("explains that PDF and Word documents are out of scope", () => {
    expect(messageFor(file("handbook.pdf", "application/pdf"))).toContain("not supported yet");
    expect(messageFor(file("handbook.pdf", "application/pdf"))).toContain("Text source");
    expect(
      messageFor(file("contract.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
    ).toContain("not supported yet");
    expect(messageFor(file("sheet.xlsx", "application/vnd.ms-excel"))).toContain("CSV");
  });

  it("rejects an unsupported extension", () => {
    expect(messageFor(file("archive.zip", "application/zip"))).toContain("not supported");
    expect(messageFor(file("README", "text/plain"))).toContain("not supported");
  });

  it("rejects a content type that does not match the extension", () => {
    expect(messageFor(file("notes.txt", "application/octet-stream"))).toContain("application/octet-stream");
    expect(messageFor(file("config.json", "image/png"))).toContain("image/png");
  });

  it("rejects empty and oversized files", () => {
    expect(messageFor(file("notes.txt", "text/plain", 0))).toContain("empty");
    expect(messageFor(file("notes.txt", "text/plain", UPLOAD_MAX_BYTES + 1))).toContain("limit is 5 MB");
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateUpload(file("notes.txt", "text/plain", UPLOAD_MAX_BYTES)).ok).toBe(true);
  });

  it("rejects a blank file name", () => {
    expect(messageFor(file("   ", "text/plain"))).toContain("no name");
  });
});

describe("formatBytes", () => {
  it("scales the unit to the size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
