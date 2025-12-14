/**
 * VERBOSE TRAINING - Show every assignment being sent to XGBoost
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function main() {
  console.log('='.repeat(80));
  console.log('VERBOSE TRAINING: Line-by-line of all training data');
  console.log('='.repeat(80));

  // Fetch ALL assignments from database
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
    AND ba.is_active = true
    ORDER BY b.solo_type, b.service_date, b.tractor_id
  `);

  const rawAssignments = result.rows as any[];

  console.log(`\nTotal assignments fetched: ${rawAssignments.length}`);
  console.log('');

  // Transform and display each assignment
  const assignments: any[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Group by solo type for display
  let currentSoloType = '';
  let soloTypeCount = 0;

  console.log('='.repeat(80));
  console.log('ALL TRAINING ASSIGNMENTS:');
  console.log('='.repeat(80));
  console.log('');

  for (let i = 0; i < rawAssignments.length; i++) {
    const a = rawAssignments[i];

    // Extract time from timestamp
    let startTime = '00:00';
    if (a.start_timestamp) {
      const tsStr = String(a.start_timestamp);
      const match = tsStr.match(/(\d{2}:\d{2})/);
      if (match) startTime = match[1];
    }

    // Format service date
    let serviceDate = '';
    if (a.service_date) {
      const d = new Date(a.service_date);
      serviceDate = d.toISOString().split('T')[0];
    }

    const dow = parseInt(a.day_of_week);
    const dayName = dayNames[dow];

    // Print header when solo type changes
    if (a.solo_type !== currentSoloType) {
      if (currentSoloType !== '') {
        console.log(`  --- ${currentSoloType} total: ${soloTypeCount} assignments ---`);
        console.log('');
      }
      currentSoloType = a.solo_type;
      soloTypeCount = 0;
      console.log(`═══ ${a.solo_type.toUpperCase()} ASSIGNMENTS ═══`);
      console.log('');
    }

    soloTypeCount++;

    // Print each assignment
    const lineNum = String(i + 1).padStart(3);
    const dateStr = serviceDate.padEnd(12);
    const dayStr = dayName.padEnd(4);
    const timeStr = startTime.padEnd(6);
    const tractorStr = a.tractor_id.padEnd(12);
    const driverStr = a.driver_name.slice(0, 30).padEnd(30);

    console.log(`${lineNum}. ${dateStr} ${dayStr} ${timeStr} ${tractorStr} → ${driverStr}`);

    // Build assignment object for training
    assignments.push({
      driverId: a.driver_id,
      driverName: a.driver_name,
      soloType: a.solo_type,
      tractorId: a.tractor_id,
      startTime: startTime,
      dayOfWeek: dow,
      serviceDate: serviceDate,
    });
  }

  // Print final count
  console.log(`  --- ${currentSoloType} total: ${soloTypeCount} assignments ---`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('TRAINING DATA SUMMARY:');
  console.log('='.repeat(80));

  const solo1 = assignments.filter(a => a.soloType === 'solo1');
  const solo2 = assignments.filter(a => a.soloType === 'solo2');

  console.log(`  Solo1: ${solo1.length} assignments`);
  console.log(`  Solo2: ${solo2.length} assignments`);
  console.log(`  TOTAL: ${assignments.length} assignments`);
  console.log('');

  // Unique drivers
  const solo1Drivers = new Set(solo1.map(a => a.driverName));
  const solo2Drivers = new Set(solo2.map(a => a.driverName));
  const allDrivers = new Set(assignments.map(a => a.driverName));

  console.log(`  Solo1 drivers: ${solo1Drivers.size}`);
  console.log(`  Solo2 drivers: ${solo2Drivers.size}`);
  console.log(`  Total unique drivers: ${allDrivers.size}`);
  console.log('');

  // Date range
  const dates = assignments.map(a => a.serviceDate).filter(d => d).sort();
  console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log('');

  // List all drivers
  console.log('='.repeat(80));
  console.log('ALL DRIVERS IN TRAINING:');
  console.log('='.repeat(80));
  console.log('');

  const driverCounts: Record<string, { solo1: number; solo2: number }> = {};
  for (const a of assignments) {
    if (!driverCounts[a.driverName]) {
      driverCounts[a.driverName] = { solo1: 0, solo2: 0 };
    }
    if (a.soloType === 'solo1') driverCounts[a.driverName].solo1++;
    else if (a.soloType === 'solo2') driverCounts[a.driverName].solo2++;
  }

  const sortedDrivers = Object.entries(driverCounts)
    .sort((a, b) => (b[1].solo1 + b[1].solo2) - (a[1].solo1 + a[1].solo2));

  console.log('Driver'.padEnd(35) + 'Solo1'.padStart(8) + 'Solo2'.padStart(8) + 'Total'.padStart(8));
  console.log('-'.repeat(60));

  for (const [name, counts] of sortedDrivers) {
    const total = counts.solo1 + counts.solo2;
    console.log(
      name.slice(0, 34).padEnd(35) +
      String(counts.solo1).padStart(8) +
      String(counts.solo2).padStart(8) +
      String(total).padStart(8)
    );
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('TRAINING XGBoost Ownership Model...');
  console.log('='.repeat(80));
  console.log('');

  // Train the model
  const trainInput = { action: 'train', assignments };

  await new Promise<void>((resolve, reject) => {
    const pythonPath = 'C:/Users/shire/AppData/Local/Programs/Python/Python312/python.exe';
    const proc = spawn(pythonPath, ['python/xgboost_ownership.py'], { cwd: process.cwd() });

    proc.stdin.write(JSON.stringify(trainInput));
    proc.stdin.end();

    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { process.stderr.write(data); });

    proc.on('close', (code) => {
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

  console.log('');
  console.log('='.repeat(80));
  console.log('TRAINING COMPLETE');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch(console.error);
