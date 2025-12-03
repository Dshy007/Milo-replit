import { db } from '../db';
import { sql } from 'drizzle-orm';

async function checkAdanRaw() {
  // Find Adan using raw SQL
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE LOWER(first_name) LIKE '%adan%' OR LOWER(last_name) LIKE '%sandh%'
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
  }

  // Skip shift_occurrences for now - column structure might be different

  // Check blocks table directly - it has service_date
  const assignmentsResult = await db.execute(sql`
    SELECT
      b.id,
      b.service_date,
      b.start_timestamp,
      b.block_id,
      b.solo_type as contract_type,
      b.tractor_id
    FROM blocks b
    WHERE b.status = 'assigned'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      WHERE ba.block_id = b.id
      AND ba.driver_id = ${driver.id}
      AND ba.is_active = true
    )
    ORDER BY b.service_date DESC
    LIMIT 100
  `);

  console.log('\n=== BLOCK_ASSIGNMENTS (' + assignmentsResult.rows.length + ' rows) ===');

  const assignments = assignmentsResult.rows as any[];
  for (const a of assignments.slice(0, 40)) {
    // Handle both string and Date objects
    const dateVal = a.service_date instanceof Date ? a.service_date : new Date(a.service_date);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayName = dayNames[dateVal.getDay()];
    const dateStr = dateVal.toISOString().split('T')[0];
    // Extract time from start_timestamp
    const startTime = a.start_timestamp instanceof Date
      ? a.start_timestamp.toISOString().split('T')[1].slice(0, 5)
      : (a.start_timestamp || '??:??').toString().split('T')[1]?.slice(0, 5) || '??:??';
    console.log(`  ${dateStr} (${dayName}) @ ${startTime} - ${a.contract_type} - ${a.tractor_id}`);
  }

  // Analyze assignment pattern
  const aByContract: Record<string, number> = {};
  const aByDay: Record<string, number> = {};
  const aByTime: Record<string, number> = {};

  for (const a of assignments) {
    const ct = a.contract_type || 'unknown';
    aByContract[ct] = (aByContract[ct] || 0) + 1;

    if (a.service_date) {
      const dateVal = a.service_date instanceof Date ? a.service_date : new Date(a.service_date);
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const day = days[dateVal.getDay()];
      aByDay[day] = (aByDay[day] || 0) + 1;
    }

    // Extract time from start_timestamp
    const startTime = a.start_timestamp instanceof Date
      ? a.start_timestamp.toISOString().split('T')[1].slice(0, 5)
      : (a.start_timestamp || '??:??').toString().split('T')[1]?.slice(0, 5) || 'unknown';
    aByTime[startTime] = (aByTime[startTime] || 0) + 1;
  }

  console.log('\n=== PATTERN FROM BLOCK_ASSIGNMENTS ===');
  console.log('By Contract:', aByContract);
  console.log('By Day:', aByDay);
  console.log('By Time:', aByTime);

  // Calculate what the DNA profile SHOULD show
  const total = assignments.length;
  if (total > 0) {
    console.log('\n=== RECOMMENDED DNA PROFILE ===');
    console.log('Total assignments:', total);

    // Top contract type
    const topContract = Object.entries(aByContract).sort((a, b) => b[1] - a[1])[0];
    console.log('Top Contract:', topContract?.[0], `(${topContract?.[1]}/${total} = ${Math.round((topContract?.[1] || 0) / total * 100)}%)`);

    // Top 3 days
    const sortedDays = Object.entries(aByDay).sort((a, b) => b[1] - a[1]);
    console.log('Top Days:', sortedDays.slice(0, 5).map(([d, c]) => `${d}(${c})`).join(', '));

    // Top times
    const sortedTimes = Object.entries(aByTime).sort((a, b) => b[1] - a[1]);
    console.log('Top Times:', sortedTimes.slice(0, 3).map(([t, c]) => `${t}(${c})`).join(', '));

    // Calculate avg shifts per week
    const weekSet = new Set<string>();
    for (const a of assignments) {
      if (a.service_date) {
        const dateVal = a.service_date instanceof Date ? a.service_date : new Date(a.service_date);
        const startOfYear = new Date(dateVal.getFullYear(), 0, 1);
        const days = Math.floor((dateVal.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        const weekNum = Math.ceil((days + startOfYear.getDay() + 1) / 7);
        weekSet.add(`${dateVal.getFullYear()}-W${weekNum}`);
      }
    }
    console.log('Weeks with data:', weekSet.size);
    console.log('Avg shifts per week:', (total / Math.max(1, weekSet.size)).toFixed(1));
  }

  process.exit(0);
}

checkAdanRaw().catch(console.error);
