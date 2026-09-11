import { expect, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery-staple";

let counter = 0;

/** Unique per run so tests can be re-run against the same database. */
export function uniqueEmail(): string {
  counter += 1;
  return `e2e-${process.pid}-${Date.now()}-${counter}@example.com`;
}

export interface SignedUpUser {
  email: string;
  password: string;
  workspaceSlug: string;
}

/** Creates a fresh account, organization and workspace, landing on the dashboard. */
export async function signUp(page: Page, options: { organization?: string } = {}): Promise<SignedUpUser> {
  const email = uniqueEmail();
  const organization = options.organization ?? `Acme ${email.split("@")[0]}`;

  await page.goto("/sign-up");
  await page.getByLabel(/^Your name/).fill("Ada Lovelace");
  await page.getByLabel(/^Organization/).fill(organization);
  await page.getByLabel(/^Work email/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/dashboard$/, { timeout: 60_000 });
  const workspaceSlug = new URL(page.url()).pathname.split("/")[2] ?? "";
  return { email, password: PASSWORD, workspaceSlug };
}

/**
 * Fills a controlled input, retrying until React has hydrated and kept the
 * value. Without this, a fill that lands before hydration is silently reverted.
 */
export async function fillWhenHydrated(page: Page, label: string | RegExp, value: string): Promise<void> {
  const field = page.getByLabel(label);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 30_000 });
}

/** Creates a chatbot from the chatbots list and returns its id. */
export async function createChatbot(page: Page, workspaceSlug: string, name: string, description = ""): Promise<string> {
  await page.goto(`/w/${workspaceSlug}/chatbots`);
  await page.getByRole("button", { name: "New chatbot" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Name/).fill(name);
  if (description) await dialog.getByLabel(/^Description/).fill(description);
  await dialog.getByRole("button", { name: "Create chatbot" }).click();

  await expect(page).toHaveURL(/\/chatbots\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

export function chatbotTabs(page: Page) {
  return page.getByRole("navigation", { name: "Chatbot sections" });
}
