import { db } from '../db';
import { sql } from 'drizzle-orm';

async function checkRaymond() {
  // Find Raymond Beeks
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE LOWER(first_name) LIKE '%raymond%' OR LOWER(last_name) LIKE '%beek%'
    LIMIT 1
  `);

  if (driverResult.rows.length === 0) {
    console.log('No driver found!');
    process.exit(1);
  }

  const driver = driverResult.rows[0] as { id: string; first_name: string; last_name: string };
  console.log('Driver:', driver.first_name, driver.last_name);
  console.log('Driver ID:', driver.id);

  // Get DNA profile
  const dnaResult = await db.execute(sql`
    SELECT * FROM driver_dna_profiles WHERE driver_id = ${driver.id}
  `);

  console.log('\n=== CURRENT DNA PROFILE ===');
  if (dnaResult.rows.length > 0) {
    const profile = dnaResult.rows[0] as any;
    console.log('Preferred Days:', profile.preferred_days);
    console.log('Preferred Times:', profile.preferred_start_times);
    console.log('Preferred Contract:', profile.preferred_contract_type);
    console.log('Assignments Analyzed:', profile.assignments_analyzed);
    console.log('Weeks Analyzed:', profile.weeks_analyzed);
  } else {
    console.log('No DNA profile found!');
  }

  // Check shift_occurrences for Raymond's historical assignments
  const assignmentsResult = await db.execute(sql`
    SELECT service_date, start_time
    FROM shift_occurrences
    WHERE driver_id = ${driver.id}
    ORDER BY service_date DESC
    LIMIT 100
  `);

  console.log('\n=== SHIFT_OCCURRENCES (' + assignmentsResult.rows.length + ' rows) ===');

  const assignments = assignmentsResult.rows as any[];
  for (const a of assignments.slice(0, 50)) {
    const date = a.service_date ? new Date(a.service_date + 'T00:00:00') : null;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = date ? dayNames[date.getDay()] : '???';
    console.log(`  ${a.service_date} (${dayName}) @ ${a.start_time}`);
  }

  // Analyze assignment pattern
  const aByDay: Record<string, number> = {};
  const aByTime: Record<string, number> = {};

  for (const a of assignments) {
    if (a.service_date) {
      const date = new Date(a.service_date + 'T00:00:00');
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const day = days[date.getDay()];
      aByDay[day] = (aByDay[day] || 0) + 1;
    }

    const time = a.start_time || 'unknown';
    aByTime[time] = (aByTime[time] || 0) + 1;
  }

  console.log('\n=== PATTERN FROM IMPORTED ROSTERS ===');
  console.log('By Day:', aByDay);
  console.log('By Time:', aByTime);

  // What DNA profile SHOULD be
  const total = assignments.length;
  if (total > 0) {
    console.log('\n=== RECOMMENDED DNA PROFILE ===');
    console.log('Total assignments:', total);

    const sortedDays = Object.entries(aByDay).sort((a, b) => b[1] - a[1]);
    console.log('Top Days:', sortedDays.map(([d, c]) => `${d}(${c})`).join(', '));

    const sortedTimes = Object.entries(aByTime).sort((a, b) => b[1] - a[1]);
    console.log('Top Times:', sortedTimes.map(([t, c]) => `${t}(${c})`).join(', '));

    // Show what the dominant time is
    const topTime = sortedTimes[0];
    if (topTime) {
      const topTimePercent = Math.round((topTime[1] / total) * 100);
      console.log(`\nDominant Time: ${topTime[0]} (${topTimePercent}% of assignments)`);
    }
  }

  process.exit(0);
}

checkRaymond().catch(console.error);
