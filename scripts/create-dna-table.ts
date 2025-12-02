/**
 * Script to create the driver_dna_profiles table
 * Run with: npx tsx scripts/create-dna-table.ts
 */

import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function createTable() {
  try {
    // Check if table exists
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'driver_dna_profiles'
      );
    `);
    const exists = result.rows[0]?.exists;
    console.log('Table exists:', exists);

    if (!exists) {
      console.log('Creating driver_dna_profiles table...');
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS driver_dna_profiles (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
          driver_id VARCHAR NOT NULL REFERENCES drivers(id),
          preferred_days TEXT[],
          preferred_start_times TEXT[],
          preferred_tractors TEXT[],
          preferred_contract_type TEXT,
          home_blocks TEXT[],
          consistency_score DECIMAL(5, 4),
          pattern_group TEXT,
          weeks_analyzed INTEGER,
          assignments_analyzed INTEGER,
          ai_summary TEXT,
          insights JSONB,
          analysis_start_date TIMESTAMP,
          analysis_end_date TIMESTAMP,
          last_analyzed_at TIMESTAMP,
          analysis_version INTEGER DEFAULT 1,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
      console.log('Table created!');

      // Create indexes
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS driver_dna_profiles_tenant_driver_idx
        ON driver_dna_profiles(tenant_id, driver_id);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS driver_dna_profiles_pattern_group_idx
        ON driver_dna_profiles(pattern_group);
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS driver_dna_profiles_consistency_idx
        ON driver_dna_profiles(consistency_score);
      `);
      console.log('Indexes created!');
    } else {
      console.log('Table already exists, skipping creation');
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

createTable();
