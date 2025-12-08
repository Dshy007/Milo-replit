import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function main() {
  // Look up Adan's actual block assignments with tractor IDs
  const adanAssignments = await db.execute(sql`
    SELECT
      d.first_name,
      d.last_name,
      b.service_date,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      b.block_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND (d.first_name ILIKE '%Adan%' OR d.last_name ILIKE '%Sandhool%')
    ORDER BY b.service_date DESC
    LIMIT 20
  `);

  console.log('=== ADAN SANDHOOL SABRIYE - ACTUAL ASSIGNMENTS ===');
  console.log('');
  for (const row of adanAssignments.rows as any[]) {
    console.log(`  ${row.service_date} | ${(row.solo_type || 'N/A').padEnd(6)} | ${(row.tractor_id || 'N/A').padEnd(12)} | Block: ${row.block_id}`);
  }

  // Now check the canonical start times for Solo2 tractors
  console.log('');
  console.log('=== CANONICAL START TIMES (Holy Grail) ===');
  console.log('');
  console.log('Solo2 Tractors:');
  console.log('  solo2_Tractor_1: 18:30');
  console.log('  solo2_Tractor_2: 23:30  <-- Adan\'s slot if he works Solo2');
  console.log('  solo2_Tractor_3: 21:30');
  console.log('  solo2_Tractor_4: 08:30');
  console.log('  solo2_Tractor_5: 15:30');
  console.log('  solo2_Tractor_6: 11:30');
  console.log('  solo2_Tractor_7: 16:30');
  console.log('');
  console.log('Solo1 Tractors (for reference):');
  console.log('  solo1_Tractor_8: 00:30');
  console.log('');
  console.log('NOTE: 00:30 is Solo1 Tractor_8, but 23:30 is Solo2 Tractor_2!');
  console.log('If Adan works 23:30, he is a SOLO2 driver, not Solo1.');

  process.exit(0);
}
main();
