"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTheme } from "@/components/theme-provider";
import type { FrequencyPoint } from "@/lib/history";

type Range = "week" | "month";

/**
 * Chart colors are selected per mode, not flipped programmatically. Both steps
 * clear the lightness band, chroma floor and 3:1 contrast against their own
 * surface (#ffffff light, #1f2937 dark).
 */
const THEME = {
  light: {
    series: "#2a78d6",
    grid: "#e5e7eb",
    axisText: "#6b7280",
    tooltipSurface: "#ffffff",
    tooltipBorder: "#e5e7eb",
    tooltipPrimary: "#111827",
    tooltipMuted: "#6b7280",
  },
  dark: {
    series: "#3987e5",
    grid: "#374151",
    axisText: "#9ca3af",
    tooltipSurface: "#1f2937",
    tooltipBorder: "#374151",
    tooltipPrimary: "#f9fafb",
    tooltipMuted: "#9ca3af",
  },
} as const;

function RangeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-md bg-white px-3 py-1 text-xs font-semibold text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white"
          : "rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      }
    >
      {children}
    </button>
  );
}

export function VisitorFrequencyChart({
  /** Always 30 days; the week view slices the tail so toggling needs no refetch. */
  data,
}: {
  data: FrequencyPoint[];
}) {
  const { theme } = useTheme();
  const [range, setRange] = useState<Range>("week");

  const colors = THEME[theme];
  const points = useMemo(
    () => (range === "week" ? data.slice(-7) : data),
    [data, range],
  );

  const total = useMemo(
    () => points.reduce((sum, point) => sum + point.count, 0),
    [points],
  );

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Visitors per day
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {total} {total === 1 ? "visit" : "visits"} in the last{" "}
            {range === "week" ? "7" : "30"} days
          </p>
        </div>

        <div
          role="group"
          aria-label="Chart range"
          className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700/50"
        >
          <RangeButton
            active={range === "week"}
            onClick={() => setRange("week")}
          >
            Week
          </RangeButton>
          <RangeButton
            active={range === "month"}
            onClick={() => setRange("month")}
          >
            Month
          </RangeButton>
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={points}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            barCategoryGap={range === "week" ? "25%" : "15%"}
          >
            <CartesianGrid
              vertical={false}
              stroke={colors.grid}
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: colors.axisText, fontSize: 11 }}
              // Thin the labels on the 30-day view so they don't collide.
              interval={range === "week" ? 0 : 4}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tick={{ fill: colors.axisText, fontSize: 11 }}
              width={40}
            />
            <Tooltip
              cursor={{ fill: colors.grid, fillOpacity: 0.35 }}
              contentStyle={{
                backgroundColor: colors.tooltipSurface,
                border: `1px solid ${colors.tooltipBorder}`,
                borderRadius: 8,
                fontSize: 12,
                boxShadow: "0 1px 2px rgb(0 0 0 / 0.05)",
              }}
              labelStyle={{ color: colors.tooltipPrimary, fontWeight: 600 }}
              itemStyle={{ color: colors.tooltipMuted }}
              formatter={(value) => {
                const count = Number(value ?? 0);
                return [`${count} ${count === 1 ? "visit" : "visits"}`, ""];
              }}
            />
            <Bar
              dataKey="count"
              fill={colors.series}
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
