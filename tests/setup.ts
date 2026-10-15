import "dotenv/config";
import { isolatedTestUrl } from "./test-database";

process.env.VMS_DEVELOPMENT_DATABASE_URL ||= process.env.DATABASE_URL;
process.env.DATABASE_URL = isolatedTestUrl(process.env.VMS_DEVELOPMENT_DATABASE_URL, process.env.DATABASE_URL_TEST);
process.env.DATABASE_URL_TEST = process.env.DATABASE_URL;
process.env.EMAIL_MODE = "test";
process.env.BETTER_AUTH_SECRET ||= "test-only-auth-secret-at-least-32-characters";
process.env.CRON_SECRET ||= "test-only-cron-secret";
