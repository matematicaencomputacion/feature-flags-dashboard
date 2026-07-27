import { expect, test } from "@playwright/test";
import { loginAsDemo, openFlag } from "./helpers";

test.describe("Observabilidad del detalle (CA-14-08)", () => {
  test("muestra lifecycle, reglas y último cambio", async ({ page }) => {
    await loginAsDemo(page);
    await openFlag(page, "mvp_check");

    await expect(page.getByText("experimental", { exact: true })).toBeVisible();
    await expect(page.getByText(/safe_default=off/)).toBeVisible();
    await expect(page.getByText(/último:/)).toBeVisible();
    await expect(page.getByText(/Exposición teórica: ~\d+%/)).toBeVisible();

    await page.getByRole("button", { name: "staging", exact: true }).click();
    await expect(page.getByLabel("Rollout %")).toBeVisible();
    await expect(page.getByLabel("Default del ambiente ON")).toBeVisible();
  });
});
