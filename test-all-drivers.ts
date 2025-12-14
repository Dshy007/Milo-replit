/**
 * Test script to show all drivers with their scheduling patterns
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';

const TENANT_ID = '3cf00ed3-3eb9-43bf-b001-aee880b30304';

async function main() {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Get ALL drivers with their assignment stats
  const result = await db.execute(sql`
    WITH driver_stats AS (
      SELECT
        d.id,
        d.first_name || ' ' || d.last_name as name,
        (SELECT b2.solo_type FROM blocks b2
         JOIN block_assignments ba2 ON ba2.block_id = b2.id
         WHERE ba2.driver_id = d.id AND ba2.is_active = true
         LIMIT 1) as contract_type,
        COUNT(DISTINCT ba.block_id) as total_blocks,
        COUNT(DISTINCT b.service_date) as total_days,
        MIN(b.service_date)::text as first_block,
        MAX(b.service_date)::text as last_block,
        array_agg(DISTINCT EXTRACT(DOW FROM b.service_date)::int ORDER BY EXTRACT(DOW FROM b.service_date)::int) as work_days
      FROM drivers d
      LEFT JOIN block_assignments ba ON ba.driver_id = d.id AND ba.is_active = true
      LEFT JOIN blocks b ON ba.block_id = b.id
      WHERE d.tenant_id = ${TENANT_ID}
      AND d.status = 'active'
      GROUP BY d.id, d.first_name, d.last_name
    )
    SELECT * FROM driver_stats
    ORDER BY contract_type NULLS LAST, total_blocks DESC
  `);

  console.log('='.repeat(100));
  console.log('ALL DRIVERS WITH SCHEDULING PATTERNS');
  console.log('='.repeat(100));

  let currentType = '';
  for (const row of result.rows as any[]) {
    if (row.contract_type !== currentType) {
      currentType = row.contract_type;
      console.log('\n' + '-'.repeat(100));
      console.log(`CONTRACT TYPE: ${(currentType || 'UNKNOWN').toUpperCase()}`);
      console.log('-'.repeat(100));
      console.log('Driver Name                  | Blocks | Days | First Block  | Last Block   | Work Pattern');
      console.log('-'.repeat(100));
    }

    const workDays = row.work_days || [];
    const workPattern = workDays
      .filter((d: number | null) => d !== null)
      .map((d: number) => dayNames[d])
      .join('-') || 'No history';

    const name = (row.name || 'Unknown').padEnd(28);
    const blocks = String(row.total_blocks || 0).padStart(6);
    const days = String(row.total_days || 0).padStart(4);
    const first = (row.first_block || 'N/A').padEnd(12);
    const last = (row.last_block || 'N/A').padEnd(12);

    console.log(`${name} | ${blocks} | ${days} | ${first} | ${last} | ${workPattern}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log(`Total: ${result.rows.length} drivers`);

  process.exit(0);
}

main().catch(console.error);
