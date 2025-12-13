/**
 * Test the fixed build_training_data() function
 * Shows sample counts WITHOUT retraining
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

async function main() {
  console.log('='.repeat(60));
  console.log('Testing Fixed build_training_data()');
  console.log('='.repeat(60));

  // First check date range in DB
  const rangeResult = await db.execute(sql`
    SELECT MIN(b.service_date) as min_date, MAX(b.service_date) as max_date, COUNT(*) as total
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
  `);
  const rangeRow = rangeResult.rows[0] as any;
  console.log(`\nDB date range: ${rangeRow.min_date} to ${rangeRow.max_date}`);
  console.log(`Total assignments in DB: ${rangeRow.total}`);

  // Use actual date range from DB
  const endDate = rangeRow.max_date;
  const startDate = rangeRow.min_date;

  console.log(`\nQuerying: ${startDate} to ${endDate}`);

  // Fetch all assignments
  const result = await db.execute(sql`
    SELECT ba.id, ba.driver_id, b.service_date, ba.block_id
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id IS NOT NULL
  `);

  const allAssignments = result.rows as { id: string; driver_id: string; service_date: string; block_id: string }[];

  console.log(`Fetched assignments: ${allAssignments.length}`);

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

  const driverCount = Object.keys(driverHistories).length;
  console.log(`Drivers with assignments: ${driverCount}`);

  if (driverCount === 0) {
    console.log('\nNo driver histories found. Exiting.');
    process.exit(0);
  }

  // Show per-driver assignment counts
  console.log('\nPer-driver assignment counts:');
  const counts = Object.entries(driverHistories)
    .map(([id, h]) => ({ id: id.slice(0, 8), count: h.length }))
    .sort((a, b) => b.count - a.count);

  console.log(`  Min: ${counts[counts.length - 1].count}, Max: ${counts[0].count}, Avg: ${(allAssignments.length / driverCount).toFixed(1)}`);

  // Call Python to test build_training_data
  console.log('\n' + '='.repeat(60));
  console.log('Calling Python build_training_data()...');
  console.log('='.repeat(60));

  const input = {
    action: 'test_build_training_data',
    histories: driverHistories,
  };

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
    // Print stderr in real-time (training output goes there)
    process.stderr.write(data);
  });

  pythonProcess.on('close', (code) => {
    if (stdout.trim()) {
      try {
        const result = JSON.parse(stdout);
        console.log('\n' + '='.repeat(60));
        console.log('RESULT:');
        console.log('='.repeat(60));
        console.log(JSON.stringify(result, null, 2));
      } catch {
        console.log('\nRaw output:', stdout);
      }
    }
    process.exit(code || 0);
  });
}

main().catch(console.error);
