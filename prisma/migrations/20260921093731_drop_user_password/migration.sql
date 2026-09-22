-- Drops the dev-only plaintext password column from `user`.
--
-- Credentials now live on `account.password` as a scrypt hash, written by
-- Better Auth (and by `prisma/seed.ts` for the seeded staff logins). The values
-- dropped here were plaintext fixtures and are not recoverable — after this
-- migration, run `npm run db:seed` to re-issue the staff logins, or no one will
-- be able to sign in.

-- AlterTable
ALTER TABLE "user" DROP COLUMN "password";
