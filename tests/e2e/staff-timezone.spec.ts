import { test, expect } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";
import { databaseAdapter } from "../../src/lib/database-config";
import { isolatedTestUrl } from "../test-database";
import { addDaysToKey, dateKeyInZone, toSlotValue, zonedTimeToUtc } from "../../src/lib/booking-config";

const db = new PrismaClient({ adapter: databaseAdapter(isolatedTestUrl(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST)) });
test.afterAll(() => db.$disconnect());

for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
  test(`staff create and reschedule keep 10:00 site time in ${timezoneId}`, async ({ browser }) => {
    const context = await browser.newContext({ timezoneId, extraHTTPHeaders: { "x-forwarded-for": timezoneId === "UTC" ? "192.0.2.230" : "192.0.2.231" } });
    const page = await context.newPage();
    const email = `timezone-${timezoneId.replaceAll("/", "-").toLowerCase()}@e2e.invalid`;
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill("guard@e2e.invalid");
      await page.getByLabel("Password", { exact: true }).fill("E2ePassword123!");
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.goto("/dashboard/appointments");
      await page.getByLabel("First name", { exact: true }).fill("Timezone");
      await page.getByLabel("Last name", { exact: true }).fill(timezoneId.replaceAll("/", " "));
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Purpose", { exact: true }).selectOption("e2e-purpose");
      await page.getByLabel("Host", { exact: true }).selectOption("e2e-host");
      const day = addDaysToKey(dateKeyInZone(new Date()), 2);
      await page.getByLabel(/^Expected/).fill(toSlotValue(day, "10:00"));
      const created = page.waitForResponse(response => response.url().endsWith("/api/appointments/manage") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Create appointment", exact: true }).click();
      expect((await created).status()).toBe(201);
      const appointment = await db.appointment.findFirstOrThrow({ where: { visitorEmail: email } });
      expect(appointment.scheduledFor.toISOString()).toBe(zonedTimeToUtc(day, "10:00").toISOString());
      await page.getByRole("tab", { name: /Upcoming/ }).click();
      const row = page.getByRole("row").filter({ hasText: appointment.referenceNumber });
      await expect(row).toContainText("10:00 AM");
      await row.getByRole("button", { name: "Reschedule", exact: true }).click();
      await expect(row.getByLabel(/^New time/)).toHaveValue(toSlotValue(day, "10:00"));
      const nextDay = addDaysToKey(day, 1);
      await row.getByLabel(/^New time/).fill(toSlotValue(nextDay, "10:00"));
      const moved = page.waitForResponse(response => response.url().endsWith("/reschedule"));
      await row.getByRole("button", { name: "Save", exact: true }).click();
      expect((await moved).status()).toBe(200);
      expect((await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).scheduledFor.toISOString()).toBe(zonedTimeToUtc(nextDay, "10:00").toISOString());
      await expect(row).toContainText("10:00 AM");
      // Exercise the date filter's site-day boundary with a just-after-midnight visit.
      const visitor = await db.visitor.create({ data: { firstName: "Boundary", lastName: timezoneId, hostId: "e2e-host", purposeId: "e2e-purpose", visits: { create: { checkInTime: zonedTimeToUtc(day, "00:01"), checkOutTime: zonedTimeToUtc(day, "00:10"), status: "CHECKED_OUT" } } } });
      try {
        await page.goto(`/dashboard/history?from=${day}&to=${day}&search=Boundary`);
        await expect(page.getByRole("row").filter({ hasText: timezoneId })).toContainText("12:01 AM");
        await page.goto(`/dashboard/history?from=${nextDay}&to=${nextDay}&search=Boundary`);
        await expect(page.getByRole("row").filter({ hasText: timezoneId })).toHaveCount(0);
      } finally { await db.visit.deleteMany({ where: { visitorId: visitor.id } }); await db.visitor.delete({ where: { id: visitor.id } }); }
    } finally {
      await db.appointment.deleteMany({ where: { visitorEmail: email } });
      await context.close();
    }
  });
}
