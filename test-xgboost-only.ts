/**
 * Test XGBoost predictions WITHOUT OR-Tools
 *
 * Two REAL blocks for Sunday Dec 14:
 *   Block 1: 00:30, Solo1, Tractor_8, Lenexa → Expected: Brian Worts
 *   Block 2: 01:30, Solo1, Tractor_6, Lenexa → Expected: Richard Ewing
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';
import { spawn } from 'child_process';

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

interface Driver {
  id: string;
  name: string;
  contractType: string;
}

interface Block {
  id: string;
  serviceDate: string;
  startTime: string;
  soloType: string;
  tractorId: string;
}

async function getDrivers(): Promise<Driver[]> {
  // Get drivers who have worked solo1 blocks
  const result = await db.execute(sql`
    SELECT DISTINCT
      d.id,
      d.first_name || ' ' || d.last_name as name
    FROM drivers d
    WHERE d.tenant_id = ${TENANT_ID}
    AND d.status = 'active'
    AND EXISTS (
      SELECT 1 FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = d.id AND b.solo_type = 'solo1' AND ba.is_active = true
    )
  `);
  return (result.rows as any[]).map(r => ({
    id: r.id,
    name: r.name,
    contractType: 'solo1'
  }));
}

async function getDriverHistory(driverId: string): Promise<any[]> {
  const result = await db.execute(sql`
    SELECT
      ba.block_id,
      b.service_date::text as "serviceDate",
      b.start_timestamp::text as "startTime",
      b.solo_type as "soloType",
      b.tractor_id as "tractorId",
      EXTRACT(DOW FROM b.service_date)::int as "dayOfWeek"
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${driverId}
    AND ba.is_active = true
    AND b.service_date >= '2024-01-01'
    ORDER BY b.service_date DESC
  `);
  return result.rows as any[];
}

async function callPython(script: string, input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonPath = 'C:/Users/shire/AppData/Local/Programs/Python/Python312/python.exe';
    const proc = spawn(pythonPath, [`python/${script}`]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (stderr) console.error(stderr);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse output: ${stdout}`));
      }
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function getOwnershipScore(
  soloType: string,
  tractorId: string,
  dayOfWeek: number
): Promise<{ driver: string; confidence: number }> {
  const result = await callPython('xgboost_ownership.py', {
    action: 'predict',
    soloType,
    tractorId,
    dayOfWeek
  });
  return result;
}

async function getOwnershipDistribution(
  soloType: string,
  tractorId: string,
  dayOfWeek: number
): Promise<any> {
  const result = await callPython('xgboost_ownership.py', {
    action: 'get_distribution',
    soloType,
    tractorId,
    dayOfWeek
  });
  return result;
}

async function getAvailabilityScore(
  driverId: string,
  date: string,
  history: any[]
): Promise<number> {
  const result = await callPython('xgboost_availability.py', {
    action: 'predict',
    driverId,
    date,
    history
  });
  return result.probability || 0;
}

async function main() {
  console.log('='.repeat(70));
  console.log('XGBoost-Only Predictions (NO OR-Tools)');
  console.log('='.repeat(70));

  // Define the two blocks
  const blocks: Block[] = [
    {
      id: 'block1',
      serviceDate: '2024-12-14',  // Sunday Dec 14
      startTime: '00:30',
      soloType: 'solo1',
      tractorId: 'Tractor_8'
    },
    {
      id: 'block2',
      serviceDate: '2024-12-14',  // Sunday Dec 14
      startTime: '01:30',
      soloType: 'solo1',
      tractorId: 'Tractor_6'
    }
  ];

  // Get all solo1 drivers
  const drivers = await getDrivers();
  console.log(`\nFound ${drivers.length} solo1 drivers\n`);

  // Get history for each driver
  const driverHistories: Map<string, any[]> = new Map();
  for (const driver of drivers) {
    const history = await getDriverHistory(driver.id);
    driverHistories.set(driver.id, history);
  }

  // Dec 14 is a Sunday = dayOfWeek 0
  const dayOfWeek = 0;

  for (const block of blocks) {
    console.log('='.repeat(70));
    console.log(`BLOCK: ${block.soloType} ${block.tractorId} @ ${block.startTime} (Sunday Dec 14)`);
    console.log('='.repeat(70));

    // Step 1: Get ownership prediction for this slot
    console.log('\n--- OWNERSHIP MODEL ---');
    const ownership = await getOwnershipDistribution(
      block.soloType,
      block.tractorId,
      dayOfWeek
    );

    console.log(`Slot type: ${ownership.slot_type}`);
    console.log(`Owner: ${ownership.owner || 'NONE (rotating)'}`);
    console.log(`Owner share: ${((ownership.owner_share || 0) * 100).toFixed(1)}%`);
    console.log(`Total assignments: ${ownership.total_assignments}`);

    if (ownership.shares) {
      console.log('\nOwnership shares:');
      const sortedShares = Object.entries(ownership.shares)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5);
      for (const [name, share] of sortedShares) {
        console.log(`  ${name}: ${((share as number) * 100).toFixed(1)}%`);
      }
    }

    // Step 2: Get availability scores for all drivers
    console.log('\n--- AVAILABILITY SCORES ---');
    const scores: { driver: Driver; ownershipScore: number; availScore: number; combined: number }[] = [];

    for (const driver of drivers) {
      const history = driverHistories.get(driver.id) || [];

      // Get availability score
      let availScore = 0;
      try {
        availScore = await getAvailabilityScore(driver.id, block.serviceDate, history);
      } catch (e) {
        // Fallback: check if worked on Sunday before
        const sundayCount = history.filter(h => h.dayOfWeek === 0).length;
        availScore = sundayCount > 0 ? sundayCount / history.length : 0;
      }

      // Calculate ownership score for this driver on this slot
      const ownerShare = ownership.shares?.[driver.name] || 0;

      // Combined score: ownership weight + availability weight
      // If they OWN this slot, heavily favor them
      const ownershipWeight = 0.7;
      const availWeight = 0.3;
      const combined = (ownerShare * ownershipWeight) + (availScore * availWeight);

      scores.push({
        driver,
        ownershipScore: ownerShare,
        availScore,
        combined
      });
    }

    // Sort by combined score
    scores.sort((a, b) => b.combined - a.combined);

    // Show top 5
    console.log('\nTOP 5 DRIVERS BY COMBINED SCORE:');
    console.log('-'.repeat(70));
    console.log('Rank | Driver                    | Ownership | Avail  | Combined');
    console.log('-'.repeat(70));

    for (let i = 0; i < Math.min(5, scores.length); i++) {
      const s = scores[i];
      const rank = (i + 1).toString().padStart(2);
      const name = s.driver.name.padEnd(25);
      const own = (s.ownershipScore * 100).toFixed(1).padStart(6) + '%';
      const avail = (s.availScore * 100).toFixed(1).padStart(5) + '%';
      const comb = (s.combined * 100).toFixed(1).padStart(6) + '%';
      console.log(`  ${rank} | ${name} | ${own}   | ${avail} | ${comb}`);
    }

    // Check expected driver
    const expectedDriver = block.tractorId === 'Tractor_8' ? 'Brian Worts' : 'Richard Ewing';
    // For Richard Ewing - look for partial match since full name is different
    const expectedRank = scores.findIndex(s =>
      s.driver.name.toLowerCase().includes(expectedDriver.toLowerCase().split(' ')[1])
    ) + 1;

    console.log('\n' + '-'.repeat(70));
    console.log(`EXPECTED: ${expectedDriver}`);
    console.log(`XGBoost RANK: #${expectedRank} ${expectedRank === 1 ? '✓ CORRECT' : '✗ NOT #1'}`);

    if (expectedRank !== 1 && expectedRank > 0) {
      const winner = scores[0];
      const expected = scores[expectedRank - 1];
      console.log(`\nWHY ${winner.driver.name} RANKED HIGHER:`);
      console.log(`  - Ownership: ${(winner.ownershipScore * 100).toFixed(1)}% vs ${(expected.ownershipScore * 100).toFixed(1)}%`);
      console.log(`  - Availability: ${(winner.availScore * 100).toFixed(1)}% vs ${(expected.availScore * 100).toFixed(1)}%`);
    }

    console.log('\n');
  }

  process.exit(0);
}

main().catch(console.error);
