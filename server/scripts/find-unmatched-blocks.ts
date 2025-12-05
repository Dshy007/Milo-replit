import { db } from "../db";
import { sql } from "drizzle-orm";

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Canonical start times lookup - from Start Times page (contracts table)
const CANONICAL_START_TIMES: Record<string, string> = {
  // Solo1 (10 tractors)
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  // Solo2 (7 tractors) - CORRECT times from database
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

async function findUnmatchedBlocks() {
  // Get all UNASSIGNED blocks in the week range (no active assignment in block_assignments)
  const blocksResult = await db.execute(sql`
    SELECT
      b.block_id,
      b.service_date,
      b.start_timestamp,
      b.solo_type as contract_type,
      b.tractor_id
    FROM blocks b
    LEFT JOIN block_assignments ba ON ba.block_id = b.id AND ba.is_active = true
    WHERE b.tenant_id = ${TENANT_ID}
    AND b.service_date >= '2025-11-30'
    AND b.service_date <= '2025-12-06'
    AND ba.id IS NULL
    ORDER BY b.service_date, b.start_timestamp
  `);

  // Get all DNA profiles
  const dnaResult = await db.execute(sql`
    SELECT
      d.first_name,
      d.last_name,
      dp.driver_id,
      dp.preferred_days,
      dp.preferred_start_times,
      dp.preferred_contract_type
    FROM driver_dna_profiles dp
    JOIN drivers d ON d.id = dp.driver_id
    WHERE dp.tenant_id = ${TENANT_ID}
  `);

  const profiles = (dnaResult.rows as any[]).map(p => ({
    driverId: p.driver_id,
    name: `${p.first_name} ${p.last_name}`,
    preferredDays: p.preferred_days || [],
    preferredStartTimes: p.preferred_start_times || [],
    preferredContractType: p.preferred_contract_type,
  }));

  console.log(`\nAnalyzing ${blocksResult.rows.length} blocks against ${profiles.length} drivers\n`);

  const unmatchedBlocks: any[] = [];
  const matchedBlocks: any[] = [];

  for (const row of blocksResult.rows) {
    const block = row as any;
    const serviceDate = block.service_date instanceof Date
      ? block.service_date
      : new Date(block.service_date);
    const dayOfWeek = DAY_NAMES[serviceDate.getDay()];

    // Use CANONICAL start time based on soloType + tractorId (holy grail approach)
    const lookupKey = `${block.contract_type?.toLowerCase() || 'solo1'}_${block.tractor_id || ''}`;
    const canonicalTime = CANONICAL_START_TIMES[lookupKey];

    // Fall back to LOCAL time if no canonical lookup found
    let fallbackTime = '00:00';
    if (block.start_timestamp) {
      const ts = block.start_timestamp instanceof Date ? block.start_timestamp : new Date(block.start_timestamp);
      fallbackTime = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
    }

    const startTime = canonicalTime || fallbackTime;

    const blockTimeMinutes = timeToMinutes(startTime);
    const blockContract = block.contract_type?.toLowerCase();

    let matchCount = 0;
    const reasons: string[] = [];

    for (const profile of profiles) {
      // Check contract
      const driverContract = profile.preferredContractType?.toLowerCase();
      if (driverContract && blockContract && driverContract !== blockContract) {
        continue; // Contract mismatch
      }

      // Check day
      const dayMatches = profile.preferredDays.some(
        (d: string) => d.toLowerCase() === dayOfWeek
      );
      if (!dayMatches) {
        continue; // Day mismatch
      }

      // Check time (within 2 hours)
      let bestTimeDiff = Infinity;
      for (const prefTime of profile.preferredStartTimes) {
        const prefMinutes = timeToMinutes(prefTime);
        const diff = Math.abs(blockTimeMinutes - prefMinutes);
        const wrapDiff = Math.min(diff, 1440 - diff);
        bestTimeDiff = Math.min(bestTimeDiff, wrapDiff);
      }

      if (bestTimeDiff <= 120) {
        matchCount++;
      }
    }

    if (matchCount === 0) {
      unmatchedBlocks.push({
        blockId: block.block_id,
        date: serviceDate.toISOString().split('T')[0],
        day: dayOfWeek,
        time: startTime,
        contract: blockContract,
        tractor: block.tractor_id,
      });
    } else {
      matchedBlocks.push({
        blockId: block.block_id,
        matchCount,
      });
    }
  }

  console.log(`\n=== UNMATCHED BLOCKS (${unmatchedBlocks.length}) ===\n`);

  for (const block of unmatchedBlocks) {
    console.log(`${block.blockId}: ${block.date} (${block.day}) @ ${block.time} [${block.contract}] - ${block.tractor}`);

    // Find WHY no matches
    const dayDrivers = profiles.filter(p =>
      p.preferredDays.some((d: string) => d.toLowerCase() === block.day)
    );
    console.log(`  → ${dayDrivers.length} drivers work on ${block.day}`);

    const contractDrivers = dayDrivers.filter(p =>
      !p.preferredContractType ||
      p.preferredContractType.toLowerCase() === block.contract
    );
    console.log(`  → ${contractDrivers.length} of those are ${block.contract} drivers`);

    // Show their times
    if (contractDrivers.length > 0) {
      const blockMinutes = timeToMinutes(block.time);
      for (const driver of contractDrivers) {
        const times = driver.preferredStartTimes;
        const diffs = times.map((t: string) => {
          const tMin = timeToMinutes(t);
          return Math.abs(blockMinutes - tMin);
        });
        const minDiff = Math.min(...diffs);
        console.log(`    - ${driver.name}: prefers ${times.join(', ')} (closest: ${minDiff}min away)`);
      }
    }
    console.log('');
  }

  // Analyze patterns in unmatched blocks
  if (unmatchedBlocks.length > 0) {
    console.log('\n=== UNMATCHED BLOCK PATTERNS ===');

    const byDay: Record<string, number> = {};
    const byTime: Record<string, number> = {};
    const byContract: Record<string, number> = {};

    for (const b of unmatchedBlocks) {
      byDay[b.day] = (byDay[b.day] || 0) + 1;
      byTime[b.time] = (byTime[b.time] || 0) + 1;
      byContract[b.contract] = (byContract[b.contract] || 0) + 1;
    }

    console.log('By Day:', byDay);
    console.log('By Time:', byTime);
    console.log('By Contract:', byContract);
  }

  process.exit(0);
}

findUnmatchedBlocks().catch(console.error);
