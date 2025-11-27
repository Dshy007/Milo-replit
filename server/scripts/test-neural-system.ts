/**
 * Test Neural Intelligence System
 *
 * Quick test to verify all agents can be initialized and process requests.
 */

import dotenv from "dotenv";
dotenv.config();

import { getOrchestrator } from "../ai/orchestrator";

async function testNeuralSystem() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║           NEURAL INTELLIGENCE SYSTEM TEST                         ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  try {
    // Initialize orchestrator
    console.log("1. Initializing Orchestrator...\n");
    const orchestrator = await getOrchestrator();

    // Check agent status
    console.log("2. Checking Agent Status...\n");
    const status = orchestrator.getAgentStatus();
    console.log("   Agent Status:");
    console.log(`   🧠 Architect: ${status.architect}`);
    console.log(`   👁️  Scout:     ${status.scout}`);
    console.log(`   📊 Analyst:   ${status.analyst}`);
    console.log(`   ⚡ Executor:  ${status.executor}`);
    console.log("");

    // Test a simple query with real tenant
    console.log("3. Testing Simple Query...\n");
    const testQuery = "Who is the best driver for Block 7 tomorrow?";
    const realTenantId = "23b1356e-c4fa-415b-adaf-084f6e9047a2"; // Test Trucking Co
    console.log(`   Query: "${testQuery}"`);
    console.log(`   Tenant: ${realTenantId}`);
    console.log("   Processing...\n");

    const response = await orchestrator.process({
      input: testQuery,
      tenantId: realTenantId
    });

    console.log("   Response:");
    console.log(`   Agent Used: ${response.agentUsed}`);
    console.log(`   Confidence: ${response.confidence}%`);
    console.log(`   Converged: ${response.converged}`);
    console.log(`   Thought Path: ${response.thoughtPath.join(" -> ")}`);
    console.log("\n   Output (first 500 chars):");
    console.log(`   ${response.output.substring(0, 500)}...`);
    console.log("");

    console.log("╔══════════════════════════════════════════════════════════════════╗");
    console.log("║           ✅ NEURAL SYSTEM TEST PASSED                           ║");
    console.log("╚══════════════════════════════════════════════════════════════════╝\n");

    return true;
  } catch (error) {
    console.error("❌ Test Failed:", error);
    return false;
  }
}

testNeuralSystem()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
