import { expect, test } from "@playwright/test";

import { signUp, uniqueEmail } from "./helpers";

test.describe("authentication", () => {
  test("rejects wrong credentials without revealing whether the account exists", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel(/^Email/).fill(uniqueEmail());
    await page.getByLabel(/^Password/).fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    const error = page.getByText("Incorrect email or password");
    await expect(error).toBeVisible();
    // Same message for a real account with a bad password: no account enumeration.
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign up, sign out and sign back in", async ({ page }) => {
    const { email, password, workspaceSlug } = await signUp(page);

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // The session cookie is gone, so protected routes bounce back to sign-in.
    await page.goto(`/w/${workspaceSlug}/dashboard`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);

    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/dashboard$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Good");
  });

  test("an authenticated visitor is redirected away from the sign-in page", async ({ page }) => {
    await signUp(page);
    await page.goto("/sign-in");
    await expect(page).toHaveURL(/\/w\/[a-z0-9-]+\/dashboard$/);
  });

  test("an unknown workspace is a 404 rather than a permission error", async ({ page }) => {
    await signUp(page);
    // Existence of another tenant's workspace must not be observable.
    await page.goto("/w/some-other-tenant/dashboard");
    await expect(page.getByText(/Not found|not exist/i).first()).toBeVisible();
  });

  test("validation errors are shown on the sign-up form", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel(/^Your name/).fill("A");
    await page.getByLabel(/^Work email/).fill("not-an-email");
    await page.getByLabel(/^Password/).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Enter your name")).toBeVisible();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up/);
  });
});
