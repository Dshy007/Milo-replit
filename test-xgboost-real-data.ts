/**
 * Test XGBoost availability prediction with REAL database data
 *
 * This script:
 * 1. Fetches actual assignment history from the database (8 weeks)
 * 2. Passes it to the Python XGBoost model for training
 * 3. Shows predictions for the upcoming week
 *
 * Usage: npx tsx test-xgboost-real-data.ts
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format, addDays, startOfWeek } from "date-fns";
import { spawn } from "child_process";

interface DriverHistory {
  driverId: string;
  driverName: string;
  serviceDate: string;
  dayOfWeek: number;
}

// Store driver names for display
const driverNames: Record<string, string> = {};

// Configurable lookback - change this to test different windows
const LOOKBACK_DAYS = 7; // 1 week - match last week to this week

async function fetchDriverHistory(): Promise<Record<string, { serviceDate: string; day: string }[]>> {
  const today = new Date();
  const lookbackStart = subDays(today, LOOKBACK_DAYS);
  const yesterday = subDays(today, 1);

  console.log(`Fetching history: ${format(lookbackStart, "yyyy-MM-dd")} to ${format(yesterday, "yyyy-MM-dd")} (${LOOKBACK_DAYS} days)`);

  const history = await db.execute(sql`
    SELECT
      ba.driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      EXTRACT(DOW FROM b.service_date) as dow
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND ba.driver_id IS NOT NULL
      AND b.service_date >= ${format(lookbackStart, "yyyy-MM-dd")}::timestamp
      AND b.service_date <= ${format(yesterday, "yyyy-MM-dd")}::timestamp
    ORDER BY b.service_date
  `);

  // Group by driver
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDriver: Record<string, { serviceDate: string; day: string }[]> = {};

  for (const row of history.rows) {
    const driverId = String(row.driver_id);
    if (!byDriver[driverId]) {
      byDriver[driverId] = [];
    }
    byDriver[driverId].push({
      serviceDate: String(row.service_date).split("T")[0],
      day: dayNames[Number(row.dow)],
    });
    // Store driver name
    if (row.driver_name) {
      driverNames[driverId] = String(row.driver_name);
    }
  }

  console.log(`Found ${Object.keys(byDriver).length} drivers with history`);
  return byDriver;
}

async function trainAndPredict(histories: Record<string, { serviceDate: string; day: string }[]>): Promise<void> {
  // Prepare input for Python
  const input = {
    action: "train_and_predict",
    histories: histories,
    predict_dates: [] as string[],
  };

  // Generate dates for upcoming week (next Sunday to Saturday)
  const today = new Date();
  const nextWeekStart = startOfWeek(addDays(today, 7), { weekStartsOn: 0 });
  for (let i = 0; i < 7; i++) {
    const date = addDays(nextWeekStart, i);
    input.predict_dates.push(format(date, "yyyy-MM-dd"));
  }

  console.log(`\nPredicting availability for: ${input.predict_dates[0]} to ${input.predict_dates[6]}`);

  // Call Python script
  return new Promise((resolve, reject) => {
    const pythonPath = "C:\\Users\\shire\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";
    const scriptPath = "python/xgboost_availability.py";

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
        console.log("\nPython output:");
        console.log(stderr);
      }

      if (code === 0 && stdout) {
        try {
          const result = JSON.parse(stdout);
          displayResults(result, histories);
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

function displayResults(
  result: any,
  histories: Record<string, { serviceDate: string; day: string }[]>
): void {
  console.log("\n" + "=".repeat(70));
  console.log("XGBoost Training Results with REAL Database Data");
  console.log("=".repeat(70));

  if (result.training) {
    console.log(`\nTraining Samples: ${result.training.samples}`);
    console.log(`Test Accuracy: ${(result.training.accuracy * 100).toFixed(1)}%`);
    console.log(`Test Precision: ${(result.training.precision * 100).toFixed(1)}%`);
    console.log(`Test Recall: ${(result.training.recall * 100).toFixed(1)}%`);
    console.log(`Test F1 Score: ${(result.training.f1 * 100).toFixed(1)}%`);
  }

  if (result.predictions) {
    console.log("\n" + "-".repeat(70));
    console.log("Predictions for Next Week (Top 5 per day):");
    console.log("-".repeat(70));

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    for (const [date, drivers] of Object.entries(result.predictions)) {
      const dateObj = new Date(date);
      // Use getUTCDay() to avoid timezone issues - getDay() returns local time which can shift the day
      const dayName = dayNames[dateObj.getUTCDay()];
      console.log(`\n${date} (${dayName}):`);

      // Sort by probability and show top 5
      const sorted = Object.entries(drivers as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      for (const [driverId, prob] of sorted) {
        const history = histories[driverId] || [];
        const shiftCount = history.length;
        const name = driverNames[driverId] || driverId.slice(0, 8) + "...";
        console.log(`  ${(prob * 100).toFixed(0)}% - ${name.padEnd(30)} (${shiftCount} shifts)`);
      }
    }
  }
}

async function main() {
  console.log("=".repeat(70));
  console.log("Testing XGBoost with REAL Database Data");
  console.log("=".repeat(70));

  const histories = await fetchDriverHistory();

  // Show sample of history
  const sampleDrivers = Object.entries(histories).slice(0, 3);
  console.log("\nSample driver histories:");
  for (const [driverId, shifts] of sampleDrivers) {
    console.log(`  ${driverId.slice(0, 8)}...: ${shifts.length} shifts`);
    console.log(`    First: ${shifts[0]?.serviceDate}, Last: ${shifts[shifts.length - 1]?.serviceDate}`);
  }

  await trainAndPredict(histories);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
