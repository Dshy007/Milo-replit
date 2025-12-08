import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

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
  // The UI shows Sat Dec 6 - which week is this?
  // Dec 6, 2025 is a Saturday. The week would be Sun Dec 7 start? No wait...
  // If Dec 6 is Saturday, the week starting Sunday would be Nov 30 - Dec 6

  console.log('=== TESTING WEEK CONTAINING SAT DEC 6 ===\n');

  // Get all active drivers with contract type from DNA profiles
  const allDrivers = await db.execute(sql`
    SELECT d.id, d.first_name || ' ' || d.last_name as name,
           COALESCE(dna.preferred_contract_type, 'solo1') as contract_type
    FROM drivers d
    LEFT JOIN driver_dna_profiles dna ON dna.driver_id = d.id
    WHERE d.status = 'active'
  `);

  const drivers = (allDrivers.rows as any[]).map(d => ({
    id: d.id,
    name: d.name,
    preferredDays: [],
    preferredTime: '',
    contractType: (d.contract_type || 'solo1').toLowerCase()
  }));

  // Get ALL unassigned blocks from Dec 7 to Dec 14 (next week)
  // Using timestamp-aware query
  const unassignedBlocks = await db.execute(sql`
    SELECT b.id, b.service_date, b.solo_type, b.tractor_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.service_date >= '2025-12-07'::timestamp
    AND b.service_date < '2025-12-14'::timestamp
    AND ba.id IS NULL
    ORDER BY b.service_date
  `);

  console.log(`Found ${unassignedBlocks.rows.length} unassigned blocks\n`);

  // Group by day
  const blocksByDay: Record<string, number> = {};
  for (const row of unassignedBlocks.rows as any[]) {
    const dayName = DAY_NAMES[parseInt(row.day_of_week)];
    blocksByDay[dayName] = (blocksByDay[dayName] || 0) + 1;
  }
  console.log('Blocks by day:', blocksByDay);

  const blocks = (unassignedBlocks.rows as any[]).map(b => {
    const dayIndex = parseInt(b.day_of_week);
    const dayName = DAY_NAMES[dayIndex];
    const soloType = (b.solo_type || 'solo1').toLowerCase();
    const tractorId = b.tractor_id || 'Tractor_1';
    const lookupKey = `${soloType}_${tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '00:00';

    // Format service_date properly
    const serviceDate = new Date(b.service_date);
    const dateStr = serviceDate.toISOString().split('T')[0];

    return {
      id: b.id,
      day: dayName,
      time,
      contractType: soloType,
      serviceDate: dateStr
    };
  });

  // Show Saturday blocks specifically
  console.log('\nSaturday blocks:');
  const saturdayBlocks = blocks.filter(b => b.day === 'saturday');
  for (const b of saturdayBlocks) {
    console.log(`  ${b.id.slice(0,8)} - ${b.time} (${b.contractType})`);
  }

  // Build 8-week slot history (before Dec 7)
  const historyAssignments = await db.execute(sql`
    SELECT b.service_date, b.solo_type, b.tractor_id, ba.driver_id,
           EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND b.service_date >= CURRENT_DATE - INTERVAL '56 days'
    AND b.service_date < '2025-12-07'::timestamp
  `);

  const slotHistory: Record<string, Record<string, number>> = {};
  for (const row of historyAssignments.rows as any[]) {
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

  console.log(`\nSlot history: ${Object.keys(slotHistory).length} slots`);

  // Check Firas's history for Saturday
  const firasId = '27db00b3-ed61-4c54-9bb1-dc31c5122fd5';
  console.log('\nFiras saturday_16:30 history:', slotHistory['saturday_16:30']?.[firasId] || 0, 'times');

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
    console.log('\n=== PYTHON OUTPUT ===');
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

    process.exit(0);
  });
}

main();
