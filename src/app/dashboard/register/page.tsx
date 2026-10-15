import { PrintButton, PrintFooter } from "@/components/print-button";
import { PrintTable } from "@/components/print-table";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/booking-config";
import { formatFullName } from "@/lib/names";
import { requireStaff } from "@/lib/session";
import { loadDailyRegister } from "@/lib/staff-data";
import { ORGANIZATION_NAME, SITE_TIMEZONE_LABEL } from "@/lib/site-config";
import { reportTimestamp } from "@/lib/visit-report";

export default async function RegisterPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireStaff();
  const params = await searchParams;
  let date = typeof params.date === "string" ? params.date : dateKeyInZone(new Date());
  try { zonedTimeToUtc(date, "00:00"); } catch { date = dateKeyInZone(new Date()); }
  const { visits, summary } = await loadDailyRegister(date);
  const title = `Visitor Register: ${ORGANIZATION_NAME} - ${date}`;

  return (
    <div className="print-report space-y-5 text-gray-900 dark:text-white">
      <div className="print-hidden flex flex-wrap items-end gap-3">
        <form action="/dashboard/register" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Register date
            <input type="date" name="date" defaultValue={date} required className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
          </label>
          <button type="submit" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600">View register</button>
        </form>
        <PrintButton />
        <p className="text-sm text-gray-500 dark:text-gray-400">{SITE_TIMEZONE_LABEL}</p>
      </div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {[["Total visits", summary.total], ["Deliveries", summary.deliveries], ["Still on site", summary.onSite], ["Auto-closed", summary.autoClosed]].map(([label, count]) => (
          <div key={label} className="flex gap-2"><dt>{label}:</dt><dd className="font-semibold">{count}</dd></div>
        ))}
      </dl>
      <PrintTable caption={title} rows={visits} rowKey={(visit) => visit.id} columns={[
        { key: "no", label: "No.", render: (_, index) => index + 1 },
        { key: "name", label: "Name", render: (visit) => formatFullName(visit.visitor.firstName, visit.visitor.lastName) },
        { key: "type", label: "Type", render: (visit) => visit.visitor.type === "DELIVERY" ? "Delivery" : "Guest" },
        { key: "purpose", label: "Purpose", render: (visit) => visit.visitor.purpose?.label ?? "" },
        { key: "host", label: "Host/destination", render: (visit) => visit.visitor.host?.name ?? visit.visitor.recipientDepartment ?? "" },
        { key: "in", label: "Time in", render: (visit) => reportTimestamp(visit.checkInTime).slice(11) },
        { key: "out", label: "Time out", render: (visit) => visit.closedAutomatically ? "Auto-closed" : visit.status === "PENDING_RETURN" ? "Out (returning)" : visit.status === "ACTIVE" ? "On site" : visit.checkOutTime ? reportTimestamp(visit.checkOutTime).slice(11) : "" },
      ]} />
      <PrintFooter name={session.name} initialTimestamp={new Date().toISOString()} />
    </div>
  );
}
