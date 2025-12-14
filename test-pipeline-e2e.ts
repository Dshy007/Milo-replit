/**
 * End-to-End Pipeline Test with REAL PostgreSQL Data
 *
 * Uses:
 * - REAL blocks from database
 * - REAL drivers from database
 * - REAL historical assignments for XGBoost scoring
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { runSchedulePipeline } from './server/schedule-pipeline';

async function main() {
  console.log('='.repeat(70));
  console.log('END-TO-END PIPELINE TEST WITH REAL DATA');
  console.log('='.repeat(70));

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Get REAL unassigned blocks from PostgreSQL
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[Step 1] Fetching REAL unassigned blocks from PostgreSQL...');

  const blocksResult = await db.execute(sql`
    SELECT
      b.id,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM blocks b
    LEFT JOIN block_assignments ba ON b.id = ba.block_id
    WHERE ba.id IS NULL
      AND b.service_date >= CURRENT_DATE
    ORDER BY b.service_date, b.start_timestamp
  `);

  const blocks = (blocksResult.rows as any[]).map(b => {
    // Extract time from timestamp
    let canonicalTime = '16:30';
    if (b.start_timestamp) {
      const tsStr = String(b.start_timestamp);
      const match = tsStr.match(/(\d{2}:\d{2})/);
      if (match) canonicalTime = match[1];
    }

    // Convert day of week number to name
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayOfWeek = dayNames[parseInt(b.day_of_week)] || 'monday';

    // Format service date
    const serviceDate = b.service_date ? new Date(b.service_date).toISOString().split('T')[0] : '';

    return {
      id: b.id,
      soloType: b.solo_type || 'solo1',
      tractorId: b.tractor_id || 'Tractor_1',
      canonicalTime,
      dayOfWeek,
      serviceDate,
    };
  });

  console.log(`  Found ${blocks.length} unassigned blocks`);
  if (blocks.length > 0) {
    console.log(`  Date range: ${blocks[0].serviceDate} to ${blocks[blocks.length - 1].serviceDate}`);
    console.log(`  Sample blocks:`);
    for (const b of blocks.slice(0, 5)) {
      console.log(`    ${b.serviceDate} ${b.dayOfWeek} ${b.canonicalTime} - ${b.soloType} ${b.tractorId}`);
    }
  }

  // If no unassigned blocks, get recent assigned blocks for testing
  if (blocks.length === 0) {
    console.log('\n  No unassigned blocks found. Using recent blocks for testing...');

    const recentBlocks = await db.execute(sql`
      SELECT
        b.id,
        b.solo_type,
        b.tractor_id,
        b.start_timestamp,
        b.service_date,
        EXTRACT(DOW FROM b.service_date) as day_of_week
      FROM blocks b
      ORDER BY b.service_date DESC
      LIMIT 20
    `);

    for (const b of recentBlocks.rows as any[]) {
      let canonicalTime = '16:30';
      if (b.start_timestamp) {
        const tsStr = String(b.start_timestamp);
        const match = tsStr.match(/(\d{2}:\d{2})/);
        if (match) canonicalTime = match[1];
      }
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const dayOfWeek = dayNames[parseInt(b.day_of_week)] || 'monday';
      const serviceDate = b.service_date ? new Date(b.service_date).toISOString().split('T')[0] : '';

      blocks.push({
        id: b.id,
        soloType: b.solo_type || 'solo1',
        tractorId: b.tractor_id || 'Tractor_1',
        canonicalTime,
        dayOfWeek,
        serviceDate,
      });
    }
    console.log(`  Using ${blocks.length} recent blocks for testing`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Get REAL drivers from PostgreSQL
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[Step 2] Fetching REAL drivers from PostgreSQL...');

  const driversResult = await db.execute(sql`
    SELECT
      d.id,
      d.first_name,
      d.last_name,
      d.first_name || ' ' || d.last_name as full_name
    FROM drivers d
    WHERE d.status = 'active' OR d.status IS NULL
    ORDER BY d.last_name
  `);

  const driverIds = (driversResult.rows as any[]).map(d => d.id);
  const driverNames: Record<string, string> = {};
  for (const d of driversResult.rows as any[]) {
    driverNames[d.id] = d.full_name;
  }

  console.log(`  Found ${driverIds.length} active drivers`);
  console.log(`  Sample drivers:`);
  for (const d of (driversResult.rows as any[]).slice(0, 5)) {
    console.log(`    ${d.full_name}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Get REAL historical assignments for each driver
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[Step 3] Fetching REAL historical assignments...');

  const historyResult = await db.execute(sql`
    SELECT
      ba.driver_id,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE b.service_date >= CURRENT_DATE - INTERVAL '12 weeks'
    ORDER BY b.service_date DESC
  `);

  const driverHistories: Record<string, any[]> = {};
  for (const h of historyResult.rows as any[]) {
    const driverId = h.driver_id;
    if (!driverHistories[driverId]) {
      driverHistories[driverId] = [];
    }

    let startTime = '16:30';
    if (h.start_timestamp) {
      const tsStr = String(h.start_timestamp);
      const match = tsStr.match(/(\d{2}:\d{2})/);
      if (match) startTime = match[1];
    }

    driverHistories[driverId].push({
      soloType: h.solo_type,
      tractorId: h.tractor_id,
      startTime,
      dayOfWeek: parseInt(h.day_of_week),
      serviceDate: h.service_date ? new Date(h.service_date).toISOString().split('T')[0] : '',
    });
  }

  const driversWithHistory = Object.keys(driverHistories).length;
  const totalAssignments = historyResult.rows.length;
  console.log(`  ${totalAssignments} assignments across ${driversWithHistory} drivers (12-week lookback)`);

  // Show drivers with most history
  const historyCounts = Object.entries(driverHistories)
    .map(([id, h]) => ({ id, name: driverNames[id] || id, count: h.length }))
    .sort((a, b) => b.count - a.count);

  console.log(`  Top drivers by history:`);
  for (const d of historyCounts.slice(0, 5)) {
    console.log(`    ${d.name}: ${d.count} assignments`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Run the FULL pipeline
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[Step 4] Running FULL schedule pipeline...');
  console.log('─'.repeat(70));

  const pipelineInput = {
    tenantId: 'test',
    blocks,
    availableDriverIds: driverIds,
    driverHistories,
    assignedSlots: new Map<string, string>(),
    settings: {
      predictability: 0.7,    // 70% follow patterns
      timeFlexibility: 2,     // ±2 hours bump tolerance
      memoryLength: 8,        // 8-week lookback
    },
  };

  const result = await runSchedulePipeline(pipelineInput);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Show results
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('PIPELINE RESULTS');
  console.log('='.repeat(70));

  console.log(`\nBlocks: ${result.stats.totalBlocks}`);
  console.log(`Assigned: ${result.stats.assigned}`);
  console.log(`Unassigned: ${result.stats.unassigned}`);

  if (result.assignments.length > 0) {
    console.log('\nFinal Assignments:');
    for (const a of result.assignments.slice(0, 15)) {
      const driverName = driverNames[a.driverId] || a.driverId.slice(0, 8);
      console.log(`  ${a.serviceDate} ${a.dayOfWeek} ${a.time} → ${driverName}`);
      console.log(`    Score: ${a.pipelineScore?.toFixed(3) || 'N/A'}, Method: ${a.scoringMethod || 'N/A'}`);
    }
    if (result.assignments.length > 15) {
      console.log(`  ... and ${result.assignments.length - 15} more`);
    }
  }

  // Show driver assignment distribution
  const driverAssignments: Record<string, number> = {};
  for (const a of result.assignments) {
    const name = driverNames[a.driverId] || a.driverId;
    driverAssignments[name] = (driverAssignments[name] || 0) + 1;
  }

  if (Object.keys(driverAssignments).length > 0) {
    console.log('\nDriver Distribution:');
    const sorted = Object.entries(driverAssignments).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 10)) {
      console.log(`  ${name}: ${count} blocks`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
