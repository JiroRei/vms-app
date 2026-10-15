/**
 * Staff data access layer: every read of visitor, appointment, pass, email,
 * staff or settings data that a page or route handler makes goes through here.
 *
 * Each loader checks the session itself before it touches the database, so the
 * data is protected wherever it is rendered, whatever the layout, proxy or
 * caller did. That is the fix for KNOWN_ISSUES B-01: the dashboard layout was
 * the only check, and an `RSC: 1` request renders a page without waiting for
 * its layout.
 *
 * The functions in the underlying modules (`@/lib/history`, `@/lib/roll-call`,
 * ...) stay unguarded so unit tests, cron jobs and the loaders below can call
 * them. Code under `src/app` must not import them directly; `eslint.config.mjs`
 * enforces that with `no-restricted-imports`.
 */
import "server-only";
import { prunePendingKiosks } from "@/lib/kiosk-registration";

import { listStaffAppointments, countExpectedToday } from "@/lib/appointments";
import { getDashboardStats } from "@/lib/dashboard-stats";
import { listEmailLog } from "@/lib/email-outbox";
import { getHistoryQuery, getVisitHistory, getVisitorFrequency } from "@/lib/history";
import { listHosts } from "@/lib/hosts";
import { prisma } from "@/lib/prisma";
import { getPurposeOptions } from "@/lib/purposes";
import { getDailyRegister } from "@/lib/register";
import { getRollCall } from "@/lib/roll-call";
import { requireAdmin, requireStaff } from "@/lib/session";
import { listStaff } from "@/lib/staff";
import { countStaleVisits } from "@/lib/stale-visits";
import { createVisitExport } from "@/lib/visit-export";
import { listProfilesForStaff } from "@/lib/visitor-pass";
import { getActiveVisits, getVisitEvents } from "@/lib/visits";

// --- Any signed-in staff member ---

export async function loadActiveVisits() {
  await requireStaff();
  return getActiveVisits();
}

export async function loadVisitEvents(visitId: string) {
  await requireStaff();
  return getVisitEvents(visitId);
}

export async function loadStaffAppointments() {
  await requireStaff();
  return listStaffAppointments();
}

export async function loadExpectedTodayCount() {
  await requireStaff();
  return countExpectedToday();
}

export async function loadVisitHistory(query: ReturnType<typeof getHistoryQuery>) {
  await requireStaff();
  return getVisitHistory(query);
}

export async function loadVisitorFrequency(days: number) {
  await requireStaff();
  return getVisitorFrequency(days);
}

/** The full host directory (inactive hosts and contact emails included). */
export async function loadHostDirectory() {
  await requireStaff();
  return listHosts();
}

export async function loadVisitorProfiles(search: string) {
  await requireStaff();
  return listProfilesForStaff(search);
}

export async function loadDailyRegister(date: string) {
  await requireStaff();
  return getDailyRegister(date);
}

export async function loadRollCall() {
  await requireStaff();
  return getRollCall();
}

export async function loadDashboardStats() {
  await requireStaff();
  return getDashboardStats();
}

export async function loadStaleVisitCount() {
  await requireStaff();
  return countStaleVisits();
}

export async function loadKioskDevices() {
  await requireStaff();
  await prunePendingKiosks();
  return prisma.kioskDevice.findMany({ orderBy: { createdAt: "asc" } });
}

// --- Administrators only ---

export async function loadStaffAccounts() {
  await requireAdmin();
  return listStaff();
}

export async function loadPurposeSettings() {
  await requireAdmin();
  return getPurposeOptions();
}

export async function loadEmailLog(options: Parameters<typeof listEmailLog>[0]) {
  await requireAdmin();
  return listEmailLog(options);
}

export async function loadVisitExport(query: ReturnType<typeof getHistoryQuery>) {
  const session = await requireAdmin();
  return createVisitExport(session.userId, query);
}
