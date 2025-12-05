/**
 * Quick script to check Adan's DNA profile
 */

import { db } from '../db.js';
import { driverDnaProfiles, drivers } from '../../shared/schema.js';
import { eq, ilike } from 'drizzle-orm';

async function check() {
  const adanResults = await db.select()
    .from(drivers)
    .where(ilike(drivers.firstName, '%adan%'));

  if (adanResults.length === 0) {
    console.log('Adan not found');
    process.exit(1);
  }

  const adan = adanResults[0];
  console.log('Driver:', adan.firstName, adan.lastName);
  console.log('Driver ID:', adan.id);

  const profile = await db.select()
    .from(driverDnaProfiles)
    .where(eq(driverDnaProfiles.driverId, adan.id));

  if (profile.length > 0) {
    const p = profile[0];
    console.log('\n--- DNA PROFILE ---');
    console.log('Preferred Contract Type:', p.preferredContractType);
    console.log('Preferred Days:', JSON.stringify(p.preferredDays));
    console.log('Preferred Start Times:', JSON.stringify(p.preferredStartTimes));
    console.log('Preferred Tractors:', JSON.stringify(p.preferredTractors));
    console.log('Pattern Group:', p.patternGroup);
    console.log('Assignments Analyzed:', p.assignmentsAnalyzed);
    console.log('AI Summary:', p.aiSummary);
  } else {
    console.log('No DNA profile found');
  }
  process.exit(0);
}

check().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
