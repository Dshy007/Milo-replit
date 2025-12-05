/**
 * Fix blocks with NULL canonicalStart by calculating it from soloType + tractorId
 */
import { db } from "../db";
import { blocks } from "@shared/schema";
import { eq, isNull, and } from "drizzle-orm";
import { format, parse, setHours, setMinutes } from "date-fns";

// Canonical start times lookup table
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

async function fixCanonicalStart() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                    FIX NULL CANONICAL START TIMES                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  // Find all blocks with NULL canonicalStart
  const blocksToFix = await db
    .select()
    .from(blocks)
    .where(isNull(blocks.canonicalStart));

  console.log(`Found ${blocksToFix.length} blocks with NULL canonicalStart\n`);

  let fixed = 0;
  let failed = 0;

  for (const block of blocksToFix) {
    // Build lookup key
    const key = `${block.soloType?.toLowerCase() || ''}_${block.tractorId || ''}`;
    const canonicalTimeStr = CANONICAL_START_TIMES[key];

    if (!canonicalTimeStr) {
      console.log(`  ❌ ${block.blockId}: No lookup for key "${key}"`);
      failed++;
      continue;
    }

    // Parse the canonical time (e.g., "20:30")
    const [hours, minutes] = canonicalTimeStr.split(':').map(Number);

    // Use the serviceDate as the base and set the canonical time
    const serviceDate = new Date(block.serviceDate!);
    let canonicalStart = setHours(setMinutes(serviceDate, minutes), hours);

    // Handle overnight shifts (times like 00:30, 01:30 are next day)
    if (hours < 12 && block.startTimestamp) {
      const startHour = new Date(block.startTimestamp).getUTCHours();
      // If the actual start was in the evening (12+) and canonical is morning, add a day
      if (startHour >= 12) {
        canonicalStart = new Date(canonicalStart.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    // Update the block
    await db
      .update(blocks)
      .set({ canonicalStart })
      .where(eq(blocks.id, block.id));

    fixed++;
  }

  console.log(`\n═══════════════════════════════════════════════════════════════════════`);
  console.log(`                              RESULTS                                   `);
  console.log(`═══════════════════════════════════════════════════════════════════════\n`);
  console.log(`  ✅ Fixed: ${fixed} blocks`);
  console.log(`  ❌ Failed: ${failed} blocks`);

  // Verify fix
  const remaining = await db
    .select()
    .from(blocks)
    .where(isNull(blocks.canonicalStart));

  console.log(`\n  Remaining blocks with NULL canonicalStart: ${remaining.length}`);
}

fixCanonicalStart()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
