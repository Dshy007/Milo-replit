import { db } from './server/db';
import { drivers, blocks, blockAssignments } from './shared/schema';
import { eq, and, gte, ilike } from 'drizzle-orm';

async function main() {
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

  const results = await db
    .select({
      serviceDate: blocks.serviceDate,
      soloType: blocks.soloType,
    })
    .from(blockAssignments)
    .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
    .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
    .where(
      and(
        eq(blockAssignments.isActive, true),
        gte(blocks.serviceDate, eightWeeksAgo),
        ilike(drivers.firstName, '%adan%')
      )
    )
    .orderBy(blocks.serviceDate);

  const weekMap = new Map<string, { solo1: number; solo2: number; total: number }>();
  for (const r of results) {
    const date = new Date(r.serviceDate);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getUTCDay());
    const weekKey = weekStart.toISOString().slice(0,10);

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, { solo1: 0, solo2: 0, total: 0 });
    }
    const week = weekMap.get(weekKey)!;
    if (r.soloType?.toLowerCase() === 'solo1') week.solo1++;
    else if (r.soloType?.toLowerCase() === 'solo2') week.solo2++;
    week.total++;
  }

  console.log('=== ADAN: Blocks per Week (last 8 weeks) ===');
  console.log('');
  console.log('Week Starting | Solo1 | Solo2 | Total');
  console.log('--------------+-------+-------+------');

  let totalWeeks = 0;
  let totalBlocks = 0;
  for (const [week, counts] of [...weekMap.entries()].sort()) {
    console.log(`${week}  |   ${counts.solo1}   |   ${counts.solo2}   |   ${counts.total}`);
    totalWeeks++;
    totalBlocks += counts.total;
  }

  console.log('');
  console.log('--- Summary ---');
  console.log('Total weeks with assignments:', totalWeeks);
  console.log('Total blocks:', totalBlocks);
  if (totalWeeks > 0) {
    console.log('Average blocks/week:', (totalBlocks / totalWeeks).toFixed(1));
  }

  process.exit(0);
}
main();
