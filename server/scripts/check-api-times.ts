import { db } from "../db";
import { sql } from "drizzle-orm";

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function checkApiTimes() {
  // Get a few blocks with their raw timestamps
  const blocksResult = await db.execute(sql`
    SELECT
      block_id,
      service_date,
      start_timestamp
    FROM blocks
    WHERE tenant_id = ${TENANT_ID}
    AND service_date >= '2025-11-30'
    AND service_date <= '2025-12-06'
    ORDER BY service_date, start_timestamp
    LIMIT 15
  `);

  console.log('=== Block Time Comparison ===\n');

  for (const row of blocksResult.rows) {
    const block = row as any;
    const rawTs = block.start_timestamp;
    const ts = rawTs instanceof Date ? rawTs : new Date(rawTs);

    // Method 1: UTC extraction (what my script did)
    const utcTime = rawTs ? ts.toISOString().split('T')[1].slice(0, 5) : 'N/A';

    // Method 2: Local time extraction (what the API does)
    const localTime = rawTs
      ? `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`
      : 'N/A';

    console.log(`${block.block_id}:`);
    console.log(`  Raw timestamp: ${ts?.toISOString()}`);
    console.log(`  UTC time:      ${utcTime}`);
    console.log(`  Local time:    ${localTime}`);
    console.log('');
  }

  process.exit(0);
}

checkApiTimes().catch(console.error);
