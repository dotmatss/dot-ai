/**
 * Upload rules for file sources, shared by the dialog (so the user is told
 * before the bytes are sent) and the multipart route handler (which is the
 * only side that is trusted).
 *
 * Only UTF-8 text formats are accepted. Binary document formats are rejected
 * with an explanation instead of being ingested as mojibake.
 */

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_LABEL = "5 MB";

interface AcceptedFormat {
  extension: string;
  label: string;
  /**
   * Content types a browser may report for this extension. The empty string is
   * included because browsers legitimately send no type for less common text
   * extensions; `application/octet-stream` is intentionally absent, since it is
   * what binary uploads report.
   */
  contentTypes: ReadonlyArray<string>;
}

export const ACCEPTED_UPLOAD_FORMATS: ReadonlyArray<AcceptedFormat> = [
  { extension: ".txt", label: "Plain text", contentTypes: ["text/plain", ""] },
  { extension: ".md", label: "Markdown", contentTypes: ["text/markdown", "text/x-markdown", "text/plain", ""] },
  { extension: ".csv", label: "CSV", contentTypes: ["text/csv", "application/csv", "text/plain", ""] },
  { extension: ".json", label: "JSON", contentTypes: ["application/json", "text/json", "text/plain", ""] },
  { extension: ".html", label: "HTML", contentTypes: ["text/html", "application/xhtml+xml", "text/plain", ""] },
];

/** Value for the file input's `accept` attribute. */
export const UPLOAD_ACCEPT_ATTRIBUTE = ACCEPTED_UPLOAD_FORMATS.map((format) => format.extension).join(",");

export const UPLOAD_FORMATS_LABEL = ACCEPTED_UPLOAD_FORMATS.map((format) => format.extension.slice(1).toUpperCase()).join(", ");

export const UNSUPPORTED_DOCUMENT_NOTE =
  "PDF and Word documents are not supported yet. Export or copy the text and add it as a Text source instead.";

const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  ".pdf": UNSUPPORTED_DOCUMENT_NOTE,
  ".doc": UNSUPPORTED_DOCUMENT_NOTE,
  ".docx": UNSUPPORTED_DOCUMENT_NOTE,
  ".rtf": UNSUPPORTED_DOCUMENT_NOTE,
  ".odt": UNSUPPORTED_DOCUMENT_NOTE,
  ".pages": UNSUPPORTED_DOCUMENT_NOTE,
  ".xlsx": "Spreadsheets are not supported yet. Export the sheet as CSV and upload that instead.",
  ".xls": "Spreadsheets are not supported yet. Export the sheet as CSV and upload that instead.",
  ".pptx": "Presentations are not supported yet. Copy the text and add it as a Text source instead.",
};

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index).toLowerCase() : "";
}

export interface UploadCandidate {
  name: string;
  type: string;
  size: number;
}

export type UploadValidation = { ok: true; extension: string } | { ok: false; message: string };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validates by extension *and* reported content type: either alone is trivial
 * to spoof, and together they keep obvious mismatches out of the pipeline. The
 * decisive check is still that the bytes decode as UTF-8 text server-side.
 */
export function validateUpload(file: UploadCandidate): UploadValidation {
  const name = file.name.trim();
  if (!name) return { ok: false, message: "The file has no name." };

  const extension = extensionOf(name);
  const unsupported = UNSUPPORTED_EXTENSIONS[extension];
  if (unsupported) return { ok: false, message: unsupported };

  const format = ACCEPTED_UPLOAD_FORMATS.find((candidate) => candidate.extension === extension);
  if (!format) {
    return { ok: false, message: `${extension || "That file type"} is not supported. Upload a ${UPLOAD_FORMATS_LABEL} file.` };
  }

  if (file.size <= 0) return { ok: false, message: "That file is empty." };
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ok: false, message: `That file is ${formatBytes(file.size)}. The limit is ${UPLOAD_MAX_LABEL}.` };
  }

  // Strip any parameters such as "; charset=utf-8" before comparing.
  const contentType = (file.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!format.contentTypes.includes(contentType)) {
    return {
      ok: false,
      message: `A ${extension} file should be uploaded as ${format.label}; this one reported “${contentType || "no type"}”.`,
    };
  }

  return { ok: true, extension };
}
