import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  // Check all Solo2 blocks for Dec 6-12, 2025 (the week shown in screenshot)
  const result = await db.execute(sql`
    SELECT
      so.service_date,
      st.canonical_start_time,
      so.external_block_id,
      so.status,
      ba.driver_id,
      d.first_name,
      d.last_name
    FROM shift_occurrences so
    JOIN shift_templates st ON so.template_id = st.id
    LEFT JOIN block_assignments ba ON ba.shift_occurrence_id = so.id AND ba.is_active = true
    LEFT JOIN drivers d ON ba.driver_id = d.id
    WHERE st.solo_type = 'solo2'
    AND so.service_date >= '2025-12-06'
    AND so.service_date <= '2025-12-13'
    ORDER BY so.service_date, st.canonical_start_time
    LIMIT 100
  `);

  console.log('Solo2 blocks from Dec 1:');
  console.log('========================');
  for (const row of result.rows as any[]) {
    const driver = row.driver_id ? `${row.first_name} ${row.last_name}` : 'UNASSIGNED';
    console.log(`  ${row.service_date} @ ${row.canonical_start_time} - ${row.external_block_id || 'N/A'} - ${row.status} - ${driver}`);
  }

  // Count unassigned by date
  const unassigned = await db.execute(sql`
    SELECT
      so.service_date,
      COUNT(*) as count
    FROM shift_occurrences so
    JOIN shift_templates st ON so.template_id = st.id
    LEFT JOIN block_assignments ba ON ba.shift_occurrence_id = so.id AND ba.is_active = true
    WHERE st.solo_type = 'solo2'
    AND ba.driver_id IS NULL
    AND so.status != 'rejected'
    GROUP BY so.service_date
    ORDER BY so.service_date
  `);

  console.log('\nUnassigned Solo2 by date:');
  for (const row of unassigned.rows as any[]) {
    console.log(`  ${row.service_date}: ${row.count}`);
  }
}

check().catch(console.error).finally(() => process.exit(0));
