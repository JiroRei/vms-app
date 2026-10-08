"use client";

import { useSyncExternalStore } from "react";
import { DayPicker } from "react-day-picker";

import {
  availableSlots,
  BOOKING_TIMEZONE_LABEL,
  bookableRange,
  dateKeyInZone,
  formatDateKey,
  formatSlotTime,
  SLOT_TIMES,
  type DateKey,
} from "@/lib/booking-config";

/**
 * The current minute, or null during server rendering and hydration.
 *
 * This is how the picker avoids the hydration mismatch the old
 * `datetime-local` field once had: `getServerSnapshot` returns null, so the
 * server render and the hydration pass agree, and React re-renders with the
 * real time straight after. The 15-second subscription moves "now" forward
 * while the page stays open, so today's slots disable themselves as they pass.
 * Floored to the minute so consecutive snapshots compare equal.
 */
function subscribe(onChange: () => void) {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
}

function getSnapshot(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

function getServerSnapshot(): null {
  return null;
}

export function useCurrentMinute(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * DayPicker works in browser-local `Date`s. A booking day is a calendar day in
 * the building's zone, so keys are mapped to local midnight purely as labels —
 * the visitor's own time zone never enters the arithmetic.
 */
function keyToLocalDate(key: DateKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateToKey(date: Date): DateKey {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const dayButton =
  "flex size-10 items-center justify-center rounded-full text-sm text-gray-900 transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export type SlotValue = { date: DateKey | null; time: string | null };

export function DateTimePicker({
  value,
  onChange,
  error,
}: {
  value: SlotValue;
  onChange: (value: SlotValue) => void;
  error?: string;
}) {
  const nowMs = useCurrentMinute();

  if (nowMs === null) {
    return (
      <div
        className="h-80 animate-pulse rounded-xl bg-gray-100"
        aria-label="Loading available dates"
      />
    );
  }

  const now = new Date(nowMs);
  const { first, last } = bookableRange(now);
  const firstDate = keyToLocalDate(first);
  const lastDate = keyToLocalDate(last);

  const open = value.date ? new Set(availableSlots(value.date, now)) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-medium text-gray-800">Date</p>
        <div className="flex justify-center rounded-xl border border-gray-200 bg-white p-3">
          <DayPicker
            mode="single"
            selected={value.date ? keyToLocalDate(value.date) : undefined}
            onSelect={(date) => {
              if (!date) return;
              const key = localDateToKey(date);
              const keepTime =
                value.time && availableSlots(key, now).includes(value.time);
              onChange({ date: key, time: keepTime ? value.time : null });
            }}
            // `today` is passed rather than left to DayPicker, which would
            // read the browser's own clock and zone.
            today={keyToLocalDate(dateKeyInZone(now))}
            defaultMonth={value.date ? keyToLocalDate(value.date) : firstDate}
            startMonth={firstDate}
            endMonth={lastDate}
            disabled={[{ before: firstDate }, { after: lastDate }]}
            showOutsideDays={false}
            classNames={{
              root: "relative",
              months: "flex flex-col",
              month: "space-y-2",
              month_caption: "flex h-10 items-center px-2",
              caption_label: "text-sm font-semibold text-gray-900",
              nav: "absolute right-0 top-0 flex gap-1",
              button_previous:
                "flex size-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent",
              button_next:
                "flex size-10 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent",
              chevron: "size-4 fill-current",
              month_grid: "border-collapse",
              weekdays: "",
              weekday: "size-10 text-xs font-medium text-gray-500",
              week: "",
              day: "p-0.5 text-center",
              day_button: dayButton,
              today: "[&>button]:font-bold [&>button]:text-accent",
              selected:
                "[&>button]:bg-accent [&>button]:!text-accent-foreground [&>button]:hover:bg-accent-hover",
              disabled:
                "[&>button]:cursor-not-allowed [&>button]:!text-gray-300 [&>button]:hover:bg-transparent",
              outside: "invisible",
              hidden: "invisible",
            }}
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-gray-800">Time</p>
          <p className="text-xs text-gray-500">{BOOKING_TIMEZONE_LABEL}</p>
        </div>

        {!value.date ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
            Choose a date to see available times.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={`Times on ${formatDateKey(value.date)}`}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          >
            {SLOT_TIMES.map((time) => {
              const available = open?.has(time) ?? false;
              const selected = value.time === time;

              return (
                <button
                  key={time}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!available}
                  onClick={() => onChange({ date: value.date, time })}
                  className={`min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    selected
                      ? "border-accent bg-accent text-accent-foreground"
                      : available
                        ? "border-gray-300 bg-white text-gray-900 hover:border-accent hover:bg-accent-soft"
                        : "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300 line-through"
                  }`}
                >
                  {formatSlotTime(time)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
