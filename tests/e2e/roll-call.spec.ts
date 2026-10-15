import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { isolatedTestUrl } from "../test-database";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "../../src/lib/booking-config";
import { mkdir, writeFile } from "node:fs/promises";

const url = isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema: new URL(url).searchParams.get("schema")! }) });
const prefix = "roll-call-e2e-";
async function cleanFixtures() {
  await db.visit.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.visitor.deleteMany({ where: { id: { startsWith: prefix } } });
}
test.beforeEach(async () => {
  await cleanFixtures();
  const now = new Date();
  const count = 65;
  await db.visitor.createMany({ data: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}visitor-${index}`, firstName: index < 60 ? "Roll Call" : ["Expected Back", "Checked Out", "Yesterday", "Delivery", "Legacy Delivery"][index - 60],
    lastName: index < 60 ? String(index + 1).padStart(3, "0") : "Fixture",
    type: index >= 63 ? "DELIVERY" as const : "GUEST" as const,
    hostId: index === 0 ? null : "e2e-host", recipientDepartment: index === 0 ? "Assembly Lobby" : null,
  })) });
  await db.visit.createMany({ data: Array.from({ length: count }, (_, index) => ({
    id: `${prefix}visit-${index}`, visitorId: `${prefix}visitor-${index}`,
    checkInTime: index === 62 ? zonedTimeToUtc(addDaysToKey(dateKeyInZone(now), -1), "09:00") : now,
    status: index === 60 ? "PENDING_RETURN" as const : index === 61 || index === 63 ? "CHECKED_OUT" as const : "ACTIVE" as const,
    exitTime: index === 60 ? now : null,
    checkOutTime: index === 61 || index === 63 ? now : null,
  })) });
});
test.afterEach(cleanFixtures);
test.afterAll(() => db.$disconnect());

for (const role of ["guard", "admin"] as const) {
  test(`${role} can use roll-call, retain local ticks during refresh/polling, clear them, and print a portrait report`, async ({ page }, testInfo) => {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": role === "guard" ? "192.0.2.201" : "192.0.2.202" });
    await page.goto("/login");
    await page.getByLabel("Email").fill(`${role}@e2e.invalid`);
    await page.getByLabel("Password", { exact: true }).fill("E2ePassword123!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/dashboard/history");
    await page.locator("header").getByRole("link", { name: "Emergency roll-call", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/roll-call$/);
    await expect(page.getByRole("heading", { name: /^Emergency roll-call:/ })).toBeVisible();
    await expect(page.getByTestId("roll-call-on-site-count")).toHaveText("60");
    await expect(page.getByTestId("roll-call-expected-back-count")).toHaveText("1");
    const onSite = page.getByRole("region", { name: "Currently on site" });
    const expectedBack = page.getByRole("region", { name: "Out, expected back" });
    await expect(onSite.getByText("Expected Back Fixture")).toHaveCount(0);
    await expect(expectedBack.getByText("Expected Back Fixture")).toBeVisible();
    for (const name of ["Checked Out Fixture", "Yesterday Fixture", "Delivery Fixture", "Legacy Delivery Fixture"]) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    const tick = page.getByRole("checkbox", { name: "Accounted for Roll Call 001", exact: true });
    await expect(tick).toBeEnabled(); await tick.check();
    await expect(page.getByRole("status").filter({ hasText: "1 of 60 accounted for" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    await expect(tick).toBeChecked();
    await page.reload(); await expect(tick).toBeChecked();
    const polled = await page.waitForResponse(response => response.url().endsWith("/api/roll-call") && response.status() === 200, { timeout: 20_000 });
    expect((await polled.json()).onSite).toHaveLength(60); await expect(tick).toBeChecked();
    expect((await db.visit.findUniqueOrThrow({ where: { id: `${prefix}visit-0` } })).status).toBe("ACTIVE");
    await mkdir("logs", { recursive: true });
    await page.screenshot({ path: `logs/roll-call-${role}-screen.png` });

    await page.emulateMedia({ media: "print" });
    await expect(tick).toBeHidden();
    await expect(page.locator(".roll-call-empty-box")).toHaveCount(60);
    const rules = await page.locator(".roll-call-report").evaluate(element => ({
      page: getComputedStyle(element).page,
      rowBreak: getComputedStyle(element.querySelector("tbody tr")!).breakInside,
      header: getComputedStyle(element.querySelector("thead")!).display,
      color: getComputedStyle(element).color,
    }));
    expect(rules).toMatchObject({ page: "roll-call", rowBreak: "avoid", header: "table-header-group", color: "rgb(0, 0, 0)" });
    await expect(expectedBack).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
    await page.screenshot({ path: `logs/roll-call-${role}-print.png` });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
    await writeFile(`logs/roll-call-${role}.pdf`, pdf);
    await testInfo.attach(`Roll-call ${role} printout`, { body: pdf, contentType: "application/pdf" });
    await expect(page.getByText(new RegExp(`Printed by E2E ${role.toUpperCase()} at`))).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await expect(tick).toBeChecked();
    await page.getByRole("button", { name: "Clear ticks", exact: true }).click();
    await expect(tick).not.toBeChecked(); await page.reload(); await expect(tick).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `logs/roll-call-${role}-mobile.png` });
    await expect(page.locator("header").getByRole("link", { name: "Emergency roll-call", exact: true })).toBeVisible();
  });
}
