import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function analyze() {
  console.log('=== Block Contract Type Analysis ===\n');

  // Get distribution of contract types
  const contractDist = await db.execute(sql`
    SELECT "contractType", COUNT(*) as count
    FROM blocks
    GROUP BY "contractType"
    ORDER BY count DESC
  `);
  console.log('Contract Type Distribution:');
  for (const row of contractDist.rows) {
    console.log(`  ${row.contractType}: ${row.count}`);
  }

  // Get total
  const total = await db.execute(sql`SELECT COUNT(*) as total FROM blocks`);
  console.log(`\nTotal blocks: ${total.rows[0].total}`);

  // Check canonical start times - Solo2 tractors are typically 5-8
  // If we see Tractor_5, 6, 7, 8 marked as solo1, that's a red flag
  const suspiciousSolo1 = await db.execute(sql`
    SELECT id, "tractorId", "contractType", "serviceDate", "startTime"
    FROM blocks
    WHERE "contractType" = 'solo1'
    AND "tractorId" IN ('Tractor_5', 'Tractor_6', 'Tractor_7', 'Tractor_8')
    ORDER BY "serviceDate" DESC
    LIMIT 20
  `);

  console.log('\n=== Potential Misclassifications ===');
  console.log(`Solo1 blocks with Solo2 tractors (5-8): ${suspiciousSolo1.rows.length} found`);
  if (suspiciousSolo1.rows.length > 0) {
    console.log('\nFirst 20:');
    for (const row of suspiciousSolo1.rows) {
      console.log(`  ${row.id} | ${row.tractorId} | ${row.serviceDate} | ${row.startTime}`);
    }
  }

  // Check the reverse - Solo2 blocks with Solo1 tractors (1-4)
  const suspiciousSolo2 = await db.execute(sql`
    SELECT id, "tractorId", "contractType", "serviceDate", "startTime"
    FROM blocks
    WHERE "contractType" = 'solo2'
    AND "tractorId" IN ('Tractor_1', 'Tractor_2', 'Tractor_3', 'Tractor_4')
    ORDER BY "serviceDate" DESC
    LIMIT 20
  `);

  console.log(`\nSolo2 blocks with Solo1 tractors (1-4): ${suspiciousSolo2.rows.length} found`);
  if (suspiciousSolo2.rows.length > 0) {
    console.log('\nFirst 20:');
    for (const row of suspiciousSolo2.rows) {
      console.log(`  ${row.id} | ${row.tractorId} | ${row.serviceDate} | ${row.startTime}`);
    }
  }

  // Summary
  const solo1Count = contractDist.rows.find((r: any) => r.contractType === 'solo1')?.count || 0;
  const solo2Count = contractDist.rows.find((r: any) => r.contractType === 'solo2')?.count || 0;

  console.log('\n=== Summary ===');
  console.log(`Solo1 total: ${solo1Count}`);
  console.log(`Solo2 total: ${solo2Count}`);
  console.log(`Ratio: ${(Number(solo1Count) / (Number(solo1Count) + Number(solo2Count)) * 100).toFixed(1)}% Solo1`);

  if (suspiciousSolo1.rows.length > 0 || suspiciousSolo2.rows.length > 0) {
    console.log('\n⚠️  WARNING: Found potential misclassifications!');
    console.log('These blocks may have been assigned wrong contract types due to the duration calculation bug.');
    console.log('Consider re-importing affected data to fix classifications.');
  } else {
    console.log('\n✓ No obvious tractor/contract mismatches found');
  }

  process.exit(0);
}

analyze().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
