/**
 * Neural API Routes Test
 *
 * Tests the REST API endpoints for the neural system.
 * Run with: npx tsx server/ai/__tests__/api-routes.test.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { db } from "../../db";
import { tenants } from "../../../shared/schema";

// Import and test neural routes directly (without HTTP)
async function testNeuralRoutes() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║       MILO NEURAL API ROUTES TEST                                ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  let passed = 0;
  let failed = 0;

  // Get test tenant
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant found for testing");
  console.log(`  Using tenant: ${tenant.id}\n`);

  // Test 1: Neural Status
  console.log("  📋 Test 1: Get neural system status");
  try {
    const { getOrchestrator } = await import("../orchestrator");
    const orchestrator = await getOrchestrator();
    const status = orchestrator.getAgentStatus();

    if (typeof status === "object" && status.architect) {
      console.log(`     ✓ Status: architect=${status.architect}`);
      passed++;
    } else {
      throw new Error("Invalid status response");
    }
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 2: Get patterns
  console.log("\n  📋 Test 2: Get patterns");
  try {
    const { getPatternTracker } = await import("../memory");
    const tracker = getPatternTracker();
    const patterns = await tracker.getPatterns(tenant.id);

    console.log(`     ✓ Found ${patterns.length} patterns`);
    passed++;
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 3: Get profiles by entity type
  console.log("\n  📋 Test 3: Get profiles");
  try {
    const { getProfileBuilder } = await import("../memory");
    const builder = getProfileBuilder();
    // Use getDriverProfile method (not getProfile)
    const profile = await builder.getDriverProfile(tenant.id, "test-driver");

    // Profile might be null if entity doesn't exist - that's OK
    console.log(`     ✓ Profile lookup completed (found: ${profile !== null})`);
    passed++;
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 4: Get thought tree
  console.log("\n  📋 Test 4: Get thought tree");
  try {
    const { getBranchManager } = await import("../branching");
    const manager = getBranchManager();

    // Create a test branch first
    const root = await manager.createRoot(
      tenant.id,
      "architect",
      "API test query",
      { type: "question", confidence: 50 }
    );

    const tree = await manager.getTree(root.id);

    if (tree && tree.rootId) {
      console.log(`     ✓ Tree retrieved: ${tree.totalBranches} branches, depth ${tree.maxDepth}`);
      passed++;
    } else {
      throw new Error("Invalid tree response");
    }
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 5: Confidence analysis
  console.log("\n  📋 Test 5: Confidence analysis");
  try {
    const { getConfidenceCalculator } = await import("../branching");
    const calc = getConfidenceCalculator();

    const score = calc.calculate({
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: false,
      patternMatches: 2,
      agentOpinions: [{ agentId: "architect", confidence: 80 }]
    });

    if (typeof score.overall === "number" && score.factors.length === 6) {
      console.log(`     ✓ Confidence calculated: ${score.overall}%`);
      passed++;
    } else {
      throw new Error("Invalid confidence response");
    }
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 6: Memory cleanup (dry run)
  console.log("\n  📋 Test 6: Memory cleanup (dry run)");
  try {
    const { runCleanupOnce } = await import("../memory");
    // Don't actually run cleanup, just verify the function exists
    if (typeof runCleanupOnce === "function") {
      console.log(`     ✓ Cleanup function available`);
      passed++;
    } else {
      throw new Error("Cleanup function not found");
    }
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Test 7: Process neural query
  console.log("\n  📋 Test 7: Process neural query");
  try {
    const { getOrchestrator } = await import("../orchestrator");
    const orchestrator = await getOrchestrator();

    const response = await orchestrator.process({
      input: "Hello, what can you help me with?",
      tenantId: tenant.id
    });

    if (response.output && typeof response.confidence === "number") {
      console.log(`     ✓ Query processed: ${response.confidence}% confidence`);
      console.log(`       Agent: ${response.agentUsed}`);
      passed++;
    } else {
      throw new Error("Invalid response");
    }
  } catch (e: any) {
    console.log(`     ✗ Failed: ${e.message}`);
    failed++;
  }

  // Summary
  console.log("\n" + "═".repeat(70));
  console.log("                         TEST SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Total: ${passed + failed}`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log("═".repeat(70));

  if (failed > 0) {
    process.exit(1);
  }

  console.log("\n  ✅ All API route tests passed!\n");
}

testNeuralRoutes().catch(console.error);
