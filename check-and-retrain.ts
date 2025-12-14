import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';
import * as fs from 'fs';

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function main() {
  console.log('='.repeat(70));
  console.log('STEP 1: CHECK CURRENT TRAINING DATA');
  console.log('='.repeat(70));

  // Check DB counts
  const dbCounts = await db.execute(sql`
    SELECT b.solo_type, COUNT(*) as assignments, COUNT(DISTINCT ba.driver_id) as drivers
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND ba.driver_id IS NOT NULL
    GROUP BY b.solo_type
    ORDER BY b.solo_type
  `);

  console.log('\nDATABASE COUNTS:');
  for (const row of dbCounts.rows as any[]) {
    console.log(`  ${row.solo_type}: ${row.assignments} assignments, ${row.drivers} drivers`);
  }

  // Check date range in DB
  const dateRange = await db.execute(sql`
    SELECT MIN(b.service_date)::text as min_date, MAX(b.service_date)::text as max_date
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true AND ba.driver_id IS NOT NULL
  `);
  const dates = dateRange.rows[0] as any;
  console.log(`\nDATE RANGE IN DB: ${dates.min_date} to ${dates.max_date}`);

  // Check what's in the trained model
  const encodersPath = 'python/models/ownership_encoders.json';
  try {
    const encoders = JSON.parse(fs.readFileSync(encodersPath, 'utf-8'));
    const slotKeys = Object.keys(encoders.slot_ownership || {});
    const solo1Slots = slotKeys.filter(k => k.startsWith('solo1')).length;
    const solo2Slots = slotKeys.filter(k => k.startsWith('solo2')).length;

    console.log('\nCURRENT TRAINED MODEL:');
    console.log(`  Solo types: ${JSON.stringify(encoders.solo_type_classes)}`);
    console.log(`  Drivers: ${encoders.driver_classes?.length || 0}`);
    console.log(`  Solo1 slots: ${solo1Slots}`);
    console.log(`  Solo2 slots: ${solo2Slots}`);

    // Count total assignments in model
    let totalAssignments = 0;
    for (const slot of Object.values(encoders.slot_ownership || {})) {
      for (const dates of Object.values(slot as any)) {
        totalAssignments += Array.isArray(dates) ? dates.length : 0;
      }
    }
    console.log(`  Total assignments in model: ${totalAssignments}`);

  } catch (e) {
    console.log('  Could not read model file');
  }

  console.log('\n' + '='.repeat(70));
  console.log('STEP 2: RETRAIN WITH ALL DATA (NO DATE FILTER)');
  console.log('='.repeat(70));

  // Fetch ALL assignments - no date filter = MAX lookback
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
    ORDER BY b.service_date DESC
  `);

  const rawAssignments = result.rows as any[];
  console.log(`\nFetched ${rawAssignments.length} assignments from DB`);

  // Transform to format expected by Python
  const assignments = rawAssignments.map(a => {
    let startTime = '00:00';
    if (a.start_timestamp) {
      const tsStr = String(a.start_timestamp);
      const match = tsStr.match(/(\d{2}:\d{2})/);
      if (match) startTime = match[1];
    }

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
      serviceDate: serviceDate,
    };
  });

  // Count by solo type
  const solo1Count = assignments.filter(a => a.soloType === 'solo1').length;
  const solo2Count = assignments.filter(a => a.soloType === 'solo2').length;
  console.log(`  Solo1: ${solo1Count} assignments`);
  console.log(`  Solo2: ${solo2Count} assignments`);

  // Get date range
  const serviceDates = assignments.map(a => a.serviceDate).filter(d => d).sort();
  console.log(`  Date range: ${serviceDates[0]} to ${serviceDates[serviceDates.length - 1]}`);

  // Train ownership model
  console.log('\nTraining ownership model...');
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
          console.log('Training result:', JSON.stringify(result, null, 2));
        } catch {
          console.log('Raw output:', stdout);
        }
      }
      if (code === 0) resolve();
      else reject(new Error(`Python exited with code ${code}`));
    });
  });

  console.log('\n' + '='.repeat(70));
  console.log('STEP 3: VERIFY RETRAINED MODEL');
  console.log('='.repeat(70));

  // Re-read model file
  try {
    const encoders = JSON.parse(fs.readFileSync(encodersPath, 'utf-8'));
    const slotKeys = Object.keys(encoders.slot_ownership || {});
    const solo1Slots = slotKeys.filter(k => k.startsWith('solo1')).length;
    const solo2Slots = slotKeys.filter(k => k.startsWith('solo2')).length;

    console.log('\nRETRAINED MODEL:');
    console.log(`  Solo types: ${JSON.stringify(encoders.solo_type_classes)}`);
    console.log(`  Drivers: ${encoders.driver_classes?.length || 0}`);
    console.log(`  Solo1 slots: ${solo1Slots}`);
    console.log(`  Solo2 slots: ${solo2Slots}`);

    let totalAssignments = 0;
    for (const slot of Object.values(encoders.slot_ownership || {})) {
      for (const dates of Object.values(slot as any)) {
        totalAssignments += Array.isArray(dates) ? dates.length : 0;
      }
    }
    console.log(`  Total assignments in model: ${totalAssignments}`);

  } catch (e) {
    console.log('  Could not read model file');
  }

  console.log('\n' + '='.repeat(70));
  process.exit(0);
}

main().catch(console.error);
