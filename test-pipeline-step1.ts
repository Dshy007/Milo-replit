/**
 * Test Pipeline Step 1: XGBoost Ownership + Availability Scores
 * Tests the scheduling settings sliders
 */

import { runSchedulePipeline, PipelineInput, SchedulingSettings } from "./server/schedule-pipeline";

async function testWithSettings(settings: SchedulingSettings, label: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${label}`);
  console.log(`${"=".repeat(60)}`);

  // Create test history with varying dates to test memory filter
  // Recent dates will be kept, older dates filtered out based on memoryLength
  const today = new Date();
  const oneWeekAgo = new Date(today); oneWeekAgo.setDate(today.getDate() - 7);
  const twoWeeksAgo = new Date(today); twoWeeksAgo.setDate(today.getDate() - 14);
  const fourWeeksAgo = new Date(today); fourWeeksAgo.setDate(today.getDate() - 28);
  const eightWeeksAgo = new Date(today); eightWeeksAgo.setDate(today.getDate() - 56);

  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  const input: PipelineInput = {
    tenantId: "test",
    blocks: [
      {
        id: "block-1",
        soloType: "solo1",
        tractorId: "Tractor_1",
        canonicalTime: "16:30",
        dayOfWeek: "saturday",
        serviceDate: "2024-12-14",
      },
      {
        id: "block-2",
        soloType: "solo1",
        tractorId: "Tractor_2",
        canonicalTime: "20:30",
        dayOfWeek: "saturday",
        serviceDate: "2024-12-14",
      },
    ],
    availableDriverIds: ["driver-1", "driver-2", "driver-3"],
    driverHistories: {
      "driver-1": [
        { day: "saturday", time: "16:30", serviceDate: formatDate(oneWeekAgo), soloType: "solo1" },
        { day: "saturday", time: "16:30", serviceDate: formatDate(twoWeeksAgo), soloType: "solo1" },
        { day: "saturday", time: "16:30", serviceDate: formatDate(fourWeeksAgo), soloType: "solo1" },
        { day: "saturday", time: "16:30", serviceDate: formatDate(eightWeeksAgo), soloType: "solo1" },
      ],
      "driver-2": [
        { day: "saturday", time: "20:30", serviceDate: formatDate(oneWeekAgo), soloType: "solo1" },
        { day: "saturday", time: "20:30", serviceDate: formatDate(fourWeeksAgo), soloType: "solo1" },
      ],
      "driver-3": [],
    },
    assignedSlots: new Map(),
    settings,
  };

  try {
    const result = await runSchedulePipeline(input);
    console.log(`\nResult: ${result.stats.assigned} assigned, ${result.unassigned.length} unassigned`);
  } catch (error) {
    console.error("Pipeline error:", error);
  }
}

async function main() {
  // Test 1: AUTO mode (balanced)
  await testWithSettings(
    { predictability: 0.6, timeFlexibility: 2, memoryLength: 7 },
    "AUTO mode (60% predictability, ±2hr, 7 weeks)"
  );

  // Test 2: STABLE mode (follow patterns strictly)
  await testWithSettings(
    { predictability: 1.0, timeFlexibility: 1, memoryLength: 12 },
    "STABLE mode (100% predictability, ±1hr, 12 weeks)"
  );

  // Test 3: FLEX mode (flexible assignments)
  await testWithSettings(
    { predictability: 0.2, timeFlexibility: 4, memoryLength: 3 },
    "FLEX mode (20% predictability, ±4hr, 3 weeks)"
  );
}

main();
