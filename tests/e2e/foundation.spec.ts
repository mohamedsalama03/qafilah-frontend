import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
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
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

async function screenshot(page: Page, name: string, fullPage = true) {
  const directory = path.resolve("artifacts/remediation/screenshots", test.info().project.name);
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(directory, `${name}.png`),
    fullPage,
    animations: "disabled",
    // Avoid Playwright injecting inline caret styles while a streamed surface hydrates.
    caret: "initial",
  });
}

async function saveEvidence(name: string, value: unknown) {
  const directory = path.resolve("artifacts/remediation");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${name}-${test.info().project.name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

const longToken = "Q".repeat(144);

// Alter only text content in the real rendered primitives, never their classes,
// widths or wrapping. This exercises extreme backend text without adding a route,
// production fixture, fabricated Store, or assumed API contract.
for (const width of [1440, 1280, 1024, 768, 390]) {
  test(`long tokens stay within the document at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/design-system/detail");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText("Everyday canvas tote");
    await heading.evaluate((element, text) => {
      element.textContent = text;
    }, longToken);
    await page.locator("main dd").evaluateAll((elements, text) => {
      elements.forEach((element) => {
        element.textContent = text;
      });
    }, longToken);
    await page.getByRole("heading", { level: 3 }).evaluate((element, text) => {
      element.textContent = text;
    }, longToken);
    await page
      .locator('[aria-current="page"]')
      .last()
      .evaluate((element, text) => {
        element.textContent = text;
      }, longToken);
    await page.getByText("No store connected", { exact: true }).evaluate((element, text) => {
      element.textContent = text;
    }, longToken);
    await expect(heading).toHaveText(longToken);
    await expect(heading).toHaveCSS("overflow-wrap", "anywhere");
    await expect(heading).toHaveCSS("text-overflow", "clip");
    await expect(heading).toHaveCSS("word-break", "normal");
    await expectNoDocumentOverflow(page);
    await screenshot(page, `long-detail-store-${width}`);

    await page.goto("/design-system/form");
    await page.getByRole("button", { name: "Validate preview" }).click();
    const field = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const errorId = await field.getAttribute("aria-describedby");
    expect(errorId).toBeTruthy();
    await page.locator(`[id="${errorId}"]`).evaluate((element, text) => {
      element.textContent = text;
    }, longToken);
    await expect(field).toHaveAccessibleDescription(longToken);
    await expectNoDocumentOverflow(page);
    await screenshot(page, `long-validation-${width}`);

    await page.goto("/design-system/table");
    if (width < 768) {
      await page.getByRole("button", { name: "Actions for EX-001", exact: true }).click();
      await expect(page.getByRole("menuitem", { name: "View detail pattern" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
      await page
        .getByRole("list", { name: "Sample records summaries" })
        .getByText("Everyday canvas tote", { exact: true })
        .evaluate((element, text) => {
          element.textContent = text;
        }, longToken);
      await expectNoDocumentOverflow(page);
      await screenshot(page, `long-resource-${width}`);
      await page.getByLabel("Preview state", { exact: true }).selectOption("loading");
    }
    const scrollRegion = page.getByRole("region", {
      name: "Sample records, scroll horizontally for more columns",
      exact: true,
    });
    await expect(scrollRegion).toHaveCSS("overflow-x", "auto");
    await expectNoDocumentOverflow(page);
    if (width < 768) {
      const containment = await scrollRegion.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(containment.scrollWidth).toBeGreaterThan(containment.clientWidth);
    }
  });
}

test("ActionMenu keyboard focus has a contrasting outline on normal and destructive items", async ({
  page,
}) => {
  await page.goto("/design-system/components");
  const trigger = page.getByRole("button", { name: "Example resource actions", exact: true });
  for (let presses = 0; presses < 40; presses += 1) {
    if (await trigger.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const measurements = [];
  for (const [index, label] of ["Inspect example", "Clear example action"].entries()) {
    if (index > 0) await page.keyboard.press("ArrowDown");
    const item = page.getByRole("menuitem", { name: label, exact: true });
    await expect(item).toBeFocused();
    await expect(item).toHaveCSS("outline-style", "solid");
    await expect(item).toHaveCSS("outline-width", "2px");
    const measurement = await item.evaluate((element) => {
      const styles = getComputedStyle(element);
      const menuStyles = getComputedStyle(element.closest('[role="menu"]')!);
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const srgb = channel / 255;
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
          });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const contrast = (color: string, adjacent: string) => {
        const first = luminance(color);
        const second = luminance(adjacent);
        return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
      };
      return {
        label: element.textContent,
        focusVisible: element.matches(":focus-visible"),
        outline: styles.outlineColor,
        outlineOffset: styles.outlineOffset,
        foreground: styles.color,
        itemBackground: styles.backgroundColor,
        menuBackground: menuStyles.backgroundColor,
        itemContrast: contrast(styles.outlineColor, styles.backgroundColor),
        menuContrast: contrast(styles.outlineColor, menuStyles.backgroundColor),
      };
    });
    expect(measurement.focusVisible).toBe(true);
    expect(measurement.itemContrast).toBeGreaterThanOrEqual(3);
    expect(measurement.menuContrast).toBeGreaterThanOrEqual(3);
    measurements.push(measurement);
    await screenshot(page, `menu-focus-${index}`, false);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await saveEvidence("menu-focus-contrast", measurements);
});

test("rendered control and drawer geometry remains accurately measurable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design-system/form");
  const radius = (element: HTMLElement | SVGElement) => getComputedStyle(element).borderRadius;
  const geometry = {
    buttonRadius: await page.getByRole("button", { name: "Validate preview" }).evaluate(radius),
    inputRadius: await page.getByRole("textbox", { name: "Name", exact: true }).evaluate(radius),
    cardRadius: await page.locator("main section").first().evaluate(radius),
    triggerHeight: await page
      .getByRole("button", { name: "Open navigation" })
      .evaluate((element) => element.getBoundingClientRect().height),
    closeHeight: 0,
    navHeight: 0,
  };
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
  geometry.closeHeight = await drawer
    .getByRole("button", { name: "Close navigation" })
    .evaluate((element) => element.getBoundingClientRect().height);
  geometry.navHeight = await drawer
    .getByRole("link", { name: "Form pattern", exact: true })
    .evaluate((element) => element.getBoundingClientRect().height);
  await saveEvidence("rendered-geometry", geometry);
  expect(geometry.triggerHeight).toBe(44);
  expect(geometry.closeHeight).toBe(44);
  expect(geometry.navHeight).toBe(40);
  expect(geometry.buttonRadius).toBe("8px");
  expect(geometry.inputRadius).toBe("8px");
  expect(geometry.cardRadius).toBe("10px");
});

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
  // SSR content alone is not hydration evidence. Opening and closing the real
  // client menu proves interactivity without changing the pagination history.
  await page.getByRole("button", { name: "Actions for EX-009", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "View detail pattern" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
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
  // The server-rendered select is usable before its React onChange is attached.
  // Exercise the real row menu in this client subtree before changing its state.
  const actions = page.getByRole("button", { name: "Actions for EX-001", exact: true });
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "View detail pattern" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(actions).toBeFocused();
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
