/** Production refuses a missing or public BETTER_AUTH_SECRET (KNOWN_ISSUES N-13). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertProductionAuthSecret, authSecretProblem } from "@/lib/auth-secret";

test("missing, default, sample and short secrets are refused", () => {
  const sample = /^BETTER_AUTH_SECRET="([^"]+)"/m.exec(readFileSync(".env.example", "utf8"))?.[1];
  assert.ok(sample, ".env.example carries a sample secret");
  for (const value of [undefined, "", "   ", "better-auth-secret-12345678901234567890", sample, "too-short"]) {
    assert.ok(authSecretProblem(value), `accepted ${JSON.stringify(value)}`);
    // undefined would fall back to process.env, so pass "" for the missing case.
    assert.throws(() => assertProductionAuthSecret(value ?? ""), /BETTER_AUTH_SECRET/);
  }
});

test("a private secret of at least 32 characters is accepted", () => {
  assert.equal(authSecretProblem("q3J9zX0vL1mN8bT4cR7yU2wE5aS6dF0g"), null);
  assert.doesNotThrow(() => assertProductionAuthSecret("q3J9zX0vL1mN8bT4cR7yU2wE5aS6dF0g"));
});
