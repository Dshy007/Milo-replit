import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function check() {
  const result = await db.execute(sql`
    SELECT
      MIN(service_date) as min_date,
      MAX(service_date) as max_date,
      COUNT(*) as total
    FROM shift_occurrences so
    JOIN shift_templates st ON so.template_id = st.id
    WHERE st.solo_type = 'solo2'
  `);
  console.log('Solo2 date range:', result.rows[0]);
}
check().then(() => process.exit(0));
