"use client";

import { useId, useState } from "react";

import type { HostOption } from "@/lib/visits";

/**
 * A type-to-filter select over the host list, matching on name or department.
 * Follows the ARIA combobox pattern: arrow keys move through the options,
 * Enter picks, Escape closes.
 */
export function HostCombobox({
  id,
  hosts,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  hosts: HostOption[];
  value: string;
  onChange: (hostId: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = hosts.find((host) => host.id === value) ?? null;
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? hosts.filter(
        (host) =>
          host.name.toLowerCase().includes(needle) ||
          host.department.toLowerCase().includes(needle),
      )
    : hosts;

  function pick(host: HostOption) {
    onChange(host.id);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (matches[active]) pick(matches[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && matches[active] ? `${listId}-${matches[active].id}` : undefined
        }
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Search by name or department"
        value={open ? query : (selected?.name ?? "")}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={`block min-h-12 w-full rounded-lg border bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-2 focus:outline-offset-0 focus:outline-accent ${
          invalid ? "border-red-500" : "border-gray-300"
        }`}
      />

      {selected && !open && (
        <p className="mt-1 text-sm text-gray-600">{selected.department}</p>
      )}

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-sm text-gray-500">
              No one matches &ldquo;{query}&rdquo;.
            </li>
          ) : (
            matches.map((host, index) => (
              <li
                key={host.id}
                id={`${listId}-${host.id}`}
                role="option"
                aria-selected={host.id === value}
                // mousedown, not click: it fires before the input's blur
                // closes the list.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(host);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-3 py-2.5 ${
                  index === active ? "bg-accent-soft" : ""
                }`}
              >
                <span className="block text-sm font-medium text-gray-900">
                  {host.name}
                  {host.id === value && (
                    <span className="ml-2 text-accent" aria-hidden>
                      ✓
                    </span>
                  )}
                </span>
                <span className="block text-xs text-gray-500">
                  {host.department}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
