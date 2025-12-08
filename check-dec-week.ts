import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  // Check blocks for Dec 6-12 (the week from the screenshot)
  const blocks = await db.execute(sql`
    SELECT
      b.id,
      b.block_id,
      b.service_date,
      b.solo_type,
      b.tractor_id,
      b.status,
      ba.driver_id,
      d.first_name,
      d.last_name
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE b.service_date >= '2025-12-06'
    AND b.service_date <= '2025-12-13'
    ORDER BY b.service_date, b.solo_type, b.tractor_id
  `);

  console.log(`=== Blocks for Dec 6-12 (${blocks.rows.length} total) ===\n`);

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Group by assigned/unassigned and type
  const unassignedSolo2 = (blocks.rows as any[]).filter(b => b.solo_type === 'solo2' && !b.driver_id);
  const assignedSolo2 = (blocks.rows as any[]).filter(b => b.solo_type === 'solo2' && b.driver_id);
  const unassignedSolo1 = (blocks.rows as any[]).filter(b => b.solo_type === 'solo1' && !b.driver_id);
  const assignedSolo1 = (blocks.rows as any[]).filter(b => b.solo_type === 'solo1' && b.driver_id);

  console.log(`Solo2: ${assignedSolo2.length} assigned, ${unassignedSolo2.length} unassigned`);
  console.log(`Solo1: ${assignedSolo1.length} assigned, ${unassignedSolo1.length} unassigned`);
  console.log(`Total unassigned: ${unassignedSolo2.length + unassignedSolo1.length}`);

  console.log('\n=== UNASSIGNED Solo2 Blocks ===');
  for (const b of unassignedSolo2) {
    const date = new Date(b.service_date);
    const dayName = DAYS[date.getUTCDay()];
    console.log(`  ${dayName} ${b.service_date} - ${b.block_id} - Tractor: ${b.tractor_id || 'N/A'} - Status: ${b.status}`);
  }

  console.log('\n=== ASSIGNED Solo2 Blocks ===');
  for (const b of assignedSolo2) {
    const date = new Date(b.service_date);
    const dayName = DAYS[date.getUTCDay()];
    console.log(`  ${dayName} ${b.service_date} - ${b.block_id} - ${b.first_name} ${b.last_name}`);
  }

  // Count unassigned by day
  console.log('\n=== Unassigned Blocks by Day (Solo2) ===');
  const byDay: Record<string, any[]> = {};
  for (const b of unassignedSolo2) {
    const date = new Date(b.service_date);
    const dayName = DAYS[date.getUTCDay()];
    if (!byDay[dayName]) byDay[dayName] = [];
    byDay[dayName].push(b);
  }
  for (const day of DAYS) {
    const count = byDay[day]?.length || 0;
    console.log(`  ${day}: ${count}`);
  }
}

check().then(() => process.exit(0)).catch(console.error);
