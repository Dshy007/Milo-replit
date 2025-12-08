import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';
import path from 'path';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const CANONICAL_START_TIMES: Record<string, string> = {
  'solo1_Tractor_1': '16:30',
  'solo1_Tractor_2': '20:30',
  'solo1_Tractor_3': '20:30',
  'solo1_Tractor_4': '17:30',
  'solo1_Tractor_5': '21:30',
  'solo1_Tractor_6': '01:30',
  'solo1_Tractor_7': '18:30',
  'solo1_Tractor_8': '00:30',
  'solo1_Tractor_9': '16:30',
  'solo1_Tractor_10': '20:30',
  'solo2_Tractor_1': '18:30',
  'solo2_Tractor_2': '23:30',
  'solo2_Tractor_3': '21:30',
  'solo2_Tractor_4': '08:30',
  'solo2_Tractor_5': '15:30',
  'solo2_Tractor_6': '11:30',
  'solo2_Tractor_7': '16:30',
};

async function main() {
  // Get all active drivers
  const allDrivers = await db.execute(sql`
    SELECT id, first_name || ' ' || last_name as name
    FROM drivers
    WHERE status = 'active'
  `);

  const drivers = (allDrivers.rows as any[]).map(d => ({
    id: d.id,
    name: d.name,
    preferredDays: [],
    preferredTime: '',
    contractType: 'solo1'
  }));

  // Get unassigned blocks for this week (Nov 30 - Dec 6)
  // Use < Dec 7 instead of <= Dec 6 to handle timestamps stored at 12:00:00
  const unassignedBlocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.service_date >= '2025-11-30'::timestamp
    AND b.service_date < '2025-12-07'::timestamp
    AND ba.id IS NULL
  `);

  const blocks = (unassignedBlocks.rows as any[]).map(b => {
    // Use PostgreSQL's DOW to avoid JS timezone issues
    const dayIndex = parseInt(b.day_of_week);
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (b.solo_type || 'solo1').toLowerCase();
    const tractorId = b.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '00:00';
    const serviceDate = new Date(b.service_date);

    return {
      id: b.id,
      day: dayName,
      time,
      contractType: soloType,
      serviceDate: serviceDate.toISOString().split('T')[0]
    };
  });

  // Build 8-week slot history (before Nov 30)
  const historyAssignments = await db.execute(sql`
    SELECT b.service_date, b.solo_type, b.tractor_id, ba.driver_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND b.service_date >= CURRENT_DATE - INTERVAL '56 days'
    AND b.service_date < '2025-11-30'::timestamp
  `);

  const slotHistory: Record<string, Record<string, number>> = {};
  for (const row of historyAssignments.rows as any[]) {
    // Use PostgreSQL's DOW to avoid JS timezone issues
    const dayIndex = parseInt(row.day_of_week);
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const tractorId = row.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '00:00';
    const slot = `${dayName}_${time}`;

    if (!slotHistory[slot]) slotHistory[slot] = {};
    slotHistory[slot][row.driver_id] = (slotHistory[slot][row.driver_id] || 0) + 1;
  }

  console.log(`Drivers: ${drivers.length}`);
  console.log(`Unassigned blocks: ${blocks.length}`);
  console.log(`Slots with history: ${Object.keys(slotHistory).length}`);

  // Call Python optimizer
  const input = JSON.stringify({
    action: 'optimize',
    drivers,
    blocks,
    slotHistory
  });

  const python = spawn('python', ['python/schedule_optimizer.py', input]);

  let stdout = '';
  let stderr = '';

  python.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  python.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  python.on('close', (code) => {
    console.log('\n=== PYTHON STDERR (debug output) ===');
    console.log(stderr);

    if (code !== 0) {
      console.error('Python exited with code', code);
      process.exit(1);
    }

    const result = JSON.parse(stdout);

    console.log('\n=== RESULTS ===');
    console.log(`Assigned: ${result.stats.assigned}`);
    console.log(`Unassigned: ${result.stats.unassigned}`);

    // Check Firas's assignments
    console.log('\n=== FIRAS ASSIGNMENTS ===');
    const firasAssignments = result.assignments.filter(
      (a: any) => a.driverName.toLowerCase().includes('firas')
    );
    console.log(`Firas got ${firasAssignments.length} blocks:`);
    for (const a of firasAssignments) {
      console.log(`  ${a.day} - ${a.preferredTime} (${a.historyCount}x history)`);
    }

    // Group all assignments by driver to see weekly patterns
    console.log('\n=== DRIVER WEEKLY PATTERNS ===');
    const byDriver: Record<string, string[]> = {};
    for (const a of result.assignments) {
      if (!byDriver[a.driverName]) byDriver[a.driverName] = [];
      byDriver[a.driverName].push(a.day);
    }

    // Sort by number of days (descending)
    const sorted = Object.entries(byDriver).sort((a, b) => b[1].length - a[1].length);
    for (const [driver, days] of sorted.slice(0, 15)) {
      console.log(`  ${driver}: ${days.length} days - ${days.join(', ')}`);
    }

    process.exit(0);
  });
}

main();
