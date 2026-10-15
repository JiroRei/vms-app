import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getRollCall } from "@/lib/roll-call";
import { RollCall } from "./roll-call";

export const dynamic = "force-dynamic";
export default async function RollCallPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <RollCall initial={await getRollCall()} userId={session.userId} userName={session.name} />;
}
