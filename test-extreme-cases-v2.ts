/**
 * Better extreme case test - find true patterns
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

async function main() {
  console.log('='.repeat(70));
  console.log('Finding REAL extreme cases');
  console.log('='.repeat(70));

  // Fetch all assignments
  const result = await db.execute(sql`
    SELECT ba.driver_id, b.service_date, ba.block_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id IS NOT NULL
  `);

  const allAssignments = result.rows as { driver_id: string; service_date: string; block_id: string }[];

  // Group by driver and analyze weekday patterns
  const driverAnalysis: Record<string, {
    history: any[];
    weekdayCounts: Record<string, number>;
    totalShifts: number;
  }> = {};

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (const a of allAssignments) {
    if (!a.driver_id) continue;
    if (!driverAnalysis[a.driver_id]) {
      driverAnalysis[a.driver_id] = {
        history: [],
        weekdayCounts: { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 },
        totalShifts: 0,
      };
    }

    const date = new Date(a.service_date);
    const dayName = dayNames[date.getDay()];

    driverAnalysis[a.driver_id].history.push({
      serviceDate: a.service_date,
      blockId: a.block_id,
    });
    driverAnalysis[a.driver_id].weekdayCounts[dayName]++;
    driverAnalysis[a.driver_id].totalShifts++;
  }

  console.log('\nDriver weekday patterns:');
  console.log('-'.repeat(70));

  // Find drivers with strong day preferences
  const driverPatterns: {
    id: string;
    total: number;
    bestDay: string;
    bestDayCount: number;
    bestDayPct: number;
    zeroDays: string[];
  }[] = [];

  for (const [driverId, data] of Object.entries(driverAnalysis)) {
    const { weekdayCounts, totalShifts } = data;

    // Find best day
    let bestDay = 'Mon';
    let bestDayCount = 0;
    const zeroDays: string[] = [];

    for (const [day, count] of Object.entries(weekdayCounts)) {
      if (count > bestDayCount) {
        bestDayCount = count;
        bestDay = day;
      }
      if (count === 0) {
        zeroDays.push(day);
      }
    }

    driverPatterns.push({
      id: driverId,
      total: totalShifts,
      bestDay,
      bestDayCount,
      bestDayPct: (bestDayCount / totalShifts) * 100,
      zeroDays,
    });
  }

  // Sort by best day percentage
  driverPatterns.sort((a, b) => b.bestDayPct - a.bestDayPct);

  console.log('Top 10 drivers by day specialization:');
  for (const p of driverPatterns.slice(0, 10)) {
    console.log(`  ${p.id.slice(0, 8)}... ${p.bestDay}: ${p.bestDayCount}/${p.total} (${p.bestDayPct.toFixed(0)}%) | Never works: ${p.zeroDays.join(', ') || 'none'}`);
  }

  // Find a good test case: driver who works Saturday a lot vs never
  const saturdayWorkers = driverPatterns.filter(p => p.bestDay === 'Sat' && p.bestDayPct >= 25);
  const neverSaturdayWorkers = driverPatterns.filter(p => p.zeroDays.includes('Sat') && p.total >= 10);

  console.log('\n' + '='.repeat(70));
  console.log('TEST CASE: Saturday');
  console.log('='.repeat(70));

  if (saturdayWorkers.length > 0 && neverSaturdayWorkers.length > 0) {
    const satWorker = saturdayWorkers[0];
    const noSatWorker = neverSaturdayWorkers[0];

    console.log(`\nSaturday specialist: ${satWorker.id.slice(0, 8)}...`);
    console.log(`  Works Sat: ${satWorker.bestDayCount}/${satWorker.total} (${satWorker.bestDayPct.toFixed(0)}%)`);
    console.log(`  Full pattern: ${JSON.stringify(driverAnalysis[satWorker.id].weekdayCounts)}`);

    console.log(`\nNever-Saturday worker: ${noSatWorker.id.slice(0, 8)}...`);
    console.log(`  Works Sat: 0/${noSatWorker.total} (0%)`);
    console.log(`  Full pattern: ${JSON.stringify(driverAnalysis[noSatWorker.id].weekdayCounts)}`);

    // Use a known Saturday: Dec 13, 2025 (verified via Python calendar)
    const saturdayStr = '2025-12-13';

    console.log(`\nTest date: ${saturdayStr} (Saturday)`);

    // Test predictions
    const testInput = {
      action: 'test_extreme_cases',
      tuesdayWorker: {
        driverId: satWorker.id,
        history: driverAnalysis[satWorker.id].history,
      },
      neverTuesdayWorker: {
        driverId: noSatWorker.id,
        history: driverAnalysis[noSatWorker.id].history,
      },
      testDate: saturdayStr,
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
            console.log('SATURDAY TEST RESULTS:');
            console.log('='.repeat(70));

            const satProb = result.tuesdayWorkerProb;
            const noSatProb = result.neverTuesdayProb;
            const diff = result.difference;

            console.log(`Saturday worker freq_this_day:     ${result.tuesdayWorkerFeatures.historical_freq_this_day.toFixed(3)}`);
            console.log(`Never-Saturday freq_this_day:      ${result.neverTuesdayFeatures.historical_freq_this_day.toFixed(3)}`);
            console.log('');
            console.log(`Saturday worker XGBoost score:     ${(satProb * 100).toFixed(1)}%`);
            console.log(`Never-Saturday XGBoost score:      ${(noSatProb * 100).toFixed(1)}%`);
            console.log(`Difference:                        ${(diff * 100).toFixed(1)}%`);

            if (satProb > noSatProb && diff > 0.1) {
              console.log('\n✓ SUCCESS: Model correctly ranks Saturday specialist higher!');
            } else if (satProb <= noSatProb) {
              console.log('\n✗ FAILURE: Model ranks Never-Saturday worker higher or equal!');
            } else {
              console.log('\n⚠ WARNING: Difference is small (<10%)');
            }
          } catch {
            console.log('\nRaw output:', stdout);
          }
        }
        resolve();
      });
    });
  } else {
    console.log('Could not find good Saturday test cases');
  }

  process.exit(0);
}

main().catch(console.error);
