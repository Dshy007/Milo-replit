/**
 * Find and analyze ALL databases in this project
 */

import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('='.repeat(70));
  console.log('DATABASE INVENTORY');
  console.log('='.repeat(70));

  // 1. PostgreSQL (Neon) - Main database
  console.log('\n1. PostgreSQL (Neon) - via DATABASE_URL');
  console.log('   Connection:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown');

  try {
    // Count assignments
    const assignmentCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM block_assignments`);
    console.log('   Assignments:', (assignmentCount.rows[0] as any).cnt);

    // Date range
    const dateRange = await db.execute(sql`
      SELECT MIN(b.service_date) as min_date, MAX(b.service_date) as max_date
      FROM block_assignments ba
      JOIN blocks b ON ba.block_id = b.id
    `);
    const dr = dateRange.rows[0] as any;
    console.log('   Date range:', dr.min_date, 'to', dr.max_date);

    // Driver count
    const driverCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM drivers`);
    console.log('   Drivers:', (driverCount.rows[0] as any).cnt);

    // Block count
    const blockCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM blocks`);
    console.log('   Blocks:', (blockCount.rows[0] as any).cnt);
  } catch (e: any) {
    console.log('   Error:', e.message);
  }

  // 2. SQLite files
  console.log('\n2. SQLite Files Found:');
  console.log('   ./sqlite.db - 0 bytes (empty placeholder)');
  console.log('   ./data/chromadb/chroma.sqlite3 - 172KB (ChromaDB vector store)');

  // 3. Model files (not databases, but important data stores)
  console.log('\n3. Model Data Files:');
  console.log('   python/models/ownership_model.json - XGBoost ownership model');
  console.log('   python/models/ownership_encoders.json - slot_ownership data');
  console.log('   python/models/availability_model.json - XGBoost availability model');

  console.log('\n' + '='.repeat(70));
  console.log('WHAT USES WHAT');
  console.log('='.repeat(70));

  console.log(`
UI (React):
  → server/db.ts → PostgreSQL (Neon)
  → Reads: blocks, block_assignments, drivers

XGBoost Training (test-ownership-model.ts):
  → server/db.ts → PostgreSQL (Neon)
  → Reads assignments, writes to python/models/*.json

XGBoost Prediction (xgboost_ownership.py):
  → python/models/ownership_encoders.json (slot_ownership)
  → Does NOT query PostgreSQL directly

Schedule Pipeline (schedule-pipeline.ts):
  → server/db.ts → PostgreSQL (Neon)
  → Calls Python scripts with data passed via stdin

ChromaDB (data/chromadb/):
  → Vector store for AI chat features
  → Separate from scheduling data
`);

  console.log('='.repeat(70));
  console.log('CONCLUSION');
  console.log('='.repeat(70));
  console.log(`
All scheduling data flows through ONE PostgreSQL database (Neon):
  postgresql://...@ep-super-cherry-aeasozqo.c-2.us-east-2.aws.neon.tech/neondb

The XGBoost models are TRAINED from PostgreSQL but store patterns
in local JSON files (python/models/*.json). When predicting,
they read from these JSON files, NOT directly from PostgreSQL.

This means:
  - Model must be RETRAINED when new data is added to PostgreSQL
  - Model files are a SNAPSHOT of training data at train time
`);

  process.exit(0);
}

main().catch(console.error);
