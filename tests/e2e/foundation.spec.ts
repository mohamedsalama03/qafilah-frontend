import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const browserErrors = new WeakMap<Page, string[]>();
const surfaces = [
  { route: "/design-system", name: "home", heading: "Home" },
  { route: "/design-system/table", name: "table", heading: "Sample records" },
  { route: "/design-system/detail", name: "detail", heading: "Everyday canvas tote" },
  { route: "/design-system/form", name: "form", heading: "Form pattern" },
  { route: "/design-system/components", name: "components", heading: "Components & states" },
  { route: "/design-system/login", name: "login", heading: "Sign in to your workspace" },
];

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|did not match|invalid hook|content security policy|refused to.*script/i.test(
        message.text(),
      )
    )
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? [], "No runtime, hydration, or script-policy errors").toEqual(
    [],
  );
});

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function screenshot(page: Page, name: string, fullPage = true) {
  const directory = path.resolve("artifacts/screenshots");
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
}

for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`review surfaces remain readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    for (const surface of surfaces) {
      await test.step(surface.name, async () => {
        await page.goto(surface.route);
        await expect(page.getByRole("heading", { name: surface.heading, level: 1 })).toBeVisible();
        await expectNoDocumentOverflow(page);
        if (surface.name !== "login")
          await expect(
            page.getByText("Development only. Examples are not live store data.", { exact: false }),
          ).toBeVisible();
        if (surface.name === "table" && width < 768) {
          await expect(page.getByRole("list", { name: "Sample records summaries" })).toBeVisible();
          await expect(page.getByRole("table")).toBeHidden();
        }
        if (surface.name === "login") {
          await expect(page.getByRole("textbox", { name: "Email address" })).toBeDisabled();
          await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
          await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
        }
        await screenshot(page, `${surface.name}-${width}`);
      });
    }
  });
}

for (const scenario of [
  { route: "/design-system/table", width: 1440 },
  { route: "/design-system/form", width: 390 },
  { route: "/design-system/components", width: 1440 },
  { route: "/design-system", width: 390 },
]) {
  test(`WCAG checks for ${scenario.route} at ${scenario.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.goto(scenario.route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    await testInfo.attach("accessibility-results", {
      body: JSON.stringify(
        {
          passes: results.passes.length,
          incomplete: results.incomplete,
          violations: results.violations,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test("mobile navigation contains focus and closes with Escape, outside click and navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design-system");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  const close = drawer.getByRole("button", { name: "Close navigation" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    drawer.getByRole("link", { name: "Components & states", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await screenshot(page, "navigation-390", false);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(380, 430);
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: "Table pattern", exact: true }).click();
  await expect(page).toHaveURL(/\/design-system\/table$/);
  await expect(drawer).toBeHidden();
  await trigger.click();
  await page.goBack();
  await expect(page).toHaveURL(/\/design-system$/);
  await expect(drawer).toBeHidden();
});

test("table pagination is URL-addressable and follows browser history", async ({ page }) => {
  await page.goto("/design-system/table");
  const table = page.getByRole("table", { name: "Sample records" });
  await expect(table.getByText("EX-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/\/design-system\/table\?page=2$/);
  await expect(table.getByText("EX-009", { exact: true })).toBeVisible();
  await expect(table.getByText("EX-001", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.reload();
  await expect(table.getByText("EX-009", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(table.getByText("EX-001", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(table.getByText("EX-009", { exact: true })).toBeVisible();
  await page.goto("/design-system/table?page=untrusted&state=untrusted");
  await expect(table.getByText("EX-001", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preview state", { exact: true })).toHaveValue("standard");
});

test("table loading, empty and error states preserve context and recovery", async ({ page }) => {
  await page.goto("/design-system/table");
  const state = page.getByLabel("Preview state", { exact: true });
  await state.selectOption("loading");
  await expect(page).toHaveURL(/state=loading/);
  await expect(page.getByRole("status")).toContainText("Loading sample records");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await expect(page.getByText("EX-001", { exact: true })).toHaveCount(0);
  await screenshot(page, "table-loading-1440");
  await state.selectOption("empty");
  await expect(page.getByRole("heading", { name: "No records to display" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await screenshot(page, "table-empty-1440");
  await state.selectOption("error");
  await expect(
    page.getByRole("region", { name: "Sample records", exact: true }).getByRole("alert"),
  ).toContainText("Records couldn’t load");
  await expect(page.getByRole("table")).toHaveCount(0);
  await screenshot(page, "table-error-1440");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(state).toHaveValue("standard");
  await expect(page.getByRole("table").getByText("EX-001", { exact: true })).toBeVisible();
});

test("resource actions support keyboard navigation and restore focus", async ({ page }) => {
  await page.goto("/design-system/table");
  const trigger = page.getByRole("button", { name: "Actions for EX-001", exact: true });
  // Reach the trigger as a keyboard user; direct programmatic focus skips input modality.
  for (let presses = 0; presses < 30; presses += 1) {
    if (await trigger.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const item = page.getByRole("menuitem", { name: "View detail pattern" });
  await expect(item).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(item).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/design-system\/detail$/);
  await expect(page.getByRole("heading", { name: "Everyday canvas tote", level: 1 })).toBeVisible();
});

test("form validation focuses the first field and keeps server-style field errors inline", async ({
  page,
}) => {
  await page.goto("/design-system/form");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const reference = page.getByRole("textbox", { name: "Reference", exact: true });
  await page.getByRole("button", { name: "Validate preview" }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Enter a name for this example.");
  await name.fill("E2E example");
  await reference.fill("EX-E2E");
  await page.getByLabel("Preview response", { exact: true }).selectOption("validation");
  await page.getByRole("button", { name: "Validate preview" }).click();
  await expect(page.getByRole("button", { name: "Validating…" })).toBeDisabled();
  await expect(reference).toBeFocused();
  await expect(reference).toHaveAccessibleDescription(
    "A short label for this example. This example reference is already in use.",
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Check the highlighted field.",
  );
  await screenshot(page, "form-errors-1440");
  await page.getByLabel("Preview response", { exact: true }).selectOption("confirm");
  await page.getByRole("button", { name: "Validate preview" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Preview validated. Nothing was sent or saved.",
  );
  await expect(reference).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Dismiss confirmation" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("confirmation supports deliberate cancel, confirm and focus restoration", async ({ page }) => {
  await page.goto("/design-system/components");
  const trigger = page.getByRole("button", { name: "Open confirmation" });
  await trigger.click();
  const dialog = page.getByRole("alertdialog", { name: "Clear this example?" });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(dialog).toHaveAccessibleDescription(
    "This demonstrates a deliberate confirmation. Only the component example is affected; no store data is changed.",
  );
  await screenshot(page, "confirmation-1440", false);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("status")).toHaveCount(0);
  await trigger.click();
  await dialog.getByRole("button", { name: "Clear example", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(
    "Example confirmation completed. No store data changed.",
  );
});

test("error families keep distinct safe messages and support keyboard tabs", async ({ page }) => {
  await page.goto("/design-system/components");
  const componentsTab = page.getByRole("tab", { name: "Components", exact: true });
  await componentsTab.focus();
  await page.keyboard.press("ArrowRight");
  const statesTab = page.getByRole("tab", { name: "Loading & errors" });
  await expect(statesTab).toBeFocused();
  await expect(statesTab).toHaveAttribute("aria-selected", "true");
  const families = [
    ["unauthenticated", "Sign in to continue"],
    ["forbidden", "You don’t have access"],
    ["not-found", "Record not found"],
    ["conflict", "This record has changed"],
    ["session-expired", "Your session has expired"],
    ["validation", "Check your changes"],
    ["rate-limited", "Please wait before trying again"],
    ["server", "The service couldn’t complete the request"],
    ["network", "Unable to connect"],
    ["timeout", "The request took too long"],
  ];
  for (const [value, title] of families) {
    await page.getByLabel("Preview error", { exact: true }).selectOption(value);
    await expect(
      page
        .getByRole("tabpanel", { name: "Loading & errors" })
        .getByRole("alert")
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: "Loading & errors" }).getByRole("alert"),
    ).not.toContainText(/SQLSTATE|stack trace|Bearer|\/var\/www|exception:/i);
  }
  await screenshot(page, "error-states-1440");
});
