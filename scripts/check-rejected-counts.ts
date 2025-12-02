import { db } from '../server/db';
import { blocks } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

async function checkBlocks() {
  // Count rejected vs not rejected
  const rejected = await db.select()
    .from(blocks)
    .where(eq(blocks.isRejectedLoad, true));

  const notRejected = await db.select()
    .from(blocks)
    .where(eq(blocks.isRejectedLoad, false));

  console.log('Blocks with isRejectedLoad=true:', rejected.length);
  console.log('Blocks with isRejectedLoad=false:', notRejected.length);
  process.exit(0);
}

checkBlocks().catch(e => { console.error(e); process.exit(1); });
