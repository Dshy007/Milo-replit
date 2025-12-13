/**
 * Test XGBoost Pipeline Stage 1: Availability Filter
 *
 * Tests which drivers pass the availability filter for Dec 16, 2025
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format } from "date-fns";
import { spawn } from "child_process";

const LOOKBACK_DAYS = 56; // 8 weeks

interface Driver {
  id: string;
  name: string;
  contractType: string;
}

interface DriverHistory {
  serviceDate: string;
  time?: string;
}

// Store driver names
const driverNames: Record<string, string> = {};

async function fetchAllDrivers(): Promise<Driver[]> {
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

  const driverMap: Record<string, Driver> = {};
  for (const row of result.rows) {
    const id = String(row.id);
    const name = String(row.name);
    driverNames[id] = name;

    if (!driverMap[id]) {
      driverMap[id] = {
        id,
        name,
        contractType: String(row.contract_type || "").toLowerCase(),
      };
    }
  }

  return Object.values(driverMap);
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

  return byDriver;
}

async function testStage1Filter(
  date: string,
  drivers: Driver[],
  histories: Record<string, DriverHistory[]>
): Promise<void> {
  const input = {
    action: "filter",
    date: date,
    drivers: drivers.map(d => ({
      id: d.id,
      contractType: d.contractType,
    })),
    histories: histories,
    availabilityThreshold: 0.5,
  };

  console.log(`\nTesting Stage 1 filter for ${date}...`);
  console.log(`Total drivers: ${drivers.length}`);

  return new Promise((resolve, reject) => {
    const pythonPath = "C:\\Users\\shire\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    const scriptPath = "python/xgboost_pipeline.py";

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
        console.log("\nPipeline output:");
        console.log(stderr);
      }

      if (code === 0 && stdout) {
        try {
          const result = JSON.parse(stdout);
          if (result.available) {
            console.log(`\n=== Drivers Available for ${date} ===`);
            console.log("-".repeat(60));

            // Group by contract type
            const solo1: [string, number][] = [];
            const solo2: [string, number][] = [];

            for (const [driverId, score] of result.available) {
              const driver = drivers.find(d => d.id === driverId);
              const name = driverNames[driverId] || driverId.slice(0, 8);
              if (driver?.contractType === "solo1") {
                solo1.push([name, score]);
              } else {
                solo2.push([name, score]);
              }
            }

            console.log(`\nSOLO1 Drivers (${solo1.length}):`);
            for (const [name, score] of solo1.slice(0, 10)) {
              console.log(`  ${name.padEnd(30)} Availability: ${(score * 100).toFixed(1)}%`);
            }

            console.log(`\nSOLO2 Drivers (${solo2.length}):`);
            for (const [name, score] of solo2.slice(0, 10)) {
              console.log(`  ${name.padEnd(30)} Availability: ${(score * 100).toFixed(1)}%`);
            }

            console.log(`\nTotal passing filter: ${result.available.length}`);
          } else {
            console.log("Result:", result);
          }
        } catch (e) {
          console.log("Raw output:", stdout);
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
  console.log("Testing XGBoost Pipeline - Stage 1 (Availability Filter)");
  console.log("=".repeat(70));

  const drivers = await fetchAllDrivers();
  const histories = await fetchDriverHistories();

  console.log(`\nData loaded:`);
  console.log(`  Drivers: ${drivers.length}`);
  console.log(`  Solo1: ${drivers.filter(d => d.contractType === "solo1").length}`);
  console.log(`  Solo2: ${drivers.filter(d => d.contractType === "solo2").length}`);

  // Test for Monday Dec 16
  await testStage1Filter("2025-12-16", drivers, histories);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
