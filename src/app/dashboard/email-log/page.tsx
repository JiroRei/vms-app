import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { EmailStatus } from "@/generated/prisma/enums";
import { RetryEmail } from "./retry-email";
export default async function EmailLog({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  if ((await getSession())?.role !== "ADMIN") redirect("/dashboard");
  const params = await searchParams;
  const status = ["PENDING", "SENT", "FAILED"].includes(params.status ?? "") ? params.status as EmailStatus : undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.page ?? "1", 10) || 1));
  const rows = await prisma.emailOutbox.findMany({ where: { status }, select: { id: true, to: true, kind: true, status: true, attempts: true, lastError: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 50, skip: (page - 1) * 50 });
  const query = status ? `status=${status}&` : "";
  return <div className="space-y-5"><h1 className="text-2xl font-bold">Email log</h1>
    <form className="flex items-center gap-3"><label htmlFor="email-status">Status</label><select id="email-status" name="status" defaultValue={status ?? ""} className="rounded border p-2"><option value="">All</option>{["PENDING", "SENT", "FAILED"].map(value => <option key={value}>{value}</option>)}</select><button className="rounded border px-3">Filter</button></form>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Recipient", "Kind", "Status", "Attempts", "Last error", "Action"].map(value => <th key={value} className="p-3">{value}</th>)}</tr></thead><tbody>
      {rows.map(row => <tr key={row.id} className="border-t"><td className="p-3">{row.to}</td><td className="p-3">{row.kind}</td><td className="p-3">{row.status}</td><td className="p-3">{row.attempts}</td><td className="p-3">{row.lastError ?? "—"}</td><td className="p-3">{row.status !== "SENT" && (!row.expiresAt || row.expiresAt > new Date()) && <RetryEmail id={row.id} />}</td></tr>)}
    </tbody></table>{!rows.length && <p className="p-3">No messages found.</p>}</div>
    <nav aria-label="Email log pages" className="flex gap-4">{page > 1 && <Link href={`?${query}page=${page - 1}`}>Previous</Link>}{rows.length === 50 && <Link href={`?${query}page=${page + 1}`}>Next</Link>}</nav>
  </div>;
}
