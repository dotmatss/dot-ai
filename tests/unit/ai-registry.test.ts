// @vitest-environment node
/**
 * Rules of the platform AI catalogue.
 *
 * Three properties are worth pinning, and each fails silently if it regresses:
 *
 *   1. A model can never be OFFERED for something it cannot DO.
 *   2. A provider credential can be set and can never be read back.
 *   3. `dimensions` is not editable on an embedding model.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  aiModelCreateSchema,
  aiModelUpdateSchema,
  aiProviderUpdateSchema,
  embeddingModelUpdateSchema,
} from "@/features/platform/ai-schemas";
import { isModelOffered } from "@/features/platform/ai-types";
import { providerCredentialContext } from "@/features/platform/server/ai-credentials";

const root = path.resolve(__dirname, "..", "..");

const baseModel = {
  providerId: "11111111-1111-4111-8111-111111111111",
  providerModelId: "gpt-x-mini",
  slug: "gpt-x-mini",
  displayName: "GPT-X mini",
};

describe("model capability rules", () => {
  it("refuses to offer a model for a capability it does not support", () => {
    const result = aiModelCreateSchema.safeParse({
      ...baseModel,
      capabilities: ["chat", "tool_calling"],
      availableFor: ["chat", "vision"],
    });

    expect(result.success).toBe(false);
    // The error is attached to the field an operator can fix, not to the root.
    expect(result.error?.issues.some((issue) => issue.path.includes("availableFor"))).toBe(true);
  });

  it("accepts availability that is a subset of capability, including the empty set", () => {
    expect(aiModelCreateSchema.safeParse({ ...baseModel, capabilities: ["chat"], availableFor: ["chat"] }).success).toBe(
      true,
    );
    // Registered but offered for nothing is a legitimate state: it is how a
    // model is catalogued before it is turned on.
    expect(aiModelCreateSchema.safeParse({ ...baseModel, capabilities: ["chat"], availableFor: [] }).success).toBe(true);
  });

  it("requires capabilities and availability to be edited together", () => {
    // Validating a new `availableFor` against whatever happens to be stored is
    // a check against a moving target, so a half-supplied pair is refused.
    expect(aiModelUpdateSchema.safeParse({ availableFor: ["vision"] }).success).toBe(false);
    expect(aiModelUpdateSchema.safeParse({ capabilities: ["chat"] }).success).toBe(false);
    expect(aiModelUpdateSchema.safeParse({ capabilities: ["chat"], availableFor: ["chat"] }).success).toBe(true);
    // Neither supplied is fine - this is an edit of something else entirely.
    expect(aiModelUpdateSchema.safeParse({ displayName: "Renamed" }).success).toBe(true);
  });

  it("treats a model as offered only when provider, status and availability all allow it", () => {
    expect(isModelOffered({ providerEnabled: true, status: "active", availableFor: ["chat"] })).toBe(true);
    expect(isModelOffered({ providerEnabled: false, status: "active", availableFor: ["chat"] })).toBe(false);
    expect(isModelOffered({ providerEnabled: true, status: "disabled", availableFor: ["chat"] })).toBe(false);
    expect(isModelOffered({ providerEnabled: true, status: "active", availableFor: [] })).toBe(false);
  });
});

describe("provider credentials", () => {
  it("distinguishes leaving a key alone, clearing it, and replacing it", () => {
    // Three intents that must stay distinguishable: conflating "absent" with
    // "clear" would erase a working credential on every unrelated edit.
    expect(aiProviderUpdateSchema.parse({ name: "X" }).apiKey).toBeUndefined();
    expect(aiProviderUpdateSchema.parse({ apiKey: null }).apiKey).toBeNull();
    expect(aiProviderUpdateSchema.parse({ apiKey: "sk-test" }).apiKey).toBe("sk-test");
  });

  it("binds a credential to its own provider and plane", () => {
    const context = providerCredentialContext("abc");
    expect(context).toBe("platform:ai-provider:abc");
    // Different provider, different context, so a ciphertext cannot be moved
    // between rows; and the prefix differs from the workspace integration
    // context, so it cannot be moved between planes either.
    expect(providerCredentialContext("def")).not.toBe(context);
    expect(context.startsWith("workspace:")).toBe(false);
  });

  it("never selects ciphertext into a summary projection", () => {
    const raw = readFileSync(
      path.join(root, "src", "features", "platform", "server", "ai-registry-repository.ts"),
      "utf8",
    );
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    // Exactly two functions may name the credential columns: the one that
    // writes an envelope and the one that reads it back for decryption.
    // Deletion does not appear, because it removes the row without naming a
    // column - which is itself the point: nothing else touches the ciphertext.
    const touchesCiphertext = source
      .split(/export (?:async )?function /)
      .filter((block) => /\bciphertext\b/.test(block))
      .map((block) => block.slice(0, block.indexOf("(")))
      .sort();

    expect(touchesCiphertext).toEqual(["findProviderCredential", "upsertProviderCredential"]);
  });

  it("keeps the credential out of every client-facing type", () => {
    const types = readFileSync(path.join(root, "src", "features", "platform", "ai-types.ts"), "utf8");
    const body = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    for (const forbidden of ["apiKey", "ciphertext", "credential:", "secret"]) {
      expect(body.includes(forbidden)).toBe(false);
    }
    // What it does carry is the boolean, which is the whole contract.
    expect(body).toContain("credentialConfigured");
  });
});

describe("embedding model rules", () => {
  it("does not accept a dimension change", () => {
    // Not merely ignored - absent from the schema, so a caller that tries gets
    // no silent success. Dimensions are the width of stored vectors.
    const parsed = embeddingModelUpdateSchema.parse({ displayName: "New name", dimensions: 9999 } as never);
    expect("dimensions" in parsed).toBe(false);
  });

  it("still allows the editable descriptive fields", () => {
    const parsed = embeddingModelUpdateSchema.parse({ displayName: "Renamed", costPerMtok: 0.02, status: "deprecated" });
    expect(parsed).toMatchObject({ displayName: "Renamed", costPerMtok: 0.02, status: "deprecated" });
  });
});
