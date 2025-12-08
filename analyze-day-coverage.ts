import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function analyze() {
  // Get all Solo2 drivers with their preferred days and times
  const drivers = await db.execute(sql`
    SELECT
      d.id,
      d.first_name,
      d.last_name,
      dna.preferred_days,
      dna.preferred_start_times
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE dna.preferred_contract_type = 'solo2'
    AND d.status = 'active'
    ORDER BY d.last_name
  `);

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const TIMES = ['08:30', '11:30', '15:30', '16:30', '18:30', '21:30', '23:30'];

  console.log('=== DRIVER COVERAGE MATRIX (Day x Time) ===\n');
  console.log('Shows which drivers can cover each (day, time) combination\n');

  // For each time slot
  for (const time of TIMES) {
    console.log(`\n--- ${time} ---`);
    for (const day of DAYS) {
      const eligibleDrivers = (drivers.rows as any[]).filter(d => {
        const days = d.preferred_days || [];
        const times = d.preferred_start_times || [];
        return days.includes(day) && times.includes(time);
      });

      if (eligibleDrivers.length === 0) {
        console.log(`  ${day.padEnd(10)}: ❌ NO COVERAGE`);
      } else {
        const names = eligibleDrivers.map(d => `${d.first_name} ${d.last_name}`).join(', ');
        console.log(`  ${day.padEnd(10)}: ✅ ${eligibleDrivers.length} driver(s) - ${names}`);
      }
    }
  }

  // Summary: count uncovered slots
  console.log('\n\n=== UNCOVERED SLOTS (No driver available) ===\n');
  let uncoveredCount = 0;
  for (const time of TIMES) {
    for (const day of DAYS) {
      const eligibleDrivers = (drivers.rows as any[]).filter(d => {
        const days = d.preferred_days || [];
        const times = d.preferred_start_times || [];
        return days.includes(day) && times.includes(time);
      });

      if (eligibleDrivers.length === 0) {
        console.log(`  ${day} @ ${time}`);
        uncoveredCount++;
      }
    }
  }
  console.log(`\nTotal uncovered: ${uncoveredCount} / ${DAYS.length * TIMES.length} slots`);
}

analyze().then(() => process.exit(0)).catch(console.error);
