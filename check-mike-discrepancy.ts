/**
 * Investigate the 22 vs 16 discrepancy for Mike Burton
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const mikeId = '0b51f792-e104-4356-b011-f5557f29dec3';

  // Raw count from block_assignments
  const rawCount = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM block_assignments WHERE driver_id = ${mikeId}
  `);
  console.log('block_assignments count:', (rawCount.rows[0] as any).cnt);

  // Count with JOIN to blocks
  const joinCount = await db.execute(sql`
    SELECT COUNT(*) as cnt
    FROM block_assignments ba
    JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId}
  `);
  console.log('With JOIN to blocks:', (joinCount.rows[0] as any).cnt);

  // Are there orphaned block_assignments (no matching block)?
  const orphaned = await db.execute(sql`
    SELECT ba.block_id, ba.driver_id
    FROM block_assignments ba
    LEFT JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId} AND b.id IS NULL
  `);
  console.log('Orphaned assignments (no matching block):', orphaned.rows.length);

  // Check for duplicate assignments
  const duplicates = await db.execute(sql`
    SELECT ba.block_id, COUNT(*) as cnt
    FROM block_assignments ba
    WHERE ba.driver_id = ${mikeId}
    GROUP BY ba.block_id
    HAVING COUNT(*) > 1
  `);
  console.log('Duplicate block assignments:', duplicates.rows.length);

  // Get all block_assignments raw
  const allRaw = await db.execute(sql`
    SELECT ba.id, ba.block_id, ba.driver_id
    FROM block_assignments ba
    WHERE ba.driver_id = ${mikeId}
  `);
  console.log('\nAll block_assignment records:', allRaw.rows.length);

  // Check blocks table for Mike's block_ids
  const blockIds = (allRaw.rows as any[]).map(r => r.block_id);
  const uniqueBlockIds = [...new Set(blockIds)];
  console.log('Unique block_ids:', uniqueBlockIds.length);

  // How many of those blocks exist?
  const existingBlocks = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM blocks WHERE id = ANY(${uniqueBlockIds})
  `);
  console.log('Existing blocks:', (existingBlocks.rows[0] as any).cnt);

  // Show the missing ones
  const missing = await db.execute(sql`
    SELECT ba.block_id
    FROM block_assignments ba
    LEFT JOIN blocks b ON ba.block_id = b.id
    WHERE ba.driver_id = ${mikeId} AND b.id IS NULL
  `);

  if (missing.rows.length > 0) {
    console.log('\nMissing block IDs:');
    for (const r of missing.rows as any[]) {
      console.log('  ', r.block_id);
    }
  }

  process.exit(0);
}

main().catch(console.error);
