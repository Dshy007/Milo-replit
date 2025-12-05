import { db } from "../db";
import { sql } from "drizzle-orm";

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function checkFiras() {
  // Find Firas
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE tenant_id = ${TENANT_ID}
    AND (first_name ILIKE '%firas%' OR last_name ILIKE '%firas%')
  `);

  if (driverResult.rows.length === 0) {
    console.log('Firas not found');
    process.exit(1);
  }

  const firas = driverResult.rows[0] as any;
  console.log('=== FIRAS DRIVER INFO ===');
  console.log('ID:', firas.id);
  console.log('Name:', firas.first_name, firas.last_name);
  console.log('');

  // Get his block assignments with timestamps
  const assignmentsResult = await db.execute(sql`
    SELECT
      ba.id,
      b.block_id,
      b.service_date,
      b.start_timestamp,
      b.tractor_id,
      b.solo_type as block_solo_type,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${firas.id}
    AND ba.is_active = true
    ORDER BY b.service_date DESC
    LIMIT 50
  `);

  console.log('=== FIRAS ASSIGNMENTS (last 50) ===');
  console.log('');

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const timeFreq: Record<string, number> = {};
  const dayFreq: Record<string, number> = {};

  for (const row of assignmentsResult.rows) {
    const a = row as any;
    const ts = a.start_timestamp ? new Date(a.start_timestamp) : null;
    // Extract UTC time (what's stored in DB)
    const timeStr = ts ? ts.toISOString().split('T')[1].slice(0, 5) : 'N/A';
    const dayName = dayNames[parseInt(a.day_of_week)];

    console.log(`${a.service_date} (${dayName}) - ${a.block_id} @ ${timeStr} - Tractor: ${a.tractor_id || 'N/A'} - Type: ${a.block_solo_type}`);

    timeFreq[timeStr] = (timeFreq[timeStr] || 0) + 1;
    dayFreq[dayName] = (dayFreq[dayName] || 0) + 1;
  }

  console.log('');
  console.log('=== TIME FREQUENCY ===');
  Object.entries(timeFreq).sort((a,b) => b[1] - a[1]).forEach(([time, count]) => {
    console.log(`  ${time}: ${count}x`);
  });

  console.log('');
  console.log('=== DAY FREQUENCY ===');
  Object.entries(dayFreq).sort((a,b) => b[1] - a[1]).forEach(([day, count]) => {
    console.log(`  ${day}: ${count}x`);
  });

  // Check his DNA profile
  const dnaResult = await db.execute(sql`
    SELECT * FROM driver_dna_profiles WHERE driver_id = ${firas.id}
  `);

  if (dnaResult.rows.length > 0) {
    const dna = dnaResult.rows[0] as any;
    console.log('');
    console.log('=== STORED DNA PROFILE ===');
    console.log('Preferred Days:', dna.preferred_days);
    console.log('Preferred Times:', dna.preferred_start_times);
    console.log('Preferred Contract:', dna.preferred_contract_type);
    console.log('Pattern Group:', dna.pattern_group);
  } else {
    console.log('');
    console.log('NO DNA PROFILE STORED');
  }

  process.exit(0);
}

checkFiras().catch(e => { console.error(e); process.exit(1); });
