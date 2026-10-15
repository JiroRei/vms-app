/** Local end-to-end reset check; deletes its temporary account and tokens. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";

async function main() {
  const origin = "http://localhost:3000";
  const id = `reset-http-${randomUUID()}`;
  const email = `${id}@example.invalid`;
  const oldPassword = randomUUID();
  const newPassword = randomUUID();
  let verificationId: string | null = null;

  try {
    await prisma.user.create({
      data: {
        id,
        email,
        name: "Password Reset Test",
        role: "GUARD",
        emailVerified: true,
        accounts: {
          create: {
            id,
            accountId: id,
            providerId: "credential",
            password: await hashPassword(oldPassword),
          },
        },
      },
    });

    const login = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password: oldPassword }),
    });
    assert.equal(login.status, 200, await login.text());
    assert.ok(await prisma.session.count({ where: { userId: id } }));

    const requested = await fetch(`${origin}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, redirectTo: `${origin}/reset-password` }),
    });
    const requestResult = await requested.json();
    assert.equal(requested.status, 200, JSON.stringify(requestResult));
    assert.match(requestResult.message, /If this email exists/);

    const verification = await prisma.verification.findFirstOrThrow({
      where: { identifier: { startsWith: "reset-password:" }, value: id },
    });
    verificationId = verification.id;
    const token = verification.identifier.slice("reset-password:".length);
    assert.ok(verification.expiresAt.getTime() > Date.now());

    const callback = await fetch(
      `${origin}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(`${origin}/reset-password`)}`,
      { redirect: "manual", headers: { Origin: origin } },
    );
    assert.equal(callback.status, 302);
    assert.match(callback.headers.get("location") ?? "", /reset-password\?token=/);

    const reset = await fetch(`${origin}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ token, newPassword }),
    });
    assert.equal(reset.status, 200, await reset.text());
    assert.equal(await prisma.session.count({ where: { userId: id } }), 0);

    const oldLogin = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password: oldPassword }),
    });
    assert.notEqual(oldLogin.status, 200);
    const newLogin = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password: newPassword }),
    });
    assert.equal(newLogin.status, 200, await newLogin.text());
    console.log("Password reset HTTP checks passed: generic request, expiring token, reset callback, password change and session revocation.");
  } finally {
    if (verificationId) await prisma.verification.deleteMany({ where: { id: verificationId } });
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.account.deleteMany({ where: { userId: id } });
    await prisma.user.deleteMany({ where: { id } });
    await prisma.$disconnect();
    console.log("Temporary password reset account and tokens removed.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
