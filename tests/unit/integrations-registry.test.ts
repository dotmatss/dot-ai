// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  configKeysFor,
  getIntegrationDefinition,
  INTEGRATION_DEFINITIONS,
  INTEGRATIONS,
  isIntegrationProvider,
  WEBHOOK_EVENTS,
} from "@/features/integrations/registry";
import { connectionSchemaFor, fieldErrorsFrom } from "@/features/integrations/schemas";
import { INTEGRATION_PROVIDERS, type IntegrationProvider } from "@/features/integrations/types";

describe("registry shape", () => {
  it("defines every provider exactly once", () => {
    expect(INTEGRATION_DEFINITIONS).toHaveLength(INTEGRATION_PROVIDERS.length);
    expect(INTEGRATION_DEFINITIONS.map((definition) => definition.id)).toEqual([...INTEGRATION_PROVIDERS]);
  });

  it("gives every entry the metadata the catalog renders", () => {
    for (const definition of INTEGRATION_DEFINITIONS) {
      expect(definition.name.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.docsUrl.startsWith("https://")).toBe(true);
      expect(typeof definition.icon).not.toBe("undefined");
    }
  });

  it("keeps the render descriptors in lockstep with the validating schema", () => {
    // Drift here means a field the operator can type but the server ignores,
    // or a required value with no control to enter it.
    for (const provider of INTEGRATION_PROVIDERS) {
      const definition = INTEGRATIONS[provider];
      expect(definition.configFields.map((field) => field.key).sort()).toEqual(configKeysFor(provider).sort());
    }
  });

  it("only offers defaults the provider's own schema accepts", () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const definition = INTEGRATIONS[provider];
      // Defaults seed the form, so an invalid default would show an error before
      // the operator has typed anything - except where the value is required.
      const result = definition.configSchema.safeParse(definition.defaultConfig);
      if (!result.success) {
        const failing = Object.keys(fieldErrorsFrom(result.error));
        const required = definition.configFields.filter((field) => field.required).map((field) => field.key);
        expect(failing.every((key) => required.includes(key))).toBe(true);
      }
    }
  });

  it("marks unfinished providers as coming soon with nothing to configure", () => {
    for (const provider of ["google_sheets", "hubspot"] as const) {
      const definition = INTEGRATIONS[provider];
      expect(definition.status).toBe("coming_soon");
      expect(definition.configFields).toHaveLength(0);
      expect(definition.secretFields).toHaveLength(0);
      expect(definition.testable).toBe(false);
    }
  });

  it("only claims a connection test where one can actually be made", () => {
    expect(INTEGRATIONS.webhook.testable).toBe(true);
    expect(INTEGRATIONS.slack.testable).toBe(true);
    expect(INTEGRATIONS.zapier.testable).toBe(false);
    expect(INTEGRATIONS.email_smtp.testable).toBe(false);
  });

  it("never declares a secret as part of the non-secret config", () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const definition = INTEGRATIONS[provider];
      const configKeys = configKeysFor(provider);
      for (const secret of definition.secretFields) {
        expect(configKeys).not.toContain(secret.key);
      }
    }
  });

  it("recognises only known providers", () => {
    expect(isIntegrationProvider("webhook")).toBe(true);
    expect(isIntegrationProvider("Webhook")).toBe(false);
    expect(isIntegrationProvider("toString")).toBe(false);
    expect(isIntegrationProvider("constructor")).toBe(false);
    expect(getIntegrationDefinition("slack").id).toBe("slack");
  });
});

describe("webhook configuration", () => {
  const schema = connectionSchemaFor("webhook");

  it("accepts a public endpoint and at least one event", () => {
    const result = schema.safeParse({
      config: { url: "https://hooks.example.com/dot", events: ["conversation.started"] },
      secrets: { signingSecret: "" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an endpoint that would reach our own network", () => {
    const result = schema.safeParse({
      config: { url: "http://169.254.169.254/latest/meta-data/", events: ["conversation.started"] },
      secrets: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(fieldErrorsFrom(result.error))).toContain("config.url");
  });

  it("requires at least one event, and only events it publishes", () => {
    const noEvents = schema.safeParse({ config: { url: "https://example.com/h", events: [] }, secrets: {} });
    expect(noEvents.success).toBe(false);

    const unknownEvent = schema.safeParse({
      config: { url: "https://example.com/h", events: ["account.deleted"] },
      secrets: {},
    });
    expect(unknownEvent.success).toBe(false);

    const known = schema.safeParse({
      config: { url: "https://example.com/h", events: WEBHOOK_EVENTS.map((event) => event.value) },
      secrets: {},
    });
    expect(known.success).toBe(true);
  });

  it("treats the signing secret as optional", () => {
    expect(schema.safeParse({ config: { url: "https://example.com/h", events: ["message.created"] }, secrets: {} }).success).toBe(
      true,
    );
  });
});

describe("secret requirements", () => {
  it("requires a secret the first time and allows it to be omitted afterwards", () => {
    const firstTime = connectionSchemaFor("slack");
    const missing = firstTime.safeParse({ config: { channel: "#support", events: ["message.created"] }, secrets: {} });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(Object.keys(fieldErrorsFrom(missing.error))).toContain("secrets.webhookUrl");

    // Already configured: a blank field means "keep the stored value", which is
    // what makes Replace possible without ever sending the secret to the client.
    const reconfigure = connectionSchemaFor("slack", ["webhookUrl"]);
    const blank = reconfigure.safeParse({ config: { channel: "#support", events: ["message.created"] }, secrets: {} });
    expect(blank.success).toBe(true);
  });

  it("requires the SMTP password and validates the non-secret fields", () => {
    const schema = connectionSchemaFor("email_smtp");
    expect(
      schema.safeParse({ config: { host: "smtp.example.com", port: 587, username: "bot" }, secrets: { password: "pw" } })
        .success,
    ).toBe(true);

    const badPort = schema.safeParse({
      config: { host: "smtp.example.com", port: 70_000, username: "bot" },
      secrets: { password: "pw" },
    });
    expect(badPort.success).toBe(false);
    if (!badPort.success) expect(Object.keys(fieldErrorsFrom(badPort.error))).toContain("config.port");

    const badHost = schema.safeParse({
      config: { host: "not a host", port: 587, username: "bot" },
      secrets: { password: "pw" },
    });
    expect(badHost.success).toBe(false);
  });

  it("ignores unknown config keys instead of storing them", () => {
    const schema = connectionSchemaFor("webhook");
    const result = schema.safeParse({
      config: { url: "https://example.com/h", events: ["message.created"], sneaky: "value" },
      secrets: {},
    });
    expect(result.success).toBe(true);
    if (result.success) expect(Object.keys(result.data.config)).not.toContain("sneaky");
  });
});

describe("fieldErrorsFrom", () => {
  it("produces nested form paths so the right control shows the message", () => {
    const result = connectionSchemaFor("webhook").safeParse({ config: { url: "nope", events: [] }, secrets: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    const details = fieldErrorsFrom(result.error);
    expect(Object.keys(details).sort()).toEqual(["config.events", "config.url"]);
    expect(details["config.url"]?.[0]).toBeTypeOf("string");
  });
});

describe("provider coverage", () => {
  it("has a connection schema for every provider that is available", () => {
    const available = INTEGRATION_PROVIDERS.filter((provider) => INTEGRATIONS[provider].status === "available");
    for (const provider of available as IntegrationProvider[]) {
      expect(() => connectionSchemaFor(provider)).not.toThrow();
    }
  });
});
