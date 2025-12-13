/**
 * Check predictions for specific drivers: Firas, Tareef, Dan Shirey
 * What slots would they own next week?
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

async function main() {
  console.log('='.repeat(70));
  console.log('Predictions for Firas, Tareef, and Dan Shirey');
  console.log('='.repeat(70));

  // First, find these drivers and their historical patterns
  const driversResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE LOWER(first_name) LIKE '%firas%'
       OR LOWER(first_name) LIKE '%tareef%'
       OR (LOWER(first_name) LIKE '%dan%' AND LOWER(last_name) LIKE '%shirey%')
  `);

  console.log('\nFound drivers:', driversResult.rows);

  // Get their historical assignments
  for (const driver of driversResult.rows as any[]) {
    const driverName = `${driver.first_name} ${driver.last_name}`;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Driver: ${driverName}`);
    console.log('='.repeat(70));

    // Get their assignment history
    const historyResult = await db.execute(sql`
      SELECT
        b.solo_type,
        b.tractor_id,
        b.service_date,
        EXTRACT(DOW FROM b.service_date) as day_of_week,
        TO_CHAR(b.start_timestamp, 'HH24:MI') as start_time
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = ${driver.id}
      ORDER BY b.service_date DESC
    `);

    const history = historyResult.rows as any[];
    console.log(`\nTotal historical assignments: ${history.length}`);

    // Analyze their patterns
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayCounts: Record<string, number> = {};
    const tractorCounts: Record<string, number> = {};
    const slotCounts: Record<string, number> = {};

    for (const h of history) {
      const dow = parseInt(h.day_of_week);
      const dayName = dayNames[dow];
      dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;

      const tractorKey = `${h.solo_type}_${h.tractor_id}`;
      tractorCounts[tractorKey] = (tractorCounts[tractorKey] || 0) + 1;

      const slotKey = `${h.solo_type}_${h.tractor_id}_${dayName}`;
      slotCounts[slotKey] = (slotCounts[slotKey] || 0) + 1;
    }

    console.log('\nDay distribution:');
    for (const [day, count] of Object.entries(dayCounts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / history.length) * 100).toFixed(0);
      console.log(`  ${day}: ${count} (${pct}%)`);
    }

    console.log('\nTractor distribution:');
    for (const [tractor, count] of Object.entries(tractorCounts).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / history.length) * 100).toFixed(0);
      console.log(`  ${tractor}: ${count} (${pct}%)`);
    }

    console.log('\nTop slots (tractor + day combinations):');
    const sortedSlots = Object.entries(slotCounts).sort((a, b) => b[1] - a[1]);
    for (const [slot, count] of sortedSlots.slice(0, 5)) {
      const pct = ((count / history.length) * 100).toFixed(0);
      console.log(`  ${slot}: ${count} (${pct}%)`);
    }

    // Show recent assignments
    console.log('\nRecent assignments (last 10):');
    for (const h of history.slice(0, 10)) {
      const dow = parseInt(h.day_of_week);
      console.log(`  ${h.service_date.split(' ')[0]} (${dayNames[dow]}): ${h.solo_type}_${h.tractor_id} @ ${h.start_time}`);
    }
  }

  // Now check what the ownership model predicts for these drivers
  console.log('\n' + '='.repeat(70));
  console.log('Ownership Model: Which slots do these drivers OWN?');
  console.log('='.repeat(70));

  // Load the ownership model and find slots owned by these drivers
  const checkInput = {
    action: 'show_ownership',
  };

  await new Promise<void>((resolve) => {
    const pythonProcess = spawn('python', ['python/xgboost_ownership.py'], {
      cwd: process.cwd(),
    });

    pythonProcess.stdin.write(JSON.stringify(checkInput));
    pythonProcess.stdin.end();

    let stdout = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      // Suppress stderr for cleaner output
    });

    pythonProcess.on('close', () => {
      if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout);
          const slots = result.slots || [];

          // Find slots owned by our target drivers
          const targetDrivers = ['Firas', 'Tareef', 'Dan', 'Shirey'];

          console.log('\nSlots owned by target drivers:');
          console.log('-'.repeat(70));

          for (const s of slots) {
            const ownerLower = s.owner.toLowerCase();
            if (targetDrivers.some(t => ownerLower.includes(t.toLowerCase()))) {
              console.log(`${s.slot.padEnd(35)} @ ${s.time} -> ${s.owner} (${s.count}/${s.total} = ${s.percentage})`);
            }
          }
        } catch {
          console.log('Error parsing ownership data');
        }
      }
      resolve();
    });
  });

  // Predict next week's schedule for these drivers using availability model
  console.log('\n' + '='.repeat(70));
  console.log('Availability Model: Next Week Predictions');
  console.log('='.repeat(70));

  // Next week dates (Dec 15-21, 2025)
  const nextWeekDates = [
    '2025-12-14', // Sunday
    '2025-12-15', // Monday
    '2025-12-16', // Tuesday
    '2025-12-17', // Wednesday
    '2025-12-18', // Thursday
    '2025-12-19', // Friday
    '2025-12-20', // Saturday
  ];

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const driver of driversResult.rows as any[]) {
    const driverName = `${driver.first_name} ${driver.last_name}`;
    console.log(`\n${driverName}:`);

    // Get driver's history for availability model
    const historyResult = await db.execute(sql`
      SELECT b.service_date
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = ${driver.id}
    `);

    const history = (historyResult.rows as any[]).map(h => ({
      serviceDate: h.service_date,
    }));

    // Call availability model for each day
    const predictions: { day: string; date: string; prob: number }[] = [];

    for (let i = 0; i < nextWeekDates.length; i++) {
      const date = nextWeekDates[i];
      const dayName = dayNames[i];

      const input = {
        action: 'predict',
        driverId: driver.id,
        date: date,
        history: history,
      };

      const prob = await new Promise<number>((resolve) => {
        const pythonProcess = spawn('python', ['python/xgboost_availability.py'], {
          cwd: process.cwd(),
        });

        pythonProcess.stdin.write(JSON.stringify(input));
        pythonProcess.stdin.end();

        let stdout = '';
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        pythonProcess.on('close', () => {
          try {
            const result = JSON.parse(stdout);
            resolve(result.probability || 0);
          } catch {
            resolve(0);
          }
        });
      });

      predictions.push({ day: dayName, date, prob });
    }

    // Show predictions
    console.log('  Day     Date         Probability');
    console.log('  ' + '-'.repeat(40));
    for (const p of predictions) {
      const bar = '█'.repeat(Math.round(p.prob * 20));
      const probStr = `${(p.prob * 100).toFixed(0)}%`.padStart(4);
      console.log(`  ${p.day.padEnd(6)} ${p.date}   ${probStr} ${bar}`);
    }

    // Show likely work days
    const likelyDays = predictions.filter(p => p.prob >= 0.5);
    if (likelyDays.length > 0) {
      console.log(`  -> Likely to work: ${likelyDays.map(p => p.day).join(', ')}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
