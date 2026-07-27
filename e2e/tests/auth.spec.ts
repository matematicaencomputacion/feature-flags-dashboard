import { expect, test } from "@playwright/test";
import { loginAsDemo } from "./helpers";

test.describe("Auth (CA-14-01)", () => {
  test("login demo/demo entra al panel", async ({ page }) => {
    await loginAsDemo(page);
  });

  test("credenciales inválidas muestran error y no entran", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      return Object.keys(form).some(
        (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"),
      );
    });
    await page.getByLabel("Usuario").fill("demo");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Invalid credentials")).toBeVisible();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  test("ruta protegida sin sesión redirige a login", async ({ page }) => {
    await page.goto("/flags");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL("/");
  });

  test("logout vuelve a login", async ({ page }) => {
    await loginAsDemo(page);
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page).toHaveURL("/");
  });
});
