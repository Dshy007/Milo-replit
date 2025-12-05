/**
 * Fine-tune DNA profiles for all drivers
 * Uses a lower dayThreshold to capture more working days
 */
import { analyzeDriverDNA } from "../dna-analyzer";

// The tenant ID for Freedom Transportation Inc
const TENANT_ID = "3cf00ed3-3eb9-43bf-b001-aee880b30304";

async function fineTuneDNA() {
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                    FINE-TUNING DNA PROFILES                            ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");

  console.log("Running DNA analysis with lower dayThreshold (0.25) to capture more working days...\n");

  try {
    const result = await analyzeDriverDNA({
      tenantId: TENANT_ID,
      dayThreshold: 0.25, // Lower threshold = more days detected
    });

    console.log("\n═══════════════════════════════════════════════════════════════════════");
    console.log("                           ANALYSIS COMPLETE                            ");
    console.log("═══════════════════════════════════════════════════════════════════════\n");

    console.log(`  Total Drivers Analyzed: ${result.totalDrivers}`);
    console.log(`  Profiles Created: ${result.profilesCreated}`);
    console.log(`  Profiles Updated: ${result.profilesUpdated}`);
    console.log(`  Errors: ${result.errors}`);
    console.log(`  Analysis Period: ${result.analysisStartDate.toISOString().split('T')[0]} to ${result.analysisEndDate.toISOString().split('T')[0]}\n`);

    // Show sample of updated profiles
    console.log("Sample Updated Profiles:\n");
    for (const profile of result.profiles.slice(0, 5)) {
      console.log(`  📋 ${profile.driverName}`);
      console.log(`     Days: ${profile.preferredDays.join(', ')}`);
      console.log(`     Times: ${profile.preferredStartTimes.join(', ')}`);
      console.log(`     Tractors: ${profile.preferredTractors.join(', ')}`);
      console.log(`     Consistency: ${(profile.consistencyScore * 100).toFixed(0)}%`);
      console.log();
    }

  } catch (error) {
    console.error("Error fine-tuning DNA profiles:", error);
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("                              DONE                                      ");
  console.log("═══════════════════════════════════════════════════════════════════════\n");
}

fineTuneDNA()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
