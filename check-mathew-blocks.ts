import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  // Get Mathew's DNA profile
  const mathewDNA = await db.execute(sql`
    SELECT
      d.id,
      d.first_name,
      d.last_name,
      dna.preferred_days,
      dna.preferred_start_times
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE d.first_name LIKE '%Mathew%'
    AND d.last_name = 'Ivy'
  `);

  const mathew = mathewDNA.rows[0] as any;
  if (!mathew) {
    console.log('Mathew not found! Checking all drivers...');
    const allDrivers = await db.execute(sql`SELECT first_name, last_name FROM drivers WHERE first_name LIKE '%Math%' OR last_name LIKE '%Ivy%'`);
    console.log(allDrivers.rows);
    process.exit(1);
  }
  console.log('=== Mathew William Ivy DNA Profile ===');
  console.log(`Days: ${mathew.preferred_days?.join(', ')}`);
  console.log(`Times: ${mathew.preferred_start_times?.join(', ')}`);

  // Get ALL unassigned Solo2 blocks
  const blocks = await db.execute(sql`
    SELECT
      so.id,
      so.service_date,
      st.canonical_start_time,
      so.external_block_id,
      ba.driver_id
    FROM shift_occurrences so
    JOIN shift_templates st ON so.template_id = st.id
    LEFT JOIN block_assignments ba ON ba.shift_occurrence_id = so.id AND ba.is_active = true
    WHERE st.solo_type = 'solo2'
    AND ba.driver_id IS NULL
    AND so.status != 'rejected'
    ORDER BY so.service_date, st.canonical_start_time
  `);

  console.log(`\n=== All Unassigned Solo2 Blocks (${blocks.rows.length} total) ===`);

  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let matchCount = 0;

  for (const block of blocks.rows as any[]) {
    const date = new Date(block.service_date + 'T00:00:00');
    const dayOfWeek = DAYS[date.getDay()];
    const time = block.canonical_start_time;

    const dayMatches = mathew.preferred_days?.includes(dayOfWeek);
    const timeMatches = mathew.preferred_start_times?.includes(time);
    const isMatch = dayMatches && timeMatches;

    if (isMatch) matchCount++;

    const matchStatus = isMatch ? '✅ MATCH' :
                       dayMatches ? '🟡 Day only' :
                       timeMatches ? '🟠 Time only' : '❌';

    console.log(`  ${block.service_date} (${dayOfWeek}) @ ${time} - ${block.external_block_id || 'N/A'} - ${matchStatus}`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total unassigned: ${blocks.rows.length}`);
  console.log(`Matches for Mathew: ${matchCount}`);
}

check().then(() => process.exit(0)).catch(console.error);
