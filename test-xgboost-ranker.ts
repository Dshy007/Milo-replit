/**
 * Test XGBoost Ranker (Stage 2) with REAL database data
 *
 * This script:
 * 1. Fetches historical block assignments from the database
 * 2. Fetches driver histories and driver info
 * 3. Trains the XGBRanker model
 * 4. Tests ranking drivers for a sample block
 *
 * Usage: npx tsx test-xgboost-ranker.ts
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format } from "date-fns";
import { spawn } from "child_process";

// Store driver names for display
const driverNames: Record<string, string> = {};

// Configurable lookback
const LOOKBACK_DAYS = 56; // 8 weeks for training

interface BlockAssignment {
  blockId: string;
  driverId: string;
  serviceDate: string;
  contractType: string;
  startTime: string;
}

interface Driver {
  id: string;
  name: string;
  contractType: string;
}

interface DriverHistory {
  serviceDate: string;
  time?: string;
}

async function fetchHistoricalBlocks(): Promise<BlockAssignment[]> {
  const today = new Date();
  const lookbackStart = subDays(today, LOOKBACK_DAYS);
  const yesterday = subDays(today, 1);

  console.log(`Fetching blocks: ${format(lookbackStart, "yyyy-MM-dd")} to ${format(yesterday, "yyyy-MM-dd")}`);

  const result = await db.execute(sql`
    SELECT
      b.id as block_id,
      ba.driver_id,
      b.service_date::date as service_date,
      b.solo_type as contract_type,
      b.start_timestamp::time as start_time
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND b.service_date >= ${format(lookbackStart, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
    ORDER BY b.service_date
  `);

  const blocks: BlockAssignment[] = result.rows.map(row => ({
    blockId: String(row.block_id),
    driverId: String(row.driver_id),
    serviceDate: String(row.service_date).split("T")[0],
    contractType: String(row.contract_type || "").toLowerCase(),
    startTime: String(row.start_time || ""),
  }));

  console.log(`Found ${blocks.length} historical block assignments`);
  return blocks;
}

async function fetchAllDrivers(): Promise<Driver[]> {
  // Get driver contract type from their most common block assignment type
  const result = await db.execute(sql`
    SELECT
      d.id,
      d.first_name || ' ' || d.last_name as name,
      b.solo_type as contract_type,
      COUNT(*) as cnt
    FROM drivers d
    JOIN block_assignments ba ON ba.driver_id = d.id
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.is_active = true
    GROUP BY d.id, d.first_name, d.last_name, b.solo_type
    ORDER BY d.id, cnt DESC
  `);

  // Group by driver, take most common contract type
  const driverMap: Record<string, Driver> = {};
  for (const row of result.rows) {
    const id = String(row.id);
    const name = String(row.name);
    driverNames[id] = name;

    // Only keep first (most common) contract type per driver
    if (!driverMap[id]) {
      driverMap[id] = {
        id,
        name,
        contractType: String(row.contract_type || "").toLowerCase(),
      };
    }
  }

  const drivers = Object.values(driverMap);
  console.log(`Found ${drivers.length} drivers with assignments`);
  return drivers;
}

async function fetchDriverHistories(): Promise<Record<string, DriverHistory[]>> {
  const today = new Date();
  const lookbackStart = subDays(today, LOOKBACK_DAYS);
  const yesterday = subDays(today, 1);

  const result = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      b.start_timestamp::time as start_time
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND b.service_date >= ${format(lookbackStart, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
    ORDER BY b.service_date
  `);

  const byDriver: Record<string, DriverHistory[]> = {};

  for (const row of result.rows) {
    const driverId = String(row.driver_id);
    if (!byDriver[driverId]) {
      byDriver[driverId] = [];
    }
    byDriver[driverId].push({
      serviceDate: String(row.service_date).split("T")[0],
      time: String(row.start_time || ""),
    });
    if (row.driver_name) {
      driverNames[driverId] = String(row.driver_name);
    }
  }

  console.log(`Found histories for ${Object.keys(byDriver).length} drivers`);
  return byDriver;
}

async function trainRanker(
  blocks: BlockAssignment[],
  histories: Record<string, DriverHistory[]>,
  drivers: Driver[]
): Promise<any> {
  const input = {
    action: "train",
    blocks: blocks.map(b => ({
      blockId: b.blockId,
      driverId: b.driverId,
      serviceDate: b.serviceDate,
      contractType: b.contractType,
      startTime: b.startTime,
    })),
    histories: histories,
    drivers: drivers.map(d => ({
      id: d.id,
      contractType: d.contractType,
    })),
  };

  console.log(`\nSending ${blocks.length} blocks to Python ranker for training...`);

  return new Promise((resolve, reject) => {
    const pythonPath = "C:\\Users\\shire\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    const scriptPath = "python/xgboost_ranker.py";

    const python = spawn(pythonPath, [scriptPath], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    python.stdin.write(JSON.stringify(input));
    python.stdin.end();

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (stderr) {
        console.log("\nPython training output:");
        console.log(stderr);
      }

      if (code === 0 && stdout) {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          console.log("\nRaw output:", stdout);
          resolve({ error: "Failed to parse output" });
        }
      } else {
        resolve({ error: `Process exited with code ${code}` });
      }
    });

    python.on("error", (err) => {
      console.error("Failed to start Python:", err);
      reject(err);
    });
  });
}

async function testRanking(
  block: { serviceDate: string; contractType: string; startTime: string },
  drivers: Driver[],
  histories: Record<string, DriverHistory[]>
): Promise<void> {
  // Filter to matching contract type
  const candidates = drivers.filter(d => d.contractType === block.contractType);

  const input = {
    action: "rank",
    block: {
      serviceDate: block.serviceDate,
      contractType: block.contractType,
      startTime: block.startTime,
    },
    candidates: candidates.map(d => ({
      id: d.id,
      contractType: d.contractType,
    })),
    histories: histories,
    availabilityScores: {}, // Empty - ranker will use default
  };

  console.log(`\nRanking ${candidates.length} ${block.contractType} drivers for ${block.serviceDate}...`);

  return new Promise((resolve, reject) => {
    const pythonPath = "C:\\Users\\shire\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    const scriptPath = "python/xgboost_ranker.py";

    const python = spawn(pythonPath, [scriptPath], {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    python.stdin.write(JSON.stringify(input));
    python.stdin.end();

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      if (stderr) {
        console.log(stderr);
      }

      if (code === 0 && stdout) {
        try {
          const result = JSON.parse(stdout);
          if (result.rankings) {
            console.log(`\nTop 10 ranked drivers for ${block.contractType} block on ${block.serviceDate}:`);
            console.log("-".repeat(60));
            const top10 = result.rankings.slice(0, 10);
            for (let i = 0; i < top10.length; i++) {
              const [driverId, score] = top10[i];
              const name = driverNames[driverId] || driverId.slice(0, 8) + "...";
              const history = histories[driverId] || [];
              console.log(`  ${(i + 1).toString().padStart(2)}. ${name.padEnd(30)} Score: ${score.toFixed(3)} (${history.length} shifts)`);
            }
          } else {
            console.log("Ranking result:", result);
          }
        } catch (e) {
          console.log("\nRaw output:", stdout);
        }
      }

      resolve();
    });

    python.on("error", (err) => {
      console.error("Failed to start Python:", err);
      reject(err);
    });
  });
}

async function main() {
  console.log("=".repeat(70));
  console.log("Testing XGBoost Ranker (Stage 2) with REAL Database Data");
  console.log("=".repeat(70));

  // Fetch data
  const blocks = await fetchHistoricalBlocks();
  const drivers = await fetchAllDrivers();
  const histories = await fetchDriverHistories();

  // Show data summary
  console.log("\nData Summary:");
  console.log(`  Blocks: ${blocks.length}`);
  console.log(`  Drivers: ${drivers.length}`);
  console.log(`  Solo1 drivers: ${drivers.filter(d => d.contractType === "solo1").length}`);
  console.log(`  Solo2 drivers: ${drivers.filter(d => d.contractType === "solo2").length}`);

  // Train the ranker
  const trainResult = await trainRanker(blocks, histories, drivers);
  console.log("\nTraining result:", trainResult);

  // Test ranking for upcoming dates
  console.log("\n" + "=".repeat(70));
  console.log("Testing Rankings for Next Week");
  console.log("=".repeat(70));

  // Test solo2 block for Monday Dec 16
  await testRanking(
    { serviceDate: "2025-12-16", contractType: "solo2", startTime: "14:00" },
    drivers,
    histories
  );

  // Test solo1 block for Tuesday Dec 17
  await testRanking(
    { serviceDate: "2025-12-17", contractType: "solo1", startTime: "10:00" },
    drivers,
    histories
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
