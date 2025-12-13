/**
 * STEP 3-5: Retrain with balanced data and verify
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

async function main() {
  console.log('='.repeat(70));
  console.log('STEP 3: Retrain XGBClassifier with balanced data');
  console.log('='.repeat(70));

  // Fetch all assignments
  const result = await db.execute(sql`
    SELECT ba.driver_id, b.service_date, ba.block_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id IS NOT NULL
  `);

  const allAssignments = result.rows as { driver_id: string; service_date: string; block_id: string }[];
  console.log(`\nFetched ${allAssignments.length} assignments from ${new Set(allAssignments.map(a => a.driver_id)).size} drivers`);

  // Group by driver
  const driverHistories: Record<string, any[]> = {};
  for (const a of allAssignments) {
    if (!a.driver_id) continue;
    if (!driverHistories[a.driver_id]) {
      driverHistories[a.driver_id] = [];
    }
    driverHistories[a.driver_id].push({
      serviceDate: a.service_date,
      blockId: a.block_id,
    });
  }

  // Call Python to train
  const input = {
    action: 'train',
    histories: driverHistories,
  };

  await new Promise<void>((resolve, reject) => {
    const pythonProcess = spawn('python', ['python/xgboost_availability.py'], {
      cwd: process.cwd(),
    });

    pythonProcess.stdin.write(JSON.stringify(input));
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

  // STEP 4 & 5: Test feature importance and extreme cases
  console.log('\n' + '='.repeat(70));
  console.log('STEP 4 & 5: Feature Importance + Extreme Case Testing');
  console.log('='.repeat(70));

  // Find a driver who works specific days consistently
  const driverDayCounts: Record<string, Record<number, number>> = {};
  for (const [driverId, history] of Object.entries(driverHistories)) {
    driverDayCounts[driverId] = {};
    for (const h of history) {
      const date = new Date(h.serviceDate);
      const dow = date.getDay(); // 0=Sun, 6=Sat
      driverDayCounts[driverId][dow] = (driverDayCounts[driverId][dow] || 0) + 1;
    }
  }

  // Find best Tuesday worker (day 2)
  let bestTuesdayDriver = '';
  let bestTuesdayCount = 0;
  let bestTuesdayTotal = 0;

  // Find driver who NEVER works Tuesday
  let neverTuesdayDriver = '';
  let neverTuesdayTotal = 0;

  for (const [driverId, dayCounts] of Object.entries(driverDayCounts)) {
    const tuesdayCount = dayCounts[2] || 0;
    const total = Object.values(dayCounts).reduce((a, b) => a + b, 0);

    if (tuesdayCount > bestTuesdayCount) {
      bestTuesdayCount = tuesdayCount;
      bestTuesdayDriver = driverId;
      bestTuesdayTotal = total;
    }

    if (tuesdayCount === 0 && total > neverTuesdayTotal) {
      neverTuesdayDriver = driverId;
      neverTuesdayTotal = total;
    }
  }

  console.log(`\nBest Tuesday worker: ${bestTuesdayDriver.slice(0, 8)}... (${bestTuesdayCount}/${bestTuesdayTotal} shifts on Tuesday)`);
  console.log(`Never Tuesday worker: ${neverTuesdayDriver.slice(0, 8)}... (0/${neverTuesdayTotal} shifts on Tuesday)`);

  // Find next Tuesday
  const today = new Date();
  const daysUntilTuesday = (2 - today.getDay() + 7) % 7 || 7;
  const nextTuesday = new Date(today);
  nextTuesday.setDate(today.getDate() + daysUntilTuesday);
  const tuesdayStr = nextTuesday.toISOString().split('T')[0];

  console.log(`\nTest date: ${tuesdayStr} (Tuesday)`);

  // Test predictions
  const testInput = {
    action: 'test_extreme_cases',
    tuesdayWorker: {
      driverId: bestTuesdayDriver,
      history: driverHistories[bestTuesdayDriver],
    },
    neverTuesdayWorker: {
      driverId: neverTuesdayDriver,
      history: driverHistories[neverTuesdayDriver],
    },
    testDate: tuesdayStr,
  };

  await new Promise<void>((resolve) => {
    const pythonProcess = spawn('python', ['python/xgboost_availability.py'], {
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
          console.log('\n' + '='.repeat(70));
          console.log('EXTREME CASE RESULTS:');
          console.log('='.repeat(70));
          console.log(JSON.stringify(result, null, 2));

          // Verify they're different
          if (result.tuesdayWorkerProb !== undefined && result.neverTuesdayProb !== undefined) {
            const diff = Math.abs(result.tuesdayWorkerProb - result.neverTuesdayProb);
            console.log(`\nDifference: ${(diff * 100).toFixed(1)}%`);
            if (diff < 0.1) {
              console.log('\n*** WARNING: Scores too similar! Model may not be learning features correctly ***');
            } else {
              console.log('\n*** SUCCESS: Model correctly differentiates Tuesday workers! ***');
            }
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
