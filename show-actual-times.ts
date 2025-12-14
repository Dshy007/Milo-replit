import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db.execute(sql`
    SELECT id, solo_type, tractor_id,
           TO_CHAR(start_timestamp, 'HH24:MI') as actual_time,
           TO_CHAR(service_date, 'YYYY-MM-DD') as service_date
    FROM blocks
    WHERE service_date >= CURRENT_DATE
    ORDER BY service_date, start_timestamp
    LIMIT 15
  `);

  console.log('ACTUAL TIMES IN DATABASE vs HARDCODED LOOKUP:');
  console.log('='.repeat(70));

  const CANONICAL_START_TIMES: Record<string, string> = {
    "solo1_Tractor_1": "16:30", "solo1_Tractor_2": "20:30", "solo1_Tractor_3": "20:30",
    "solo1_Tractor_4": "17:30", "solo1_Tractor_5": "21:30", "solo1_Tractor_6": "01:30",
    "solo1_Tractor_7": "18:30", "solo1_Tractor_8": "00:30", "solo1_Tractor_9": "16:30",
    "solo1_Tractor_10": "20:30",
    "solo2_Tractor_1": "18:30", "solo2_Tractor_2": "23:30", "solo2_Tractor_3": "21:30",
    "solo2_Tractor_4": "08:30", "solo2_Tractor_5": "15:30", "solo2_Tractor_6": "11:30",
    "solo2_Tractor_7": "16:30",
  };

  for (const row of r.rows as any[]) {
    const key = `${row.solo_type}_${row.tractor_id}`;
    const hardcoded = CANONICAL_START_TIMES[key] || 'NOT FOUND';
    const match = row.actual_time === hardcoded ? '✓' : '✗ MISMATCH';
    console.log(`${key.padEnd(20)} DB: ${row.actual_time} | Hardcoded: ${hardcoded} ${match}`);
  }

  process.exit(0);
}

main().catch(console.error);
