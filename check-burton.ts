import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import { format, subWeeks } from 'date-fns';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBREV: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed',
  thursday: 'Thu', friday: 'Fri', saturday: 'Sat'
};

const CANONICAL_START_TIMES: Record<string, string> = {
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
};

async function main() {
  const eightWeeksAgo = subWeeks(new Date(), 8);
  const cutoffDate = format(eightWeeksAgo, 'yyyy-MM-dd');

  const assignments = await db.execute(sql`
    SELECT
      b.service_date,
      b.solo_type,
      b.tractor_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
    AND b.service_date >= ${cutoffDate}::date
    AND d.first_name ILIKE '%Michael%'
    AND d.last_name ILIKE '%Burton%'
    ORDER BY b.service_date
  `);

  console.log('=== MICHAEL SHANE BURTON - ALL ASSIGNMENTS ===\n');

  for (const row of assignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const tractorId = row.tractor_id || 'Unknown';
    const soloType = (row.solo_type || 'solo1').toLowerCase();
    const lookupKey = `${soloType}_${tractorId}`;
    const canonicalTime = CANONICAL_START_TIMES[lookupKey] || '??:??';

    console.log(`  ${format(serviceDate, 'yyyy-MM-dd')} (${DAY_ABBREV[dayName]}) | ${row.solo_type.padEnd(6)} | ${tractorId.padEnd(12)} | ${canonicalTime}`);
  }

  // Group by day and time
  console.log('\n\n=== BY DAY OF WEEK ===\n');
  const byDay: Record<string, Array<{tractor: string, time: string}>> = {};
  for (const dayName of DAY_NAMES) {
    byDay[dayName] = [];
  }

  for (const row of assignments.rows as any[]) {
    const serviceDate = new Date(row.service_date);
    const dayName = DAY_NAMES[serviceDate.getDay()];
    const tractorId = row.tractor_id || 'Unknown';
    const soloType = (row.solo_type || 'solo1').toLowerCase();

    // Only count Solo1 assignments
    if (soloType === 'solo1') {
      const lookupKey = `solo1_${tractorId}`;
      const canonicalTime = CANONICAL_START_TIMES[lookupKey] || '??:??';
      byDay[dayName].push({ tractor: tractorId, time: canonicalTime });
    }
  }

  for (const dayName of DAY_NAMES) {
    const shifts = byDay[dayName];
    console.log(`  ${DAY_ABBREV[dayName]}: ${shifts.length} shifts`);

    // Group by time
    const byTime: Record<string, number> = {};
    for (const s of shifts) {
      byTime[s.time] = (byTime[s.time] || 0) + 1;
    }
    for (const [time, count] of Object.entries(byTime)) {
      console.log(`    ${time}: ${count}x`);
    }
  }

  // Summary
  console.log('\n\n=== MICHAEL BURTON PATTERN SUMMARY ===\n');
  console.log('Total Solo1 shifts:', Object.values(byDay).flat().length);

  // By time slot
  const timeSlots: Record<string, string[]> = {};
  for (const dayName of DAY_NAMES) {
    for (const s of byDay[dayName]) {
      if (!timeSlots[s.time]) timeSlots[s.time] = [];
      if (!timeSlots[s.time].includes(dayName)) {
        timeSlots[s.time].push(dayName);
      }
    }
  }

  console.log('\nBy time slot:');
  for (const [time, days] of Object.entries(timeSlots).sort()) {
    const dayAbbrevs = days.map(d => DAY_ABBREV[d]).join(', ');
    console.log(`  ${time}: ${dayAbbrevs}`);
  }

  process.exit(0);
}
main();
