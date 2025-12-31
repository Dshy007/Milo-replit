import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const blocks = await db.execute(sql`SELECT COUNT(*) as cnt FROM blocks`);
  const assignments = await db.execute(sql`SELECT COUNT(*) as cnt FROM block_assignments`);
  console.log('Before clear:');
  console.log('  Blocks:', blocks.rows[0]);
  console.log('  Assignments:', assignments.rows[0]);
  process.exit(0);
}
main();
