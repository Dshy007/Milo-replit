/**
 * Regenerate Adan's DNA profile to test the two-pass algorithm fix
 */

import { db } from '../db.js';
import { drivers, driverDnaProfiles } from '../../shared/schema.js';
import { eq, ilike, and } from 'drizzle-orm';
import { analyzeDriverDNA } from '../dna-analyzer.js';

async function main() {
  console.log('Finding Adan...');

  const adanResults = await db.select()
    .from(drivers)
    .where(ilike(drivers.firstName, '%adan%'));

  if (adanResults.length === 0) {
    console.log('Adan not found');
    process.exit(1);
  }

  const adan = adanResults[0];
  console.log(`Found: ${adan.firstName} ${adan.lastName} (ID: ${adan.id})`);
  console.log(`Tenant: ${adan.tenantId}`);

  // Show current profile
  console.log('\n--- BEFORE (Current Profile) ---');
  const currentProfile = await db.select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, adan.id));

  if (currentProfile.length > 0) {
    const p = currentProfile[0];
    console.log(`Contract Type: ${p.preferredContractType}`);
    console.log(`Times: ${JSON.stringify(p.preferredStartTimes)}`);
    console.log(`Tractors: ${JSON.stringify(p.preferredTractors)}`);
  }

  // Regenerate profile
  console.log('\n--- REGENERATING ---');
  const result = await analyzeDriverDNA({
    tenantId: adan.tenantId,
    driverId: adan.id,
  });
  console.log(`Analyzed ${result.totalDrivers} driver(s)`);

  // Show new profile
  console.log('\n--- AFTER (New Profile) ---');
  const newProfile = await db.select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, adan.id));

  if (newProfile.length > 0) {
    const p = newProfile[0];
    console.log(`Contract Type: ${p.preferredContractType}`);
    console.log(`Times: ${JSON.stringify(p.preferredStartTimes)}`);
    console.log(`Tractors: ${JSON.stringify(p.preferredTractors)}`);
    console.log(`Days: ${JSON.stringify(p.preferredDays)}`);
    console.log(`Summary: ${p.aiSummary}`);
  }

  console.log('\nDone!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
