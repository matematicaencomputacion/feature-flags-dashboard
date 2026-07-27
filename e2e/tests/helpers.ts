import { expect, type Page } from "@playwright/test";

/** Espera a que el form client-side tenga handlers React (evita submit nativo GET). */
async function waitForHydratedForm(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    if (!form) return false;
    return Object.keys(form).some(
      (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"),
    );
  });
}

export async function loginAsDemo(page: Page) {
  await page.goto("/");
  await waitForHydratedForm(page);
  await page.getByLabel("Usuario").fill("demo");
  await page.getByLabel("Password").fill("demo");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(
    page.getByRole("heading", { name: "Flags", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/flags$/);
}

export async function openFlag(page: Page, key: string) {
  await page.getByRole("link", { name: new RegExp(key) }).click();
  await expect(page.getByRole("heading", { name: key, exact: true })).toBeVisible();
}
