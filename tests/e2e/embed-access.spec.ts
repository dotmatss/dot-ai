import { expect, test } from "@playwright/test";

import { chatbotTabs, createChatbot, fillWhenHydrated, signUp } from "./helpers";

/**
 * The embed boundary is the only place where an unauthenticated third-party
 * page can reach a tenant's chatbot, so its access rules are covered
 * end-to-end: chatbot status, the allowed-domain list, and the signed token
 * that the public chat API requires.
 */
test("the embeddable widget is only served to allowed origins of an active chatbot", async ({ page }) => {
  const { workspaceSlug } = await signUp(page);
  await createChatbot(page, workspaceSlug, "Widget Bot", "Embedded on the marketing site.");

  await chatbotTabs(page).getByRole("link", { name: "Deploy" }).click();
  await fillWhenHydrated(page, "Domain to allow", "https://www.example.com/pricing");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("www.example.com")).toBeVisible();

  // The snippet carries the public embed key; read it the way a customer would.
  const snippet = await page.locator("pre").first().innerText();
  const embedKey = snippet.match(/data-chatbot="([^"]+)"/)?.[1] ?? "";
  expect(embedKey, "embed snippet should contain the embed key").toMatch(/^cb_/);

  await page.getByRole("alert").getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Ready to serve")).toBeVisible();

  // The loader script is public and contains no tenant configuration.
  const loader = await page.request.get("/embed/widget.js");
  expect(loader.status()).toBe(200);
  const loaderBody = await loader.text();
  expect(loaderBody).toContain("dot-widget-root");
  expect(loaderBody).not.toContain(embedKey);

  // Allowed origin: the widget renders.
  const allowed = await page.request.get(`/embed/${embedKey}`, {
    headers: { referer: "https://www.example.com/pricing" },
  });
  expect(allowed.status()).toBe(200);
  await expect(allowed.text()).resolves.toContain("Widget Bot");

  // Unlisted origin: refused, and the refusal explains itself.
  const foreign = await page.request.get(`/embed/${embedKey}`, {
    headers: { referer: "https://evil.example/landing" },
  });
  expect(foreign.status()).toBe(200);
  await expect(foreign.text()).resolves.toContain("not allowed to use the chat");

  // A subdomain does not inherit an exact-match entry.
  const subdomain = await page.request.get(`/embed/${embedKey}`, {
    headers: { referer: "https://shop.example.com/" },
  });
  await expect(subdomain.text()).resolves.toContain("not allowed to use the chat");

  // Unknown key: no information about whether it ever existed.
  const unknown = await page.request.get("/embed/cb_definitely-not-a-real-key", {
    headers: { referer: "https://www.example.com/" },
  });
  await expect(unknown.text()).resolves.toContain("Chat unavailable");

  // The public chat API refuses a forged widget session.
  const forged = await page.request.post("/api/public/chat", {
    data: {
      embedKey,
      token: "forged-token-that-is-long-enough",
      messages: [{ role: "user", content: "hello" }],
    },
  });
  expect(forged.status()).toBe(403);
  const forgedBody = (await forged.json()) as { error?: { code?: string } };
  expect(forgedBody.error?.code).toBe("forbidden");

  // Pausing the chatbot closes the widget even for an allowed origin.
  await page.getByRole("button", { name: "Pause" }).first().click();
  await expect(page.getByText("This chatbot is not active")).toBeVisible();
  const paused = await page.request.get(`/embed/${embedKey}`, {
    headers: { referer: "https://www.example.com/pricing" },
  });
  await expect(paused.text()).resolves.toContain("offline");
});

test("application pages refuse framing while the embed route allows it", async ({ page }) => {
  const { workspaceSlug } = await signUp(page);

  const app = await page.request.get(`/w/${workspaceSlug}/dashboard`);
  const appHeaders = app.headers();
  expect(appHeaders["x-frame-options"]).toBe("DENY");
  expect(appHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(appHeaders["x-content-type-options"]).toBe("nosniff");

  const embed = await page.request.get("/embed/cb_anything-at-all");
  const embedHeaders = embed.headers();
  expect(embedHeaders["x-frame-options"]).toBeUndefined();
  expect(embedHeaders["content-security-policy"]).toContain("frame-ancestors *");
});
