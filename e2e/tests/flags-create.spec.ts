import { expect, test } from "@playwright/test";
import { loginAsDemo } from "./helpers";

test.describe("Crear flag (CA-14-02)", () => {
  test("crear una flag desde la UI y verla en la lista", async ({ page }) => {
    const key = `e2e_flag_${Date.now()}`;
    await loginAsDemo(page);

    await page.getByPlaceholder("billing_v2").fill(key);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/flags") &&
          r.request().method() === "POST" &&
          !r.url().includes("/rules"),
      ),
      page.getByRole("button", { name: "Crear" }).click(),
    ]);
    expect(res.ok(), `POST /flags → ${res.status()}`).toBeTruthy();

    await expect(page.getByRole("link", { name: new RegExp(key) })).toBeVisible();
    await expect(page.getByText(key, { exact: true })).toBeVisible();
  });
});
