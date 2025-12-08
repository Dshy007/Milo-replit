const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  console.log('');
  console.log('=== PREFERRED_START_TIMES FORMAT CHECK ===');

  const times = await pool.query(`
    SELECT
      d.first_name || ' ' || d.last_name as name,
      dna.preferred_start_times
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE d.status = 'active'
    AND dna.preferred_start_times IS NOT NULL
    AND array_length(dna.preferred_start_times, 1) > 0
  `);

  console.log('Checking time formats (expected HH:MM):');
  const timeRegex = /^\d{2}:\d{2}$/;
  let badFormats = [];

  for (const t of times.rows) {
    for (const time of t.preferred_start_times) {
      if (!timeRegex.test(time)) {
        badFormats.push({ name: t.name, time: time });
      }
    }
  }

  if (badFormats.length === 0) {
    console.log('  All time formats are valid HH:MM');
  } else {
    console.log('  BAD TIME FORMATS:');
    for (const b of badFormats) {
      console.log('    ', b.name, '->', b.time);
    }
  }

  console.log('');
  console.log('=== PREFERRED_DAYS FORMAT CHECK ===');

  const days = await pool.query(`
    SELECT
      d.first_name || ' ' || d.last_name as name,
      dna.preferred_days
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE d.status = 'active'
    AND dna.preferred_days IS NOT NULL
    AND array_length(dna.preferred_days, 1) > 0
  `);

  console.log('Checking day formats (expected lowercase day names):');
  const validDays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let badDays = [];

  for (const d of days.rows) {
    for (const day of d.preferred_days) {
      if (!validDays.includes(day.toLowerCase())) {
        badDays.push({ name: d.name, day: day });
      }
    }
  }

  if (badDays.length === 0) {
    console.log('  All day formats are valid');
  } else {
    console.log('  BAD DAY FORMATS:');
    for (const b of badDays) {
      console.log('    ', b.name, '->', b.day);
    }
  }

  console.log('');
  console.log('=== CONTRACT TYPE CHECK ===');

  const contracts = await pool.query(`
    SELECT
      preferred_contract_type as ct,
      COUNT(*) as count
    FROM driver_dna_profiles
    GROUP BY preferred_contract_type
    ORDER BY count DESC
  `);

  console.log('Contract type distribution:');
  for (const c of contracts.rows) {
    const isValid = ['solo1', 'solo2', 'team'].includes((c.ct || '').toLowerCase());
    console.log('  ', c.ct || 'NULL', ':', c.count, isValid ? '' : '<-- INVALID');
  }

  console.log('');
  console.log('=== WHAT CLAUDE SEES FOR EACH DRIVER ===');
  console.log('(showing first 5 drivers with full DNA data)');

  const fullDrivers = await pool.query(`
    SELECT
      d.first_name || ' ' || d.last_name as name,
      dna.preferred_days,
      dna.preferred_start_times,
      dna.preferred_contract_type
    FROM drivers d
    JOIN driver_dna_profiles dna ON d.id = dna.driver_id
    WHERE d.status = 'active'
    AND dna.preferred_days IS NOT NULL
    AND array_length(dna.preferred_days, 1) > 0
    LIMIT 5
  `);

  for (const d of fullDrivers.rows) {
    console.log('');
    console.log('**' + d.name + '**');
    console.log('  - Preferred Days:', (d.preferred_days || []).join(', ') || 'none specified');
    console.log('  - Preferred Start Time:', (d.preferred_start_times || [])[0] || 'none specified');
    console.log('  - Contract Type:', d.preferred_contract_type);
  }

  await pool.end();
}
main();
