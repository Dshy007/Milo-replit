import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const r = await db.execute(sql`
    SELECT
      CURRENT_DATE as today,
      (CURRENT_DATE - INTERVAL '12 weeks')::date as cutoff_12wk,
      (SELECT MIN(service_date)::date FROM blocks) as oldest_block,
      (SELECT MAX(service_date)::date FROM blocks) as newest_block,
      (SELECT COUNT(*) FROM block_assignments ba JOIN blocks b ON ba.block_id = b.id WHERE b.service_date >= CURRENT_DATE - INTERVAL '12 weeks') as filtered_12wk,
      (SELECT COUNT(*) FROM block_assignments) as total_assignments
  `);

  const data = r.rows[0] as any;

  console.log('='.repeat(60));
  console.log('DATE RANGE ANALYSIS');
  console.log('='.repeat(60));
  console.log('\nToday:', data.today);
  console.log('12-week cutoff:', data.cutoff_12wk);
  console.log('\nOldest block in DB:', data.oldest_block);
  console.log('Newest block in DB:', data.newest_block);
  console.log('\nTotal assignments:', data.total_assignments);
  console.log('Filtered (12 weeks):', data.filtered_12wk);
  console.log('\n' + '='.repeat(60));

  if (new Date(data.oldest_block) > new Date(data.cutoff_12wk)) {
    console.log('WARNING: YOUR OLDEST DATA IS NEWER THAN 12-WEEK CUTOFF');
    console.log('    No filtering is happening - you have < 12 weeks of data');
  } else {
    console.log('You have more than 12 weeks of historical data');
  }

  process.exit(0);
}

main().catch(console.error);
