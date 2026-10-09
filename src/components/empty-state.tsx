/**
 * The "there is nothing here" message for a table or list.
 *
 * Deliberately says *why* it is empty rather than just that it is: "no visitors
 * are checked in" and "no visits match these filters" are different situations
 * and want different next steps, so the copy is always passed in by the caller.
 *
 * Renders as plain flow content so it works both on its own and inside a
 * spanning `<td>`.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string;
  title: string;
  hint?: string;
  /** Optional escape hatch, e.g. a link that clears the active filters. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </p>
      {hint && (
        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
          {hint}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
