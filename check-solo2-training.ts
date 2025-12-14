import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function callPython(script: string, input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonPath = 'C:/Users/shire/AppData/Local/Programs/Python/Python312/python.exe';
    const proc = spawn(pythonPath, [`python/${script}`]);

    let stdout = '';
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', () => { /* ignore */ });

    proc.on('close', () => {
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve({ error: 'parse failed', raw: stdout });
      }
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function main() {
  console.log('='.repeat(70));
  console.log('SOLO2 TRAINING DATA CHECK');
  console.log('='.repeat(70));

  // 1. Count assignments by solo_type in DB
  console.log('\n1. ASSIGNMENTS IN DATABASE:');
  const dbCounts = await db.execute(sql`
    SELECT b.solo_type, COUNT(*) as count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND ba.driver_id IS NOT NULL
    GROUP BY b.solo_type
    ORDER BY b.solo_type
  `);

  for (const row of dbCounts.rows as any[]) {
    console.log(`   ${row.solo_type}: ${row.count} assignments`);
  }

  // 2. Count distinct drivers by solo_type
  console.log('\n2. DISTINCT DRIVERS BY SOLO TYPE:');
  const driverCounts = await db.execute(sql`
    SELECT b.solo_type, COUNT(DISTINCT ba.driver_id) as count
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND ba.driver_id IS NOT NULL
    GROUP BY b.solo_type
    ORDER BY b.solo_type
  `);

  for (const row of driverCounts.rows as any[]) {
    console.log(`   ${row.solo_type}: ${row.count} drivers`);
  }

  // 3. Check ownership model - show all slots
  console.log('\n3. OWNERSHIP MODEL - SLOTS BY SOLO TYPE:');
  const ownership = await callPython('xgboost_ownership.py', {
    action: 'show_ownership'
  });

  if (ownership.slots) {
    const solo1Slots = ownership.slots.filter((s: any) => s.slot.startsWith('solo1'));
    const solo2Slots = ownership.slots.filter((s: any) => s.slot.startsWith('solo2'));

    console.log(`   Solo1 slots in model: ${solo1Slots.length}`);
    console.log(`   Solo2 slots in model: ${solo2Slots.length}`);

    if (solo2Slots.length > 0) {
      console.log('\n   Sample Solo2 slots:');
      for (const slot of solo2Slots.slice(0, 5)) {
        console.log(`     ${slot.slot} @ ${slot.time} → ${slot.owner} (${slot.percentage})`);
      }
    } else {
      console.log('\n   ⚠️  NO SOLO2 SLOTS IN OWNERSHIP MODEL!');
    }
  } else {
    console.log('   Error loading ownership:', ownership);
  }

  // 4. Test a specific Solo2 slot
  console.log('\n4. TEST SOLO2 SLOT OWNERSHIP:');
  // Solo2 Tractor_1 @ 18:30 on Sunday
  const solo2Test = await callPython('xgboost_ownership.py', {
    action: 'get_distribution',
    soloType: 'solo2',
    tractorId: 'Tractor_1',
    dayOfWeek: 0,  // Sunday
    canonicalTime: '18:30'
  });

  console.log(`   Slot: solo2_Tractor_1_Sunday @ 18:30`);
  console.log(`   Type: ${solo2Test.slot_type || 'unknown'}`);
  console.log(`   Owner: ${solo2Test.owner || '(none)'}`);
  console.log(`   Total assignments: ${solo2Test.total_assignments || 0}`);

  if (solo2Test.shares) {
    console.log('   Shares:');
    const sorted = Object.entries(solo2Test.shares)
      .sort((a, b) => (b[1] as number) - (a[1] as number));
    for (const [name, share] of sorted.slice(0, 5)) {
      console.log(`     ${((share as number) * 100).toFixed(1)}% - ${name}`);
    }
  }

  // 5. Check what data was actually trained
  console.log('\n5. CHECK TRAINED MODEL ENCODERS:');
  const fs = await import('fs');
  const encodersPath = 'python/models/ownership_encoders.json';

  try {
    const encoders = JSON.parse(fs.readFileSync(encodersPath, 'utf-8'));
    console.log(`   Solo types in model: ${JSON.stringify(encoders.solo_type_classes)}`);
    console.log(`   Tractors in model: ${encoders.tractor_classes?.length || 0}`);
    console.log(`   Drivers in model: ${encoders.driver_classes?.length || 0}`);

    // Count slots by solo type
    const slotKeys = Object.keys(encoders.slot_ownership || {});
    const solo1Count = slotKeys.filter(k => k.startsWith('solo1')).length;
    const solo2Count = slotKeys.filter(k => k.startsWith('solo2')).length;
    console.log(`\n   Slot ownership entries:`);
    console.log(`     solo1: ${solo1Count} slots`);
    console.log(`     solo2: ${solo2Count} slots`);

    if (solo2Count === 0) {
      console.log('\n   ⚠️  SOLO2 WAS NOT TRAINED!');
    }
  } catch (e) {
    console.log('   Could not read encoders file:', e);
  }

  console.log('\n' + '='.repeat(70));
  process.exit(0);
}

main().catch(console.error);
