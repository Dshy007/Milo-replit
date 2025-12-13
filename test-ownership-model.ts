/**
 * Test the Ownership Model
 * 1. Load 3 weeks of historical assignments
 * 2. Train the ownership model
 * 3. Test predictions for sample slots
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

async function main() {
  console.log('='.repeat(70));
  console.log('Building Ownership Model');
  console.log('='.repeat(70));

  // Load 3 weeks of historical assignments
  const result = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.solo_type,
      b.tractor_id,
      b.start_timestamp,
      b.service_date,
      EXTRACT(DOW FROM b.service_date) as day_of_week
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.driver_id IS NOT NULL
    ORDER BY b.service_date DESC
  `);

  const rawAssignments = result.rows as any[];
  console.log(`\nLoaded ${rawAssignments.length} assignments from DB`);

  // Transform to format expected by Python
  const assignments = rawAssignments.map(a => {
    // Extract time from start_timestamp (format: "2025-11-14 22:30:00")
    let startTime = '00:00';
    if (a.start_timestamp) {
      const tsStr = String(a.start_timestamp);
      const match = tsStr.match(/(\d{2}:\d{2})/);
      if (match) {
        startTime = match[1];
      }
    }

    // Format service_date as YYYY-MM-DD string
    let serviceDate = '';
    if (a.service_date) {
      const d = new Date(a.service_date);
      serviceDate = d.toISOString().split('T')[0];
    }

    return {
      driverId: a.driver_id,
      driverName: a.driver_name,
      soloType: a.solo_type,
      tractorId: a.tractor_id,
      startTime: startTime,
      dayOfWeek: parseInt(a.day_of_week),
      serviceDate: serviceDate,  // NOW INCLUDED for date-based filtering!
    };
  });

  // Show sample
  console.log('\nSample assignments (with dates):');
  for (const a of assignments.slice(0, 5)) {
    console.log(`  ${a.serviceDate} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][a.dayOfWeek]}: ${a.driverName} → ${a.soloType}_${a.tractorId}`);
  }

  // Show date range
  const dates = assignments.map(a => a.serviceDate).filter(d => d).sort();
  if (dates.length > 0) {
    console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]} (${dates.length} assignments)`);
  }

  // Train the model
  console.log('\n' + '='.repeat(70));
  console.log('Training Ownership Model...');
  console.log('='.repeat(70));

  const trainInput = {
    action: 'train',
    assignments: assignments,
  };

  await new Promise<void>((resolve, reject) => {
    const pythonProcess = spawn('python', ['python/xgboost_ownership.py'], {
      cwd: process.cwd(),
    });

    pythonProcess.stdin.write(JSON.stringify(trainInput));
    pythonProcess.stdin.end();

    let stdout = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    pythonProcess.on('close', (code) => {
      if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout);
          console.log('\nTraining result:', JSON.stringify(result, null, 2));
        } catch {
          console.log('\nRaw output:', stdout);
        }
      }
      if (code === 0) resolve();
      else reject(new Error(`Python exited with code ${code}`));
    });
  });

  // Test predictions
  console.log('\n' + '='.repeat(70));
  console.log('Testing Predictions');
  console.log('='.repeat(70));

  const testCases = [
    { soloType: 'solo1', tractorId: 'Tractor_1', dayOfWeek: 0 },  // Sunday
    { soloType: 'solo1', tractorId: 'Tractor_1', dayOfWeek: 1 },  // Monday
    { soloType: 'solo1', tractorId: 'Tractor_2', dayOfWeek: 3 },  // Wednesday
    { soloType: 'solo2', tractorId: 'Tractor_3', dayOfWeek: 6 },  // Saturday
    { soloType: 'solo1', tractorId: 'Tractor_5', dayOfWeek: 5 },  // Friday
  ];

  const testInput = {
    action: 'test_predictions',
    testCases: testCases,
  };

  await new Promise<void>((resolve) => {
    const pythonProcess = spawn('python', ['python/xgboost_ownership.py'], {
      cwd: process.cwd(),
    });

    pythonProcess.stdin.write(JSON.stringify(testInput));
    pythonProcess.stdin.end();

    let stdout = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    pythonProcess.on('close', () => {
      if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout);
          console.log('\nPredictions:');
          console.log('-'.repeat(70));
          for (const p of result.predictions || []) {
            console.log(`  ${p.slot} @ ${p.canonicalTime}`);
            console.log(`    -> ${p.predictedOwner} (${p.confidence} confidence)`);
          }
        } catch {
          console.log('\nRaw output:', stdout);
        }
      }
      resolve();
    });
  });

  // Show slot ownership summary
  console.log('\n' + '='.repeat(70));
  console.log('Slot Ownership Summary (Top 20)');
  console.log('='.repeat(70));

  const summaryInput = {
    action: 'show_ownership',
  };

  await new Promise<void>((resolve) => {
    const pythonProcess = spawn('python', ['python/xgboost_ownership.py'], {
      cwd: process.cwd(),
    });

    pythonProcess.stdin.write(JSON.stringify(summaryInput));
    pythonProcess.stdin.end();

    let stdout = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    pythonProcess.on('close', () => {
      if (stdout.trim()) {
        try {
          const result = JSON.parse(stdout);
          const slots = result.slots || [];
          console.log('\n');
          console.log('Slot'.padEnd(35) + 'Time'.padEnd(8) + 'Owner'.padEnd(25) + 'Count');
          console.log('-'.repeat(80));
          for (const s of slots.slice(0, 20)) {
            console.log(
              s.slot.padEnd(35) +
              s.time.padEnd(8) +
              s.owner.slice(0, 24).padEnd(25) +
              `${s.count}/${s.total} (${s.percentage})`
            );
          }
          if (slots.length > 20) {
            console.log(`... and ${slots.length - 20} more slots`);
          }
        } catch {
          console.log('\nRaw output:', stdout);
        }
      }
      resolve();
    });
  });

  process.exit(0);
}

main().catch(console.error);
