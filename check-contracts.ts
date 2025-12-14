import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Check contracts table schema
  const cols = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'contracts'
    ORDER BY ordinal_position
  `);

  console.log('CONTRACTS TABLE COLUMNS:');
  for (const c of cols.rows as any[]) {
    console.log(`  ${c.column_name}: ${c.data_type}`);
  }

  // Get all contracts
  console.log('\nCONTRACTS DATA:');
  const contracts = await db.execute(sql`SELECT * FROM contracts LIMIT 20`);

  if (contracts.rows.length === 0) {
    console.log('  (No contracts defined)');
  } else {
    for (const c of contracts.rows as any[]) {
      console.log(JSON.stringify(c, null, 2));
    }
  }

  process.exit(0);
}

main().catch(console.error);
