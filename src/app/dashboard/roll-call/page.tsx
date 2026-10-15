import { requireStaff } from "@/lib/session";
import { loadRollCall } from "@/lib/staff-data";
import { RollCall } from "./roll-call";

export const dynamic = "force-dynamic";
export default async function RollCallPage() {
  const session = await requireStaff();
  return <RollCall initial={await loadRollCall()} userId={session.userId} userName={session.name} />;
}
