import { db } from './server/db';
import { drivers, blocks, blockAssignments } from './shared/schema';
import { eq, and, gte, sql, or, ilike } from 'drizzle-orm';

// Canonical start times derived from tractor assignments
const CANONICAL_START_TIMES: Record<string, string> = {
  // Solo1 (10 tractors)
  "solo1_Tractor_1": "16:30",
  "solo1_Tractor_2": "20:30",
  "solo1_Tractor_3": "20:30",
  "solo1_Tractor_4": "17:30",
  "solo1_Tractor_5": "21:30",
  "solo1_Tractor_6": "01:30",
  "solo1_Tractor_7": "18:30",
  "solo1_Tractor_8": "00:30",
  "solo1_Tractor_9": "16:30",
  "solo1_Tractor_10": "20:30",
  // Solo2 (7 tractors)
  "solo2_Tractor_1": "18:30",
  "solo2_Tractor_2": "23:30",
  "solo2_Tractor_3": "21:30",
  "solo2_Tractor_4": "08:30",
  "solo2_Tractor_5": "15:30",
  "solo2_Tractor_6": "11:30",
  "solo2_Tractor_7": "16:30",
};

async function main() {
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);

  const results = await db
    .select({
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
      tractorId: blocks.tractorId,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
    .where(
      and(
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, threeWeeksAgo),
        or(
          ilike(drivers.firstName, '%firas%'),
          ilike(drivers.firstName, '%adan%')
        )
      )
    )
    .orderBy(drivers.firstName, blocks.serviceDate);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  console.log('=== FIRAS & ADAN: Last 3 weeks (with time slots) ===\n');
  console.log('Date       | Day       | Time  | Contract | Tractor    | Driver');
  console.log('-----------+-----------+-------+----------+------------+------------------');

  for (const r of results) {
    const date = new Date(r.serviceDate);
    const dayName = days[date.getUTCDay()].padEnd(9);
    const name = `${r.firstName} ${r.lastName}`;

    // Lookup canonical time
    const soloType = (r.soloType || 'solo1').toLowerCase();
    const lookupKey = `${soloType}_${r.tractorId}`;
    const time = CANONICAL_START_TIMES[lookupKey] || '??:??';

    console.log(`${r.serviceDate.toISOString().slice(0,10)} | ${dayName} | ${time} | ${r.soloType?.padEnd(8)} | ${r.tractorId?.padEnd(10)} | ${name}`);
  }

  console.log('\nTotal:', results.length, 'assignments');
  process.exit(0);
}

main();
