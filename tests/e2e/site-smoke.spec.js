import { expect, test } from "@playwright/test";

function collectSameOriginFailures(page) {
  const failures = [];
  const expectedOrigin = "http://127.0.0.1:4173";

  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === expectedOrigin && response.status() >= 400) {
      failures.push(`${response.status()} ${url.pathname}`);
    }
  });

  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const errorText = request.failure()?.errorText || "failed";
    if (url.origin === expectedOrigin && errorText !== "net::ERR_ABORTED") {
      failures.push(`${errorText} ${url.pathname}`);
    }
  });

  return failures;
}

test.describe("site smoke", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => {
      throw error;
    });
  });

  test("[C91] loads the home page without broken local resources", async ({ page }) => {
    const failures = collectSameOriginFailures(page);

    await page.goto("/");

    await expect(page).toHaveTitle(/Pet Project Club/i);
    await expect(page.locator(".brand")).toContainText("Pet Project Club");
    await expect(page.locator("#page-content")).toBeVisible();
    await expect(page.locator("[data-nav='meetings']")).toHaveCount(1);
    await expect(page.locator("[data-nav='projects']")).toHaveCount(1);
    await expect(page.locator("[data-nav='participants']")).toHaveCount(1);

    expect(failures).toEqual([]);
  });

  test("[C92] opens primary navigation pages", async ({ page, isMobile }) => {
    const failures = collectSameOriginFailures(page);

    await page.goto("/");

    for (const pageName of ["meetings", "projects", "participants", "news"]) {
      const navLink = page.locator("#main-nav").locator(`[data-nav='${pageName}']`);

      if (isMobile) {
        const toggle = page.locator("[data-menu-toggle]");
        if (!(await navLink.isVisible())) {
          await expect(toggle).toBeVisible();
          await toggle.click({ force: true });
        }
      }

      await expect(navLink).toBeVisible();
      await navLink.evaluate((link) => link.click());
      await expect(page).toHaveURL(new RegExp(`/${pageName}/$`));
      await expect(page.locator("#page-content")).toBeVisible();
    }

    expect(failures).toEqual([]);
  });

  test("[C93] renders generated detail pages", async ({ page }) => {
    const failures = collectSameOriginFailures(page);

    for (const path of [
      "/meetings/airbnb-moja-ljubov-skozi-goda/",
      "/projects/win-win/",
      "/participants/ikotelnikov/",
    ]) {
      await page.goto(path);
      await expect(page.locator("#page-content")).toBeVisible();
      await expect(page.locator("h1").first()).toBeVisible();
    }

    expect(failures).toEqual([]);
  });

  test("[C94] supports generated locale entry points", async ({ page }) => {
    const failures = collectSameOriginFailures(page);

    for (const localePath of ["/en/", "/de/", "/es/", "/me/"]) {
      await page.goto(localePath);
      await expect(page.locator(".brand")).toContainText("Pet Project Club");
      await expect(page.locator("#page-content")).toBeVisible();
    }

    expect(failures).toEqual([]);
  });
});

test.describe("mobile smoke", () => {
  test("[C95] opens and closes the mobile navigation", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile-only behavior");

    await page.goto("/");

    const toggle = page.locator("[data-menu-toggle]");
    const nav = page.locator("#main-nav");

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(nav).toHaveClass(/is-open/);

    const meetingsLink = nav.locator("[data-nav='meetings']");
    await expect(meetingsLink).toBeVisible();
    await meetingsLink.evaluate((link) => link.click());
    await expect(page).toHaveURL(/\/meetings\/$/);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
