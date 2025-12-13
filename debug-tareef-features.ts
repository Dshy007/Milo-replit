/**
 * Deep dive into EXACTLY what features the model saw for Tareef on Friday
 * This will show the raw feature values passed to XGBoost
 */

import { db } from "./server/db";
import { sql } from "drizzle-orm";
import { subDays, format, addDays } from "date-fns";
import { spawn } from "child_process";

async function main() {
  console.log("=".repeat(70));
  console.log("DEEP DIVE: Tareef's Features for Friday Dec 20");
  console.log("=".repeat(70));

  // Get Tareef's driver ID and full history
  const tareefData = await db.execute(sql`
    SELECT
      d.id as driver_id,
      d.first_name || ' ' || d.last_name as driver_name,
      b.service_date::date as service_date,
      EXTRACT(DOW FROM b.service_date) as dow
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    JOIN drivers d ON ba.driver_id = d.id
    WHERE ba.is_active = true
      AND LOWER(d.first_name) LIKE '%tareef%'
    ORDER BY b.service_date
  `);

  if (tareefData.rows.length === 0) {
    console.log("Tareef not found!");
    return;
  }

  const driverId = String(tareefData.rows[0].driver_id);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Build Tareef's history in the format the Python model expects
  const history = tareefData.rows.map(row => ({
    serviceDate: String(row.service_date).split("T")[0],
    day: dayNames[Number(row.dow)]
  }));

  console.log(`\nTareef's ID: ${driverId}`);
  console.log(`Total shifts: ${history.length}`);
  console.log(`\nHistory:`);
  for (const h of history) {
    console.log(`  ${h.serviceDate} (${h.day})`);
  }

  // Now call Python to extract features for Friday Dec 20
  console.log("\n" + "=".repeat(70));
  console.log("Calling Python to extract features for Friday Dec 20...");
  console.log("=".repeat(70));

  const input = {
    action: "debug_features",
    driver_id: driverId,
    date: "2025-12-20",  // Friday
    history: history
  };

  return new Promise<void>((resolve, reject) => {
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
        console.log("\nPython debug output:");
        console.log(stderr);
      }

      if (stdout) {
        try {
          const result = JSON.parse(stdout);
          console.log("\nFeature extraction result:");
          console.log(JSON.stringify(result, null, 2));
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

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
