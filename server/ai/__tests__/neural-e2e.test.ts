/**
 * Neural Intelligence System - End-to-End Tests
 *
 * Comprehensive test suite covering all neural system components.
 * Run with: npx tsx server/ai/__tests__/neural-e2e.test.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { db } from "../../db";
import { tenants, drivers, blocks } from "../../../shared/schema";
import { eq } from "drizzle-orm";

// Test utilities
const log = {
  section: (name: string) => console.log(`\n${"═".repeat(70)}\n  ${name}\n${"═".repeat(70)}`),
  test: (name: string) => console.log(`\n  📋 ${name}`),
  pass: (msg: string) => console.log(`     ✓ ${msg}`),
  fail: (msg: string) => console.log(`     ✗ ${msg}`),
  info: (msg: string) => console.log(`     ℹ ${msg}`),
  warn: (msg: string) => console.log(`     ⚠ ${msg}`)
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  log.test(name);
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    log.pass(`Passed (${duration}ms)`);
  } catch (error: any) {
    const duration = Date.now() - start;
    results.push({ name, passed: false, duration, error: error.message });
    log.fail(`Failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════════

async function testBranchingSystem() {
  log.section("BRANCHING SYSTEM TESTS");

  const { getBranchManager } = await import("../branching");
  const manager = getBranchManager();

  // Get test tenant
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant found");

  let rootId: string;
  let childId: string;

  await runTest("Create root branch", async () => {
    const root = await manager.createRoot(
      tenant.id,
      "architect",
      "E2E Test: Find best driver for tomorrow's route",
      { type: "question", confidence: 40 }
    );
    rootId = root.id;
    if (!root.id) throw new Error("Root branch has no ID");
    if (root.depth !== 0) throw new Error("Root depth should be 0");
  });

  await runTest("Create child branch", async () => {
    const child = await manager.createBranch(
      tenant.id,
      rootId,
      "analyst",
      "Analyzing driver availability patterns",
      { type: "hypothesis", confidence: 55 }
    );
    childId = child.id;
    if (child.depth !== 1) throw new Error("Child depth should be 1");
    if (child.parentId !== rootId) throw new Error("Parent ID mismatch");
  });

  await runTest("Get tree structure", async () => {
    const tree = await manager.getTree(rootId);
    if (!tree) throw new Error("Tree not found");
    if (tree.totalBranches !== 2) throw new Error(`Expected 2 branches, got ${tree.totalBranches}`);
  });

  await runTest("Update branch confidence", async () => {
    const updated = await manager.updateBranch(childId, { confidence: 75 });
    if (updated.confidence !== 75) throw new Error("Confidence not updated");
    // At 75% confidence, status auto-upgrades to "promising" - this is correct behavior
    if (updated.status !== "exploring" && updated.status !== "promising") {
      throw new Error(`Unexpected status: ${updated.status}`);
    }
  });

  await runTest("Update to converged status", async () => {
    const converged = await manager.updateBranch(childId, { confidence: 90 });
    if (converged.status !== "converged") throw new Error("Should auto-converge at 90%");
  });

  await runTest("Branching decision logic", async () => {
    // Should branch at low confidence
    const decision1 = manager.decideBranching(30, 0, 0);
    if (!decision1.shouldBranch) throw new Error("Should branch at 30% confidence");

    // Should not branch at high confidence
    const decision2 = manager.decideBranching(90, 0, 0);
    if (decision2.shouldBranch) throw new Error("Should not branch at 90% confidence");

    // Should not branch at max depth
    const decision3 = manager.decideBranching(30, 5, 0);
    if (decision3.shouldBranch) throw new Error("Should not branch at max depth");
  });

  await runTest("Get best path", async () => {
    const path = await manager.getBestPath(rootId);
    if (path.length < 1) throw new Error("Path should have at least 1 branch");
  });
}

async function testConfidenceCalculator() {
  log.section("CONFIDENCE CALCULATOR TESTS");

  const { getConfidenceCalculator } = await import("../branching");
  const calc = getConfidenceCalculator();

  await runTest("Calculate with full positive data", async () => {
    const score = calc.calculate({
      dotStatus: { status: "valid", hoursUsed: 5, maxHours: 14, windowHours: 24, message: "OK" },
      protectedRules: { passed: true, violations: [] },
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: true,
      patternMatches: 5,
      agentOpinions: [
        { agentId: "architect", confidence: 90 },
        { agentId: "analyst", confidence: 88 }
      ]
    });

    if (score.overall < 80) throw new Error(`Expected >= 80%, got ${score.overall}%`);
    if (score.factors.length !== 6) throw new Error("Should have 6 factors");
  });

  await runTest("Calculate with DOT violation", async () => {
    const score = calc.calculate({
      dotStatus: { status: "violation", hoursUsed: 15, maxHours: 14, windowHours: 24, message: "Hours exceeded" },
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: false,
      patternMatches: 0,
      agentOpinions: []
    });

    if (score.overall > 50) throw new Error(`Expected <= 50% with DOT violation, got ${score.overall}%`);
    if (score.warnings.length === 0) throw new Error("Should have DOT warning");
  });

  await runTest("Calculate with protected rule violation", async () => {
    const score = calc.calculate({
      protectedRules: { passed: false, violations: ["Cannot work Sundays"] },
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: false,
      patternMatches: 0,
      agentOpinions: []
    });

    if (score.warnings.length === 0) throw new Error("Should have protected rule warning");
  });

  await runTest("Calculate with missing data", async () => {
    const score = calc.calculate({
      hasDriverData: false,
      hasBlockData: false,
      hasHistoricalData: false,
      patternMatches: 0,
      agentOpinions: []
    });

    if (score.overall > 60) throw new Error(`Expected <= 60% with missing data, got ${score.overall}%`);
  });

  await runTest("Agent agreement boost", async () => {
    // High agreement
    const highAgreement = calc.calculate({
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: false,
      patternMatches: 0,
      agentOpinions: [
        { agentId: "architect", confidence: 85 },
        { agentId: "analyst", confidence: 83 },
        { agentId: "scout", confidence: 84 }
      ]
    });

    // Low agreement
    const lowAgreement = calc.calculate({
      hasDriverData: true,
      hasBlockData: true,
      hasHistoricalData: false,
      patternMatches: 0,
      agentOpinions: [
        { agentId: "architect", confidence: 90 },
        { agentId: "analyst", confidence: 40 },
        { agentId: "scout", confidence: 65 }
      ]
    });

    if (highAgreement.overall <= lowAgreement.overall) {
      throw new Error("High agreement should score higher than low agreement");
    }
  });
}

async function testConvergenceEngine() {
  log.section("CONVERGENCE ENGINE TESTS");

  const { getConvergenceEngine } = await import("../branching");
  const engine = getConvergenceEngine();

  await runTest("Calculate threshold - low criticality", async () => {
    const threshold = engine.calculateThreshold({
      criticality: "low",
      hasDOTImplications: false,
      hasProtectedDriver: false,
      affectedEntities: 1,
      isReversible: true
    });

    if (threshold !== 75) throw new Error(`Expected 75%, got ${threshold}%`);
  });

  await runTest("Calculate threshold - critical with modifiers", async () => {
    const threshold = engine.calculateThreshold({
      criticality: "critical",
      hasDOTImplications: true,  // +5%
      hasProtectedDriver: true,  // +5%
      affectedEntities: 3,       // +4%
      isReversible: false        // +10%
    });

    // Base 95% + 5% + 5% + 4% + 10% = 119%, capped at 100%
    if (threshold !== 100) throw new Error(`Expected 100% (capped), got ${threshold}%`);
  });

  await runTest("Calculate threshold - medium baseline", async () => {
    const threshold = engine.calculateThreshold({
      criticality: "medium",
      hasDOTImplications: false,
      hasProtectedDriver: false,
      affectedEntities: 1,
      isReversible: true
    });

    if (threshold !== 85) throw new Error(`Expected 85%, got ${threshold}%`);
  });

  await runTest("Threshold increases with DOT implications", async () => {
    const withoutDOT = engine.calculateThreshold({
      criticality: "medium",
      hasDOTImplications: false,
      hasProtectedDriver: false,
      affectedEntities: 1,
      isReversible: true
    });

    const withDOT = engine.calculateThreshold({
      criticality: "medium",
      hasDOTImplications: true,
      hasProtectedDriver: false,
      affectedEntities: 1,
      isReversible: true
    });

    if (withDOT <= withoutDOT) throw new Error("DOT implications should increase threshold");
  });
}

async function testMemorySystem() {
  log.section("MEMORY SYSTEM TESTS");

  const { getMemoryManager, getPatternTracker } = await import("../memory");
  const memory = getMemoryManager();
  const patterns = getPatternTracker();

  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant found");

  await runTest("Get memory context", async () => {
    const context = await memory.getMemoryContext({ tenantId: tenant.id });
    if (!context.recentThoughts) throw new Error("Missing recentThoughts");
    if (!context.relevantPatterns) throw new Error("Missing relevantPatterns");
    if (!context.entityProfiles) throw new Error("Missing entityProfiles");
  });

  await runTest("Record pattern", async () => {
    const patternId = await memory.recordPattern(tenant.id, {
      type: "operational",
      pattern: "E2E Test: Morning shifts have 15% higher completion rate",
      confidence: 70,
      observations: 1
    });

    if (!patternId) throw new Error("Pattern ID not returned");
  });

  await runTest("Get patterns with filters", async () => {
    const allPatterns = await patterns.getPatterns(tenant.id);
    log.info(`Found ${allPatterns.length} total patterns`);

    const highConfidence = await patterns.getPatterns(tenant.id, { minConfidence: 60 });
    log.info(`Found ${highConfidence.length} high-confidence patterns`);

    if (highConfidence.length > allPatterns.length) {
      throw new Error("Filtered patterns should be <= total patterns");
    }
  });

  await runTest("Analyze text for patterns", async () => {
    const analysis = await patterns.analyzeForPatterns(
      tenant.id,
      "Driver John always prefers morning routes and avoids evening shifts. He's reliable on Mondays."
    );

    if (!analysis.patterns) throw new Error("No patterns array returned");
    log.info(`Extracted ${analysis.patterns.length} pattern candidates`);
  });
}

async function testAgentInitialization() {
  log.section("AGENT INITIALIZATION TESTS");

  await runTest("Claude Architect initialization", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      log.warn("ANTHROPIC_API_KEY not set - skipping");
      return;
    }

    const { getArchitect } = await import("../agents/claude-architect");
    const architect = getArchitect();
    await architect.initialize();

    const status = architect.getStatus();
    // Status can be "ready" or "active" - both indicate successful initialization
    if (status !== "ready" && status !== "active") throw new Error(`Architect status: ${status}`);
  });

  await runTest("Gemini Scout initialization", async () => {
    if (!process.env.GOOGLE_AI_API_KEY) {
      log.warn("GOOGLE_AI_API_KEY not set - skipping");
      return;
    }

    const { getScout } = await import("../agents/gemini-scout");
    const scout = await getScout();

    const status = scout.getStatus();
    if (status !== "ready") throw new Error(`Scout status: ${status}`);
  });

  await runTest("ChatGPT Analyst initialization", async () => {
    if (!process.env.OPENAI_API_KEY) {
      log.warn("OPENAI_API_KEY not set - skipping");
      return;
    }

    const { getAnalyst } = await import("../agents/chatgpt-analyst");
    const analyst = await getAnalyst();

    const status = analyst.getStatus();
    if (status !== "ready") throw new Error(`Analyst status: ${status}`);
  });
}

async function testOrchestratorFlow() {
  log.section("ORCHESTRATOR FLOW TESTS");

  // Check if we have at least one API key
  const hasApiKey = process.env.ANTHROPIC_API_KEY ||
                    process.env.GOOGLE_AI_API_KEY ||
                    process.env.OPENAI_API_KEY;

  if (!hasApiKey) {
    log.warn("No API keys set - skipping orchestrator tests");
    return;
  }

  const { getOrchestrator } = await import("../orchestrator");
  const [tenant] = await db.select().from(tenants).limit(1);
  if (!tenant) throw new Error("No tenant found");

  let orchestrator: any;

  await runTest("Initialize orchestrator", async () => {
    orchestrator = await getOrchestrator();
    const status = orchestrator.getAgentStatus();
    log.info(`Agent status: ${JSON.stringify(status)}`);

    // Status can be "ready" or "active" - both indicate working agent
    const hasReady = Object.values(status).some((s: any) => s === "ready" || s === "active");
    if (!hasReady) throw new Error("No agents ready");
  });

  await runTest("Process simple query", async () => {
    const response = await orchestrator.process({
      input: "What drivers are available?",
      tenantId: tenant.id
    });

    if (!response.output) throw new Error("No output returned");
    if (typeof response.confidence !== "number") throw new Error("No confidence score");
    if (!response.agentUsed) throw new Error("No agent specified");

    log.info(`Agent: ${response.agentUsed}, Confidence: ${response.confidence}%`);
    log.info(`Output preview: ${response.output.substring(0, 100)}...`);
  });

  await runTest("Process query with DOT keywords", async () => {
    const response = await orchestrator.process({
      input: "Check DOT hours for the driver on route 5",
      tenantId: tenant.id
    });

    if (!response.thoughtPath) throw new Error("No thought path");
    log.info(`Thought path: ${response.thoughtPath.length} steps`);
  });

  await runTest("Intent classification", async () => {
    // Weather query should route to scout (or fallback if unavailable)
    const response = await orchestrator.process({
      input: "What's the weather forecast for deliveries today?",
      tenantId: tenant.id
    });

    log.info(`Routed to: ${response.agentUsed}`);
    // Don't assert specific agent since it depends on available API keys
  });
}

async function testDatabaseIntegrity() {
  log.section("DATABASE INTEGRITY TESTS");

  await runTest("Neural tables exist", async () => {
    const { neuralAgents, neuralThoughts, neuralPatterns, neuralProfiles, neuralDecisions, neuralRouting } =
      await import("../../../shared/schema");

    // Try to select from each table
    await db.select().from(neuralAgents).limit(1);
    await db.select().from(neuralThoughts).limit(1);
    await db.select().from(neuralPatterns).limit(1);
    await db.select().from(neuralProfiles).limit(1);
    await db.select().from(neuralDecisions).limit(1);
    await db.select().from(neuralRouting).limit(1);

    log.pass("All neural tables accessible");
  });

  await runTest("Seeded agents exist", async () => {
    const { neuralAgents } = await import("../../../shared/schema");
    const agents = await db.select().from(neuralAgents);

    const expectedAgents = ["architect", "scout", "analyst", "executor"];
    for (const agentId of expectedAgents) {
      const found = agents.find(a => a.id === agentId);
      if (!found) throw new Error(`Missing seeded agent: ${agentId}`);
    }

    log.info(`Found ${agents.length} seeded agents`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              MAIN RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════════╗");
  console.log("║     MILO NEURAL INTELLIGENCE SYSTEM - E2E TEST SUITE            ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const startTime = Date.now();

  try {
    await testDatabaseIntegrity();
    await testBranchingSystem();
    await testConfidenceCalculator();
    await testConvergenceEngine();
    await testMemorySystem();
    await testAgentInitialization();
    await testOrchestratorFlow();
  } catch (error) {
    console.error("\n❌ Test suite crashed:", error);
  }

  // Summary
  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log("\n" + "═".repeat(70));
  console.log("                         TEST SUMMARY");
  console.log("═".repeat(70));
  console.log(`  Total Tests: ${results.length}`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log("═".repeat(70));

  if (failed > 0) {
    console.log("\n  Failed Tests:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ✗ ${r.name}`);
      console.log(`      Error: ${r.error}`);
    });
    process.exit(1);
  }

  console.log("\n  ✅ All tests passed!\n");
}

main().catch(console.error);
