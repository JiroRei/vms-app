/**
 * Where the e2e server writes the emails it "sends" (EMAIL_MODE=test with
 * EMAIL_TEST_SINK, see src/lib/email-outbox.ts). The outbox itself keeps no
 * bodies once a message is sent, so tests read codes from here.
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const E2E_MAIL_SINK = join(tmpdir(), "vms-e2e-mail.jsonl");

export type SentMail = { to: string; kind: string; subject: string; text: string };

export function sentMail(): SentMail[] {
  if (!existsSync(E2E_MAIL_SINK)) return [];
  return readFileSync(E2E_MAIL_SINK, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as SentMail);
}
