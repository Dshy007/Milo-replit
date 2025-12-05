import { db } from "../db";
import { sql } from "drizzle-orm";

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function getCanonicalTimes() {
  const result = await db.execute(sql`
    SELECT type, tractor_id, start_time
    FROM contracts
    WHERE tenant_id = ${TENANT_ID}
    ORDER BY type, tractor_id
  `);

  console.log('=== All Contracts from Database ===\n');

  const solo1: string[] = [];
  const solo2: string[] = [];

  for (const row of result.rows) {
    const r = row as any;
    const key = `${r.type}_${r.tractor_id}`;
    const line = `  "${key}": "${r.start_time}",`;

    if (r.type === 'solo1') {
      solo1.push(line);
    } else if (r.type === 'solo2') {
      solo2.push(line);
    }

    console.log(`${key}: ${r.start_time}`);
  }

  console.log('\n\n=== CANONICAL_START_TIMES for code ===\n');
  console.log('const CANONICAL_START_TIMES: Record<string, string> = {');
  console.log('  // Solo1');
  for (const line of solo1) {
    console.log(line);
  }
  console.log('  // Solo2');
  for (const line of solo2) {
    console.log(line);
  }
  console.log('};');

  process.exit(0);
}

getCanonicalTimes().catch(console.error);
