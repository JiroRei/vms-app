import type { ReactNode } from "react";

export type PrintColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row, index: number) => ReactNode;
};

/** Semantic table and print rules shared with future roll-call reports. */
export function PrintTable<Row>({ columns, rows, rowKey, caption, emptyMessage = "No visits on this day." }: {
  columns: readonly PrintColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption: string;
  emptyMessage?: string;
}) {
  return (
    <div className="print-table-wrap overflow-x-auto">
      <table className="print-table w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col" className="border border-gray-400 px-3 py-2 font-semibold">{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row)}>{columns.map((column) => <td key={column.key} className="border border-gray-400 px-3 py-2 align-top">{column.render(row, index)}</td>)}</tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length} className="border border-gray-400 p-4 text-center">{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
