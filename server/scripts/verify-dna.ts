import { db } from "../db";
import { sql } from "drizzle-orm";

const CANONICAL_START_TIMES: Record<string, string> = {
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
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

async function verifyDNA() {
  // Get drivers with recent blocks
  const driversResult = await db.execute(sql`
    SELECT DISTINCT
      d.id as driver_id,
      d.first_name || ' ' || d.last_name as driver_name
    FROM drivers d
    JOIN block_assignments ba ON ba.driver_id = d.id
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    AND b.service_date >= NOW() - INTERVAL '4 weeks'
    ORDER BY driver_name
    LIMIT 10
  `);

  console.log("=== DNA VERIFICATION ===\n");

  for (const row of driversResult.rows) {
    const driver = row as any;

    // Get their block assignments
    const blocksResult = await db.execute(sql`
      SELECT b.solo_type, b.tractor_id, COUNT(*) as cnt
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
      WHERE ba.driver_id = ${driver.driver_id}
      AND ba.is_active = true
      AND b.service_date >= NOW() - INTERVAL '4 weeks'
      GROUP BY b.solo_type, b.tractor_id
      ORDER BY cnt DESC
    `);

    // Get their DNA profile
    const dnaResult = await db.execute(sql`
      SELECT preferred_start_times, preferred_contract_type
      FROM driver_dna_profiles
      WHERE driver_id = ${driver.driver_id}
    `);

    const dna = dnaResult.rows[0] as any;

    console.log(`\n${driver.driver_name}`);
    console.log("-".repeat(40));

    // Calculate expected canonical times
    const timeFrequency = new Map<string, number>();
    for (const block of blocksResult.rows) {
      const b = block as any;
      const key = `${b.solo_type}_${b.tractor_id}`;
      const canonicalTime = CANONICAL_START_TIMES[key] || "UNKNOWN";
      const count = parseInt(b.cnt);
      timeFrequency.set(canonicalTime, (timeFrequency.get(canonicalTime) || 0) + count);
      console.log(`  ${b.tractor_id} (${b.cnt}x) → ${key} → ${canonicalTime}`);
    }

    // Find most frequent
    const sorted = Array.from(timeFrequency.entries()).sort((a, b) => b[1] - a[1]);
    const expectedTime = sorted[0]?.[0] || "N/A";
    const actualTime = dna?.preferred_start_times?.[0] || "N/A";

    console.log(`  EXPECTED: ${expectedTime} | ACTUAL DNA: ${actualTime} | ${expectedTime === actualTime ? "✅ MATCH" : "❌ MISMATCH"}`);
  }

  process.exit(0);
}

verifyDNA().catch(console.error);
