import { format, getDay } from "date-fns";

/**
 * Normalize block type to standardized format
 * Handles case-insensitive matching and common variations
 */
export function normalizeBlockType(blockType: string): string {
  const normalized = blockType.toLowerCase().trim();
  
  // Standardize to: solo1, solo2, team
  if (normalized.includes("solo") && normalized.includes("1")) return "solo1";
  if (normalized.includes("solo") && normalized.includes("2")) return "solo2";
  if (normalized.includes("team")) return "team";
  
  // Default fallback
  return normalized;
}

/**
 * Format a timestamp to HH:mm format for consistency
 * Ensures all times are compared in the same format
 */
export function formatStartTime(timestamp: Date): string {
  return format(timestamp, "HH:mm");
}

/**
 * Get day of week name from a date
 * Returns lowercase english day names: monday, tuesday, etc.
 */
export function getDayOfWeek(date: Date): string {
  const dayIndex = getDay(date);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return days[dayIndex];
}

/**
 * Create a composite key for block signature matching
 * This key is used to match blocks with driver availability preferences
 * 
 * @param blockType - The type of block (solo1, solo2, team)
 * @param startTime - The start time in HH:mm format
 * @param dayOfWeek - The day of week (lowercase english name)
 * @returns A composite key like "solo1:16:30:monday"
 */
export function createBlockSignature(
  blockType: string,
  startTime: string,
  dayOfWeek: string
): string {
  const normalizedType = normalizeBlockType(blockType);
  const normalizedDay = dayOfWeek.toLowerCase().trim();
  return `${normalizedType}:${startTime}:${normalizedDay}`;
}

/**
 * Create a block signature directly from a Block object
 * Convenience function that extracts the necessary fields
 * 
 * @param block - Block object with type and startTimestamp
 * @returns A composite key for matching with preferences
 */
export function getBlockSignature(block: {
  type: string;
  startTimestamp: Date;
}): string {
  const blockType = normalizeBlockType(block.type);
  const startTime = formatStartTime(block.startTimestamp);
  const dayOfWeek = getDayOfWeek(block.startTimestamp);
  return createBlockSignature(blockType, startTime, dayOfWeek);
}

/**
 * Parse a block signature back into its components
 * @param signature - Composite key like "solo1:16:30:monday"
 * @returns Object with blockType, startTime, and dayOfWeek
 */
export function parseBlockSignature(signature: string): {
  blockType: string;
  startTime: string;
  dayOfWeek: string;
} | null {
  const parts = signature.split(":");
  if (parts.length !== 3) return null;
  
  return {
    blockType: parts[0],
    startTime: parts[1],
    dayOfWeek: parts[2]
  };
}
