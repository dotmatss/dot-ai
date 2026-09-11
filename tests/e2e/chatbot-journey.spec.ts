import { expect, test } from "@playwright/test";

import { chatbotTabs, createChatbot, fillWhenHydrated, signUp } from "./helpers";

/**
 * The primary product journey: sign up, create a chatbot, configure it, verify
 * it answers, then deploy it. Runs against the mock AI gateway, so the
 * assistant's reply is deterministic.
 */
test("sign up, create and configure a chatbot, chat in the playground, then deploy", async ({ page }) => {
  const { workspaceSlug } = await signUp(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good");

  await page.getByRole("link", { name: "Chatbots" }).first().click();
  await expect(page).toHaveURL(/\/chatbots$/);

  const chatbotId = await createChatbot(page, workspaceSlug, "Support Assistant", "Answers billing questions.");
  expect(chatbotId).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Support Assistant");
  await expect(page.getByText("Draft").first()).toBeVisible();

  const tabs = chatbotTabs(page);

  // Instructions persist and the save is confirmed.
  await tabs.getByRole("link", { name: "Instructions" }).click();
  await fillWhenHydrated(page, /^Instructions/, "You are a concise billing assistant.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  // Streaming round-trip through the mock gateway.
  await tabs.getByRole("link", { name: "Playground" }).click();
  const send = page.getByRole("button", { name: "Send message" });
  await fillWhenHydrated(page, "Message", "Do you offer refunds?");
  await send.click();
  await expect(page.getByText(/You asked: "Do you offer refunds\?"/)).toBeVisible({ timeout: 30_000 });
  await expect(send).toBeEnabled({ timeout: 30_000 });

  // Deploy: allow a domain, then activate.
  await tabs.getByRole("link", { name: "Deploy" }).click();
  await fillWhenHydrated(page, "Domain to allow", "https://www.example.com/pricing");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("www.example.com")).toBeVisible();
  await page.getByRole("alert").getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Ready to serve")).toBeVisible();

  // Saved instructions survive navigation.
  await tabs.getByRole("link", { name: "Instructions" }).click();
  await expect(page.getByLabel(/^Instructions/)).toHaveValue("You are a concise billing assistant.");

  // The list reflects the new state, and search state lives in the URL.
  await page.getByRole("link", { name: "Chatbots" }).first().click();
  await expect(page.getByRole("link", { name: /Support Assistant/ })).toBeVisible();
  await expect(page.getByText("Active").first()).toBeVisible();

  await fillWhenHydrated(page, "Search chatbots", "Support");
  await expect(page).toHaveURL(/[?&]q=Support/, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole("link", { name: /Support Assistant/ })).toBeVisible();

  await fillWhenHydrated(page, "Search chatbots", "no-such-chatbot-name");
  await expect(page.getByText("No chatbots match your filters")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: /Support Assistant/ })).toBeVisible();
});

test("unauthenticated users are redirected to sign in", async ({ page }) => {
  await page.goto("/w/anything/dashboard");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
