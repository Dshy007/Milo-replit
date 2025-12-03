-- Migration: Add Driver DNA Profiles table
-- Purpose: Store AI-inferred driver scheduling preferences from historical pattern analysis

CREATE TABLE IF NOT EXISTS driver_dna_profiles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  driver_id VARCHAR NOT NULL REFERENCES drivers(id),

  -- Structured preferences (inferred from AI)
  preferred_days TEXT[],
  preferred_start_times TEXT[],
  preferred_tractors TEXT[],
  preferred_contract_type TEXT,
  home_blocks TEXT[],

  -- Pattern metrics
  consistency_score DECIMAL(5, 4),
  pattern_group TEXT,
  weeks_analyzed INTEGER,
  assignments_analyzed INTEGER,

  -- AI-generated content
  ai_summary TEXT,
  insights JSONB,

  -- Metadata
  analysis_start_date TIMESTAMP,
  analysis_end_date TIMESTAMP,
  last_analyzed_at TIMESTAMP,
  analysis_version INTEGER DEFAULT 1,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique constraint: one DNA profile per driver per tenant
CREATE UNIQUE INDEX IF NOT EXISTS driver_dna_profiles_tenant_driver_idx
ON driver_dna_profiles(tenant_id, driver_id);

-- Index for pattern group queries
CREATE INDEX IF NOT EXISTS driver_dna_profiles_pattern_group_idx
ON driver_dna_profiles(pattern_group);

-- Index for consistency score ranking
CREATE INDEX IF NOT EXISTS driver_dna_profiles_consistency_idx
ON driver_dna_profiles(consistency_score);
