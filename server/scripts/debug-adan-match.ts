import { db } from "../db";
import { sql } from "drizzle-orm";

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

// Canonical start times
const CANONICAL_TIMES: Record<string, string> = {
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

async function debugAdan() {
  // Find Adan
  const driverResult = await db.execute(sql`
    SELECT id, first_name, last_name
    FROM drivers
    WHERE tenant_id = ${TENANT_ID}
    AND first_name ILIKE '%adan%'
  `);

  const adan = driverResult.rows[0] as any;
  console.log('=== ADAN ===');
  console.log('ID:', adan.id);
  console.log('Name:', adan.first_name, adan.last_name);

  // Get his DNA profile
  const dnaResult = await db.execute(sql`
    SELECT * FROM driver_dna_profiles WHERE driver_id = ${adan.id}
  `);

  let dna: any = null;
  if (dnaResult.rows.length > 0) {
    dna = dnaResult.rows[0] as any;
    console.log('');
    console.log('=== DNA PROFILE ===');
    console.log('Preferred Days:', dna.preferred_days);
    console.log('Preferred Times:', dna.preferred_start_times);
    console.log('Preferred Contract:', dna.preferred_contract_type);
  }

  // Get current week blocks
  const blocksResult = await db.execute(sql`
    SELECT
      block_id,
      service_date,
      solo_type,
      tractor_id,
      EXTRACT(DOW FROM service_date) as day_of_week
    FROM blocks
    WHERE tenant_id = ${TENANT_ID}
    AND service_date >= '2025-11-30'
    AND service_date <= '2025-12-06'
    ORDER BY service_date, tractor_id
  `);

  console.log('');
  console.log('=== ALL BLOCKS THIS WEEK ===');
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  let matchCount = 0;
  let solo2Count = 0;

  for (const row of blocksResult.rows) {
    const b = row as any;
    const dayName = dayNames[parseInt(b.day_of_week)];
    const contractType = b.solo_type?.toLowerCase() || '';

    // Get canonical time
    const lookupKey = `${contractType}_${b.tractor_id}`;
    const canonicalTime = CANONICAL_TIMES[lookupKey] || 'N/A';

    // Check if this matches Adan's DNA
    let matches = false;
    let reason = '';

    if (dna && contractType === 'solo2') {
      solo2Count++;
      const dayMatch = dna.preferred_days?.includes(dayName);
      const preferredTimes = dna.preferred_start_times || [];

      // Check time match (within 2 hours)
      let timeMatch = false;
      let bestDiff = Infinity;
      const blockMinutes = timeToMinutes(canonicalTime);

      for (const prefTime of preferredTimes) {
        const prefMinutes = timeToMinutes(prefTime);
        const diff = Math.abs(blockMinutes - prefMinutes);
        const wrapDiff = Math.min(diff, 1440 - diff);
        bestDiff = Math.min(bestDiff, wrapDiff);
        if (wrapDiff <= 120) timeMatch = true;
      }

      if (dayMatch && timeMatch) {
        matches = true;
        matchCount++;
        reason = `✓ MATCH (day=${dayName}, time=${canonicalTime}, diff=${bestDiff}min)`;
      } else if (!dayMatch) {
        reason = `✗ Day mismatch (${dayName} not in ${dna.preferred_days?.join(',')})`;
      } else if (!timeMatch) {
        reason = `✗ Time mismatch (${canonicalTime} not within 2hr of ${preferredTimes.join(',')}, diff=${bestDiff}min)`;
      }
    } else if (contractType !== 'solo2') {
      reason = `- Solo1 block (Adan is Solo2)`;
    }

    const dateStr = typeof b.service_date === 'string' ? b.service_date.split('T')[0] : b.service_date;
    console.log(`${dateStr} (${dayName.slice(0,3)}) ${b.block_id} ${contractType} ${b.tractor_id} @ ${canonicalTime} ${reason}`);
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total blocks: ${blocksResult.rows.length}`);
  console.log(`Solo2 blocks: ${solo2Count}`);
  console.log(`Matches for Adan: ${matchCount}`);

  process.exit(0);
}

debugAdan().catch(e => { console.error(e); process.exit(1); });
