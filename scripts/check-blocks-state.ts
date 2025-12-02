import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function check() {
  // Check how many blocks have isRejectedLoad=true
  const rejected = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM "blocks" WHERE "is_rejected_load" = true
  `);
  console.log('Blocks with isRejectedLoad=true:', rejected.rows[0].cnt);

  // Check how many blocks have isRejectedLoad=false
  const notRejected = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM "blocks" WHERE "is_rejected_load" = false
  `);
  console.log('Blocks with isRejectedLoad=false:', notRejected.rows[0].cnt);

  // Sample a few blocks to see their state
  const sample = await db.execute(sql`
    SELECT b."block_id", b."is_rejected_load", ba."driver_id"
    FROM "blocks" b
    LEFT JOIN "block_assignments" ba ON b."id" = ba."block_id" AND ba."is_active" = true
    WHERE b."service_date" >= '2025-11-30'
    LIMIT 10
  `);
  console.log('\nSample blocks for this week:');
  sample.rows.forEach((r: any) => {
    console.log(`  ${r.block_id}: isRejectedLoad=${r.is_rejected_load}, driverId=${r.driver_id || 'NONE'}`);
  });

  process.exit(0);
}

check().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
