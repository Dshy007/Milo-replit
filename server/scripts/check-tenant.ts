/**
 * Check tenant IDs in the database
 */
import { db } from "../db";
import { drivers, driverDnaProfiles, tenants } from "@shared/schema";

async function checkTenant() {
  console.log("Checking tenant IDs...\n");

  // Get all tenants
  const allTenants = await db.select().from(tenants);
  console.log("All Tenants:");
  for (const t of allTenants) {
    console.log(`  ${t.id} - ${t.name}`);
  }
  console.log();

  // Get sample DNA profiles with tenant IDs
  const profiles = await db.select().from(driverDnaProfiles).limit(3);
  console.log("Sample DNA Profile Tenant IDs:");
  for (const p of profiles) {
    console.log(`  Profile ${p.id}: tenantId = ${p.tenantId}`);
  }
  console.log();

  // Get sample drivers with tenant IDs
  const driverList = await db.select().from(drivers).limit(3);
  console.log("Sample Driver Tenant IDs:");
  for (const d of driverList) {
    console.log(`  Driver ${d.firstName} ${d.lastName}: tenantId = ${d.tenantId}`);
  }
}

checkTenant()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
