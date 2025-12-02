/**
 * Script to RESET all isRejectedLoad flags to false
 * This fixes the database after the incorrect fix-rejected-loads.ts script was run
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function fixResetRejected() {
  console.log('Resetting all isRejectedLoad flags to false...');

  // Reset ALL isRejectedLoad flags to false
  await db.execute(sql`
    UPDATE "blocks"
    SET "is_rejected_load" = false
    WHERE "is_rejected_load" = true
  `);

  console.log('Done! All blocks now have isRejectedLoad=false');

  // Verify
  const count = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM "blocks" WHERE "is_rejected_load" = true
  `);
  console.log('Blocks with isRejectedLoad=true:', count.rows[0].cnt);

  process.exit(0);
}

fixResetRejected().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
