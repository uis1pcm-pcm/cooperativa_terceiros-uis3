import { expect, test } from "@playwright/test";

test.describe("Link público", () => {
  test("exibe mensagem de sessão expirada quando token ausente", async ({ page }) => {
    await page.goto("/terceiro", { waitUntil: "networkidle" });
    const expiredMessage = page.locator("text=O acesso público expirou");
    await expect(expiredMessage).toBeVisible();
  });
});
