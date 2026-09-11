import "server-only";

import { z } from "zod";

/**
 * Server-side environment configuration. Only the data-access and integration
 * layers should import this module; UI code must never read `process.env`.
 *
 * Validation is lazy so `next build` succeeds without secrets present, while
 * misconfiguration fails loudly on first use at runtime.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  // Signs short-lived embed tokens. Required in production; a development
  // fallback keeps local setup friction-free.
  APP_SECRET: z.string().min(32).optional(),
  AI_PROVIDER: z.enum(["mock", "gateway"]).default("mock"),
  AI_GATEWAY_BASE_URL: z.url().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_DEFAULT_MODEL: z.string().default("gpt-4o-mini"),
});

export type ServerEnv = Omit<z.infer<typeof serverEnvSchema>, "APP_SECRET"> & { APP_SECRET: string };

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  const data = parsed.data;
  if (!data.APP_SECRET) {
    if (data.NODE_ENV === "production") {
      throw new Error("Invalid server environment: APP_SECRET is required in production (32+ characters)");
    }
    data.APP_SECRET = "development-only-secret-do-not-use-in-production!!";
  }
  cached = data as ServerEnv;
  return cached;
}

export function isProduction(): boolean {
  return getServerEnv().NODE_ENV === "production";
}
