import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const viaStaffData = "Staff-only data. Import the guarded loader from @/lib/staff-data instead; it checks the session before reading (KNOWN_ISSUES B-01).";
const restrictedLoaders = [
  ["@/lib/appointments", ["listStaffAppointments", "countExpectedToday"]],
  ["@/lib/dashboard-stats", ["getDashboardStats"]],
  ["@/lib/email-outbox", ["listEmailLog"]],
  ["@/lib/history", ["getVisitHistory", "getVisitorFrequency"]],
  ["@/lib/hosts", ["listHosts"]],
  ["@/lib/purposes", ["getPurposeOptions"]],
  ["@/lib/register", ["getDailyRegister"]],
  ["@/lib/roll-call", ["getRollCall"]],
  ["@/lib/staff", ["listStaff"]],
  ["@/lib/stale-visits", ["countStaleVisits"]],
  ["@/lib/visit-export", ["createVisitExport"]],
  ["@/lib/visitor-pass", ["listProfilesForStaff"]],
  ["@/lib/visits", ["getActiveVisits", "getVisitEvents"]],
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Pages, layouts, route handlers and components read staff data only
    // through @/lib/staff-data, whose loaders call requireStaff/requireAdmin.
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: restrictedLoaders.map(([name, importNames]) => ({ name, importNames, message: viaStaffData })),
      }],
    },
  },
  {
    // Pages, layouts and components never query the database directly.
    files: ["src/app/**/{page,layout}.tsx", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          ...restrictedLoaders.map(([name, importNames]) => ({ name, importNames, message: viaStaffData })),
          { name: "@/lib/prisma", message: "Query through a guarded loader in @/lib/staff-data so the access check sits next to the data." },
        ],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-*/**",
    "src/generated/**",
    "playwright-report/**",
    "logs/**",
    "test-results/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
