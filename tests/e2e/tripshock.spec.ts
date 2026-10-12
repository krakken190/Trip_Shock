import { expect, test, type Page } from "@playwright/test";

// The spec's E2E scenarios, driven through the UI with the deterministic mock provider.

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Delhi → Singapore → Bali demo/ }).click();
  await page.waitForURL(/\/trips\/trip_/);
  // Baseline prices arrive
  await expect(page.getByTestId("baseline-summary")).toContainText("Observed flights + hotels", { timeout: 20_000 });
  return page.url().match(/trips\/(trip_[a-z0-9]+)/)![1];
}

async function runWhatIf(page: Page, prompt: string, keepLaterDates = false) {
  await page.getByRole("tab", { name: /What if/ }).click();
  await page.getByTestId("whatif-input").fill(prompt);
  await expect(page.getByText("Understood as")).toBeVisible();
  if (keepLaterDates) await page.getByRole("radio", { name: "Keep later dates" }).click();
  await page.getByTestId("run-scenario").click();
  await expect(page.getByTestId("scenario-result")).toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/faults", { data: {} });
});

test("E2E-01 shift entire trip: dates propagate, only affected searches run, diff carries evidence", async ({ page }) => {
  await loadSample(page);
  await runWhatIf(page, "leave one day later");

  await expect(page.getByTestId("headline")).toHaveText("+1 DAY");
  await expect(page.getByTestId("diff-st_sin")).toContainText("Nov 11–14");
  await expect(page.getByTestId("diff-fl_del_sin")).toContainText("Wed, Nov 11");
  const searches = page.getByTestId("searches");
  await expect(searches).toContainText("5 re-searched");
  await expect(searches).toContainText("2 reused");
  await expect(searches).toContainText("0 failed");
  await expect(page.getByTestId("total-delta")).not.toHaveText("Unknown");
  // The museum moves onto its (simulated) closed day
  await expect(page.getByTestId("cat-activities")).toContainText("1 constraint affected");

  // Change log exposes the before/after + evidence ids
  await page.getByRole("button", { name: /Change log/ }).click();
  await expect(page.getByText("check_in").first()).toBeVisible();
  await page.locator("button", { hasText: /^ev_/ }).first().click();
  await expect(page.getByRole("dialog")).toContainText("Exact query");
  await expect(page.getByRole("dialog")).toContainText("Observed at");
});

test("E2E-02 extend one city by one night: checkout moves, next stay absorbs", async ({ page }) => {
  await loadSample(page);
  await runWhatIf(page, "one more night in Singapore", true);

  await expect(page.getByTestId("diff-st_sin")).toContainText("Nov 10–14 · 4 nights");
  await expect(page.getByTestId("diff-fl_sin_dps")).toContainText("Sat, Nov 14");
  await expect(page.getByTestId("diff-st_bali")).toContainText("Nov 14–17 · 3 nights");
  await expect(page.getByTestId("diff-fl_dps_del")).toContainText("same search · reused");
  await expect(page.getByTestId("searches")).toContainText("3 re-searched");
});

test("E2E-03 locked node: fixed flight holds, conflict surfaces", async ({ page }) => {
  await loadSample(page);
  const card = page.getByTestId("node-fl_del_sin");
  await card.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Fix in place" }).click();
  await expect(card.getByRole("button", { name: "Fixed" })).toBeVisible();

  await runWhatIf(page, "leave one day later");
  await expect(page.getByTestId("diff-fl_del_sin")).toContainText("held · fixed");
  await expect(page.getByTestId("diff-fl_del_sin")).toContainText("Tue, Nov 10");
  await expect(page.getByTestId("conflicts")).toContainText("without a hotel");
  await expect(page.getByTestId("conflicts")).toContainText("DEL → SIN is fixed");
});

test("E2E-04 price search unavailable: dates recompute, prices marked unavailable, total partial", async ({ page, request }) => {
  await loadSample(page);
  await request.post("/api/dev/faults", { data: { flights: "error" } });
  await runWhatIf(page, "leave 4 days later");

  await expect(page.getByTestId("diff-fl_sin_dps")).toContainText("Tue, Nov 17");
  await expect(page.getByTestId("diff-fl_sin_dps")).toContainText("Unavailable");
  await expect(page.getByTestId("diff-fl_sin_dps")).not.toContainText("same search");
  await expect(page.getByTestId("cat-flights")).toContainText("unknown");
  await expect(page.getByTestId("partial-note")).toContainText("excludes");
  await expect(page.getByTestId("searches")).toContainText("3 failed");
  await expect(page.getByTestId("unknowns")).toContainText("search failed");
});

test("E2E-05 revert: deleting a scenario leaves the baseline unchanged", async ({ page, request }) => {
  const tripId = await loadSample(page);
  const before = await (await request.get(`/api/trips/${tripId}`)).json();

  await runWhatIf(page, "leave 2 days later");
  await page.getByRole("button", { name: "Delete scenario" }).click();
  await page.getByTestId("confirm-delete-scenario").click();
  await expect(page.getByText("Scenario deleted — baseline unchanged")).toBeVisible();

  const after = await (await request.get(`/api/trips/${tripId}`)).json();
  expect(after.trip).toEqual(before.trip);
  expect(after.scenarios).toHaveLength(0);
});
