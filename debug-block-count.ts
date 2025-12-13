/**
 * Debug: Trace where blocks get filtered from 75 → 23
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { blocks, blockAssignments, drivers, tenants } from '@shared/schema';
import { and, eq, gte, lte, isNull } from 'drizzle-orm';
import { startOfWeek, format } from 'date-fns';

async function main() {
  console.log('='.repeat(70));
  console.log('DEBUG: BLOCK COUNT FLOW');
  console.log('='.repeat(70));

  // Get the tenant (assuming single tenant)
  const allTenants = await db.select().from(tenants);
  console.log('\n1. TENANTS IN DATABASE:');
  for (const t of allTenants) {
    console.log(`   ${t.id}: ${t.name}`);
  }
  // Find Freedom Transportation tenant (the one with 75 blocks)
  const freedomTenant = allTenants.find(t => t.name?.includes('Freedom'));
  const tenantId = freedomTenant?.id || allTenants[0]?.id;
  console.log(`   Using tenantId: ${tenantId} (${freedomTenant?.name || allTenants[0]?.name})`);

  // Week parameters - Let's check MULTIPLE weeks
  const weeks = [
    { start: '2025-12-07', end: '2025-12-13', label: 'Dec 7-13' },
    { start: '2025-12-14', end: '2025-12-20', label: 'Dec 14-20' },
  ];

  for (const week of weeks) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`WEEK: ${week.label}`);
    console.log('='.repeat(70));

    const weekStart = new Date(week.start);
    const weekEnd = new Date(week.end);
    await analyzeWeek(tenantId, weekStart, weekEnd, week.label);
  }

  process.exit(0);
}

async function analyzeWeek(tenantId: string, weekStart: Date, weekEnd: Date, label: string) {

  console.log(`\n2. DATE RANGE: ${format(weekStart, 'yyyy-MM-dd')} to ${format(weekEnd, 'yyyy-MM-dd')}`);

  // Step 1: Raw block count for date range (no filters)
  const rawCount = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM blocks
    WHERE service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
  `);
  console.log(`\n3. RAW BLOCKS IN DATE RANGE (no filters): ${(rawCount.rows[0] as any).cnt}`);

  // Step 2: With tenantId filter
  const tenantCount = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM blocks
    WHERE service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
    AND tenant_id = ${tenantId}
  `);
  console.log(`\n4. BLOCKS WITH TENANT FILTER: ${(tenantCount.rows[0] as any).cnt}`);

  // Check tenant distribution
  const byTenant = await db.execute(sql`
    SELECT tenant_id, COUNT(*) as cnt FROM blocks
    WHERE service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
    GROUP BY tenant_id
  `);
  console.log('\n5. BLOCKS BY TENANT:');
  for (const row of byTenant.rows as any[]) {
    console.log(`   ${row.tenant_id}: ${row.cnt} blocks`);
  }

  // Step 3: Get active assignments
  const activeAssignments = await db.execute(sql`
    SELECT ba.block_id
    FROM block_assignments ba
    WHERE ba.is_active = true
  `);
  const assignedBlockIds = new Set((activeAssignments.rows as any[]).map(r => r.block_id));
  console.log(`\n6. ACTIVE ASSIGNMENTS (all tenants): ${activeAssignments.rows.length}`);

  // Step 4: Count unassigned blocks
  const unassignedCount = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM blocks b
    WHERE b.service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND b.service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
    AND b.tenant_id = ${tenantId}
    AND NOT EXISTS (
      SELECT 1 FROM block_assignments ba
      WHERE ba.block_id = b.id AND ba.is_active = true
    )
  `);
  console.log(`\n7. UNASSIGNED BLOCKS (tenant + date + no active assignment): ${(unassignedCount.rows[0] as any).cnt}`);

  // Step 5: Check by contract type
  const bySoloType = await db.execute(sql`
    SELECT solo_type, COUNT(*) as total,
           SUM(CASE WHEN NOT EXISTS (
             SELECT 1 FROM block_assignments ba
             WHERE ba.block_id = b.id AND ba.is_active = true
           ) THEN 1 ELSE 0 END) as unassigned
    FROM blocks b
    WHERE b.service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND b.service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
    AND b.tenant_id = ${tenantId}
    GROUP BY solo_type
  `);
  console.log('\n8. BLOCKS BY CONTRACT TYPE:');
  for (const row of bySoloType.rows as any[]) {
    console.log(`   ${row.solo_type}: ${row.total} total, ${row.unassigned} unassigned`);
  }

  // Step 6: Simulate getUnassignedBlocks with different filters
  console.log('\n9. SIMULATING getUnassignedBlocks():');

  for (const contractFilter of ['all', 'solo1', 'solo2', 'team']) {
    const filtered = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM blocks b
      WHERE b.service_date >= ${format(weekStart, 'yyyy-MM-dd')}
      AND b.service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
      AND b.tenant_id = ${tenantId}
      AND NOT EXISTS (
        SELECT 1 FROM block_assignments ba
        WHERE ba.block_id = b.id AND ba.is_active = true
      )
      ${contractFilter !== 'all' ? sql`AND LOWER(b.solo_type) = ${contractFilter}` : sql``}
    `);
    console.log(`   contractType='${contractFilter}': ${(filtered.rows[0] as any).cnt} blocks`);
  }

  // Step 7: Check for any blocks in Dec 7-13 that are assigned
  const assignedInRange = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id, d.first_name || ' ' || d.last_name as driver_name
    FROM blocks b
    JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    JOIN drivers d ON ba.driver_id = d.id
    WHERE b.service_date >= ${format(weekStart, 'yyyy-MM-dd')}
    AND b.service_date <= ${format(weekEnd, 'yyyy-MM-dd')}
    AND b.tenant_id = ${tenantId}
    ORDER BY b.service_date
  `);
  console.log(`\n10. ASSIGNED BLOCKS IN ${format(weekStart, 'yyyy-MM-dd')} to ${format(weekEnd, 'yyyy-MM-dd')}: ${assignedInRange.rows.length}`);
  if (assignedInRange.rows.length > 0) {
    for (const row of assignedInRange.rows.slice(0, 10) as any[]) {
      console.log(`    ${row.service_date} ${row.solo_type} ${row.tractor_id} → ${row.driver_name}`);
    }
    if (assignedInRange.rows.length > 10) {
      console.log(`    ... and ${assignedInRange.rows.length - 10} more`);
    }
  }

}

main().catch(console.error);
