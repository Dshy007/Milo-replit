import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function main() {
  // Check how drivers are associated with contract types
  const result = await db.execute(sql`
    SELECT d.id, d.first_name, d.last_name, b.solo_type, COUNT(*) as cnt
    FROM drivers d
    JOIN block_assignments ba ON ba.driver_id = d.id
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    GROUP BY d.id, d.first_name, d.last_name, b.solo_type
    ORDER BY cnt DESC
    LIMIT 10
  `);
  console.log('Driver contract types (from assignments):');
  for (const r of result.rows) {
    console.log(`  ${r.first_name} ${r.last_name}: ${r.solo_type} (${r.cnt} assignments)`);
  }
}

main().then(() => process.exit(0));
