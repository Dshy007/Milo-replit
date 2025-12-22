
import 'dotenv/config';
import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Adding solo_type column to drivers table...");
  try {
    await db.execute(sql`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS solo_type text;`);
    console.log("Success: Added solo_type column.");
  } catch (error) {
    console.error("Error adding column:", error);
  }
  process.exit(0);
}

main();
