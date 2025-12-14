import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(80));
  console.log('XGBOOST TRAINING DATA ANALYSIS');
  console.log('='.repeat(80));

  // 1. Total assignments in PostgreSQL
  const totalAssignments = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM block_assignments
  `);
  console.log('\n1. TOTAL ASSIGNMENTS IN POSTGRESQL:', (totalAssignments.rows[0] as any).cnt);

  // 2. Date range of assignments
  const dateRange = await db.execute(sql`
    SELECT
      MIN(b.service_date)::text as earliest,
      MAX(b.service_date)::text as latest
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
  `);
  const dr = dateRange.rows[0] as any;
  console.log('\n2. DATE RANGE OF ASSIGNMENTS:');
  console.log('   Earliest:', dr.earliest);
  console.log('   Latest:', dr.latest);

  // 3. Breakdown by week
  console.log('\n3. ASSIGNMENTS BY WEEK:');
  const byWeek = await db.execute(sql`
    SELECT
      DATE_TRUNC('week', b.service_date)::date as week_start,
      COUNT(*) as assignments
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    GROUP BY DATE_TRUNC('week', b.service_date)
    ORDER BY week_start
  `);

  console.log('\n   Week Start   | Assignments');
  console.log('   ' + '-'.repeat(30));
  for (const w of byWeek.rows as any[]) {
    const ws = String(w.week_start).substring(0, 10);
    console.log(`   ${ws}  | ${w.assignments}`);
  }

  // 4. Unique drivers with assignments
  const uniqueDrivers = await db.execute(sql`
    SELECT COUNT(DISTINCT driver_id) as cnt FROM block_assignments
  `);
  console.log('\n4. UNIQUE DRIVERS WITH ASSIGNMENTS:', (uniqueDrivers.rows[0] as any).cnt);

  // 5. Top drivers by assignment count
  console.log('\n5. TOP 10 DRIVERS BY ASSIGNMENT COUNT:');
  const topDrivers = await db.execute(sql`
    SELECT
      d.first_name || ' ' || d.last_name as name,
      COUNT(*) as assignments
    FROM block_assignments ba
    JOIN drivers d ON ba.driver_id = d.id
    GROUP BY d.id, d.first_name, d.last_name
    ORDER BY COUNT(*) DESC
    LIMIT 10
  `);

  for (const d of topDrivers.rows as any[]) {
    console.log(`   ${d.name}: ${d.assignments} assignments`);
  }

  // 6. Check what the pipeline is actually using (memory length filter)
  console.log('\n' + '='.repeat(80));
  console.log('PIPELINE MEMORY LENGTH FILTER CHECK');
  console.log('='.repeat(80));

  // Default memory length is 7 weeks
  const memoryWeeks = [3, 5, 7, 9, 12];
  for (const weeks of memoryWeeks) {
    const cutoff = await db.execute(sql`
      SELECT
        CURRENT_DATE - ${weeks * 7} as cutoff_date,
        COUNT(*) as would_use
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE b.service_date >= CURRENT_DATE - ${weeks * 7}
    `);
    const r = cutoff.rows[0] as any;
    console.log(`\n   ${weeks} weeks memory → cutoff: ${String(r.cutoff_date).substring(0, 10)} → ${r.would_use} assignments used`);
  }

  // 7. Check if there's any filtering in the pipeline code
  console.log('\n' + '='.repeat(80));
  console.log('TOTAL AVAILABLE FOR TRAINING (NO DATE FILTER):');
  console.log('='.repeat(80));

  const allData = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
  `);
  console.log('\n   ALL assignments (no date filter):', (allData.rows[0] as any).cnt);

  process.exit(0);
}

main().catch(console.error);
