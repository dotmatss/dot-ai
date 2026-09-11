import { expect, test } from "@playwright/test";

import { signUp } from "./helpers";

/**
 * Every section the sidebar offers must actually load for a brand-new
 * workspace: no 404, no error boundary, and the empty state rather than a
 * crash. This is the cheapest guard against a feature that ships its
 * navigation entry before its route.
 */
const SECTIONS = [
  "dashboard",
  "chatbots",
  "agents",
  "workflows",
  "knowledge",
  "conversations",
  "crm",
  "integrations",
  "analytics",
  "settings",
] as const;

test("every workspace section loads for a new workspace", async ({ page }) => {
  const { workspaceSlug } = await signUp(page);

  const failures: string[] = [];

  for (const section of SECTIONS) {
    const response = await page.goto(`/w/${workspaceSlug}/${section}`, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;

    if (status !== 200) {
      failures.push(`${section}: HTTP ${status}`);
      continue;
    }

    // The route-level error boundary and the not-found page both render a
    // heading, so check for their copy rather than for a generic failure.
    const body = await page.locator("body").innerText();
    if (/Something went wrong|This page could not be loaded|404|Not found/i.test(body)) {
      failures.push(`${section}: rendered an error or not-found state`);
      continue;
    }

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  }

  expect(failures, "sections that did not load").toEqual([]);
});

test("the sidebar links to every section and marks the current one", async ({ page }) => {
  const { workspaceSlug } = await signUp(page);
  await page.goto(`/w/${workspaceSlug}/chatbots`);

  const nav = page.getByRole("navigation", { name: "Workspace" });
  for (const label of ["Dashboard", "Chatbots", "Agents", "Workflows", "Knowledge", "Conversations", "CRM", "Integrations", "Analytics", "Settings"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }

  await expect(nav.getByRole("link", { name: "Chatbots" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
});
