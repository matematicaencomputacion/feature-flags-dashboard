import { expect, test } from "@playwright/test";
import { loginAsDemo, openFlag } from "./helpers";

test.describe("Reglas de dev", () => {
  test("editar default + % y guardar sin confirmación", async ({ page }) => {
    await loginAsDemo(page);
    await openFlag(page, "mvp_check");

    await page.getByRole("button", { name: "dev", exact: true }).click();
    await page.getByLabel("Default del ambiente ON").check();
    await page.getByLabel("Rollout %").fill("25");
    await page.getByRole("button", { name: "Guardar reglas (dev)" }).click();

    await expect(page.getByText(/último: demo/)).toBeVisible();
    await expect(page.getByText(/Exposición teórica: ~25%/)).toBeVisible();

    // Sin modal de production
    await expect(
      page.getByRole("heading", { name: /Confirmar cambio en production/ }),
    ).toHaveCount(0);

    await page.reload();
    await page.getByRole("button", { name: "dev", exact: true }).click();
    await expect(page.getByLabel("Default del ambiente ON")).toBeChecked();
    await expect(page.getByLabel("Rollout %")).toHaveValue("25");
  });
});
