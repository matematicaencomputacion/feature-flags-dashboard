import { expect, test, type Page } from "@playwright/test";
import { loginAsDemo, openFlag } from "./helpers";

async function selectProduction(page: Page, expectedRollout: string) {
  await page.getByRole("button", { name: "production", exact: true }).click();
  await expect(page.getByText(/requiere confirmación/)).toBeVisible();
  // El draft se sincroniza en un useEffect aparte del setEnv.
  await expect(page.getByLabel("Rollout %")).toHaveValue(expectedRollout);
}

test.describe("Confirmación production (CA-14-07)", () => {
  test("cancelar no persiste; confirmar sí", async ({ page }) => {
    await loginAsDemo(page);
    await openFlag(page, "mvp_check");
    // Seed: production rollout 100
    await selectProduction(page, "100");

    const cancelledValue = "42";
    const confirmedValue = "55";

    // Cancelar: el modal aparece y no persiste
    await page.getByLabel("Rollout %").fill(cancelledValue);
    await page.getByRole("button", { name: "Guardar reglas (production)" }).click();
    await expect(
      page.getByRole("heading", { name: /Confirmar cambio en production/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(
      page.getByRole("heading", { name: /Confirmar cambio en production/ }),
    ).toHaveCount(0);

    await page.reload();
    await selectProduction(page, "100");

    // Confirmar: sí persiste
    await page.getByLabel("Rollout %").fill(confirmedValue);
    await page.getByRole("button", { name: "Guardar reglas (production)" }).click();
    await expect(
      page.getByRole("heading", { name: /Confirmar cambio en production/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Confirmar en production" }).click();

    await expect(page.getByText(/último: demo/)).toBeVisible();
    await expect(
      page.getByText(new RegExp(`Exposición teórica: ~${confirmedValue}%`)),
    ).toBeVisible();

    await page.reload();
    await selectProduction(page, confirmedValue);
  });
});
