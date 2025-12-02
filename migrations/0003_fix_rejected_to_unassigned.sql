-- Migration: Reset all isRejectedLoad flags to false
-- Reason: Empty driver field means "unassigned" (yellow), not "rejected" (red)
-- The isRejectedLoad flag should only be true when Amazon explicitly rejects a driver,
-- which cannot be determined from the CSV data alone.

UPDATE "blocks" SET "is_rejected_load" = false WHERE "is_rejected_load" = true;
