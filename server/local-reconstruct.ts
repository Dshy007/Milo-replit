/**
 * Local Block Reconstruction - No AI, no truncation
 * Parses trip-level CSV and reconstructs blocks deterministically
 */

// Canonical start times from contracts table
const CANONICAL_START_TIMES: Record<string, string> = {
  "Solo1_Tractor_1": "16:30",
  "Solo1_Tractor_2": "20:30",
  "Solo1_Tractor_3": "20:30",
  "Solo1_Tractor_4": "17:30",
  "Solo1_Tractor_5": "21:30",
  "Solo1_Tractor_6": "01:30",
  "Solo1_Tractor_7": "18:30",
  "Solo1_Tractor_8": "00:30",
  "Solo1_Tractor_9": "16:30",
  "Solo1_Tractor_10": "20:30",
  "Solo2_Tractor_1": "18:30",
  "Solo2_Tractor_2": "23:30",
  "Solo2_Tractor_3": "21:30",
  "Solo2_Tractor_4": "08:30",
  "Solo2_Tractor_5": "15:30",
  "Solo2_Tractor_6": "11:30",
  "Solo2_Tractor_7": "16:30",
};

// Group tractors by contract type for fuzzy matching
const SOLO1_TRACTORS = Object.entries(CANONICAL_START_TIMES)
  .filter(([key]) => key.startsWith('Solo1_'))
  .map(([key, time]) => ({ contract: key, time }));

const SOLO2_TRACTORS = Object.entries(CANONICAL_START_TIMES)
  .filter(([key]) => key.startsWith('Solo2_'))
  .map(([key, time]) => ({ contract: key, time }));

/**
 * Parse time string to minutes from midnight for comparison
 */
function timeToMinutes(timeStr: string): number {
  if (!timeStr) return -1;

  // Handle various time formats: "HH:MM", "HH:MM:SS", "HH:MM AM/PM"
  const cleanTime = timeStr.trim().toUpperCase();

  // Check for AM/PM format
  const isPM = cleanTime.includes('PM');
  const isAM = cleanTime.includes('AM');
  const timeOnly = cleanTime.replace(/\s*(AM|PM)\s*/i, '');

  const parts = timeOnly.split(':');
  if (parts.length < 2) return -1;

  let hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);

  if (isNaN(hours) || isNaN(minutes)) return -1;

  // Handle AM/PM conversion
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/**
 * Calculate time difference in minutes, handling overnight spans
 */
function getTimeDifferenceMinutes(time1: string, time2: string): number {
  const m1 = timeToMinutes(time1);
  const m2 = timeToMinutes(time2);

  if (m1 < 0 || m2 < 0) return Infinity;

  // Calculate absolute difference, considering overnight wrap
  const diff1 = Math.abs(m2 - m1);
  const diff2 = 1440 - diff1; // 1440 = 24 hours in minutes

  return Math.min(diff1, diff2);
}

/**
 * Calculate block duration in hours from start and end times
 * NOTE: This only handles single-day durations. For multi-day blocks, use calculateDurationWithDates.
 */
function calculateDurationHours(startTime: string, endTime: string): number {
  const startMins = timeToMinutes(startTime);
  const endMins = timeToMinutes(endTime);

  if (startMins < 0 || endMins < 0) return 14; // Default to Solo1 duration

  let durationMins = endMins - startMins;
  // Handle overnight shifts
  if (durationMins < 0) {
    durationMins += 1440; // Add 24 hours
  }

  return durationMins / 60;
}

/**
 * Calculate block duration in hours using full date+time (handles multi-day spans)
 * This is the correct way to calculate Solo2 durations which span 38+ hours
 */
function calculateDurationWithDates(
  startDate: string, startTime: string,
  endDate: string, endTime: string
): number {
  try {
    // Parse start datetime
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);

    if (startMins < 0 || endMins < 0 || !startDate || !endDate) {
      return 14; // Default to Solo1 duration if parsing fails
    }

    // Calculate days difference
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return 14; // Default if date parsing fails
    }

    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    // Total duration = (days * 24 hours) + (end time - start time in hours)
    const timeDiffMins = endMins - startMins;
    const totalHours = (daysDiff * 24) + (timeDiffMins / 60);

    // Sanity check: duration should be positive and reasonable (0-72 hours)
    if (totalHours < 0 || totalHours > 72) {
      console.log(`[Duration] WARNING: Calculated duration ${totalHours.toFixed(1)}h seems wrong, using default`);
      return 14;
    }

    return totalHours;
  } catch (error) {
    return 14; // Default on any error
  }
}

/**
 * FUZZY MATCHING: Find the best tractor assignment for a block without explicit Tractor_ in Operator ID
 *
 * Logic:
 * 1. Determine contract type (Solo1 vs Solo2) based on duration (≤15h = Solo1, >15h = Solo2)
 * 2. Find the tractor with the closest canonical start time to the block's actual departure time
 * 3. Track used tractors per date to avoid collisions
 */
function fuzzyMatchTractor(
  departureTime: string,
  durationHours: number,
  date: string,
  usedTractors: Map<string, Set<string>> // Map<date, Set<contract>>
): { contract: string; canonicalTime: string; reason: string } {
  // Determine contract type based on duration
  // Solo1 routes are typically ≤15 hours, Solo2 are longer
  const contractType = durationHours <= 15 ? 'Solo1' : 'Solo2';
  const tractorList = contractType === 'Solo1' ? SOLO1_TRACTORS : SOLO2_TRACTORS;

  // Get already-used tractors for this date
  const usedForDate = usedTractors.get(date) || new Set<string>();

  // Find available tractors sorted by time proximity
  const candidates = tractorList
    .filter(t => !usedForDate.has(t.contract))
    .map(t => ({
      ...t,
      timeDiff: getTimeDifferenceMinutes(departureTime, t.time)
    }))
    .sort((a, b) => a.timeDiff - b.timeDiff);

  if (candidates.length === 0) {
    // All tractors used for this date - assign to first available tractor anyway
    console.log(`[FUZZY] WARNING: All ${contractType} tractors used for ${date}, using first available`);
    const firstTractor = tractorList[0];
    return {
      contract: firstTractor.contract,
      canonicalTime: firstTractor.time,
      reason: `FUZZY: All ${contractType} tractors occupied, forced assignment`
    };
  }

  const bestMatch = candidates[0];
  console.log(`[FUZZY] Matched ${contractType} block at ${departureTime} → ${bestMatch.contract} (canonical ${bestMatch.time}, diff ${bestMatch.timeDiff} mins)`);

  return {
    contract: bestMatch.contract,
    canonicalTime: bestMatch.time,
    reason: `FUZZY: Matched by time proximity (${bestMatch.timeDiff} min diff, ${durationHours.toFixed(1)}h duration → ${contractType})`
  };
}

export interface ReconstructedBlock {
  blockId: string;
  contract: string;
  canonicalStartTime: string;
  startDate: string;
  duration: string;
  cost: number;
  primaryDriver: string;
  relayDrivers: string[];
  loadCount: number;
  route: string;
  hasRejectedTrip: boolean; // true if ANY trip in block has Trip Stage = "Rejected"
}

interface TripRow {
  blockId: string;
  operatorId: string;
  driver: string;
  departureDate: string;
  departureTime: string;  // Fallback for start time if Stop 1 arrival not available
  stop1ArrivalTime: string; // PRIMARY block start time: min(Stop 1 arrival) across all trips
  arrivalDate: string;    // For multi-day duration calculation
  arrivalTime: string;    // For duration calculation
  cost: number;
  origin: string;
  destination: string;
  tripStage: string; // "Rejected", "Upcoming", etc.
}

/**
 * Parse CSV text into rows
 */
function parseCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header - handle quoted headers
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, idx) => {
      row[header.trim()] = values[idx]?.trim() || '';
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

/**
 * Find a column value by checking multiple possible column names
 * Returns first non-empty value found (skips columns that exist but are empty)
 */
function findColumn(row: Record<string, string>, possibleNames: string[]): string {
  for (const name of possibleNames) {
    // Check exact match
    if (row[name] !== undefined && row[name].trim() !== '') {
      return row[name];
    }

    // Check case-insensitive
    const lowerName = name.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lowerName && row[key].trim() !== '') {
        return row[key];
      }
    }
  }
  return '';
}

/**
 * Extract contract name from Operator ID
 * Example: "FTIM_MKC_Solo2_Tractor_6_d1" -> "Solo2_Tractor_6"
 * Normalizes case to match CANONICAL_START_TIMES keys (e.g., Solo1, Solo2, Tractor)
 */
function extractContract(operatorId: string): string {
  // Match Solo1_Tractor_N or Solo2_Tractor_N pattern (case insensitive)
  const match = operatorId.match(/(solo)([12])_(tractor)_(\d+)/i);
  if (match) {
    // Normalize to proper case: "Solo1_Tractor_N" or "Solo2_Tractor_N"
    const soloNum = match[2];  // 1 or 2
    const tractorNum = match[4];  // tractor number
    return `Solo${soloNum}_Tractor_${tractorNum}`;
  }
  return operatorId;
}

/**
 * Normalize a time string to HH:MM format.
 * Handles both '8:30' (no leading zero) and '08:30' formats.
 */
function normalizeTime(timeStr: string): string {
  const mins = timeToMinutes(timeStr);
  if (mins < 0) return timeStr; // Return as-is if unparseable
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return (h.toString().padStart(2, '0') + ':' + m.toString().padStart(2, '0'));
}

/**
 * Extract tractor number from Operator ID string.
 * Returns null if no Tractor_N pattern found.
 */
function extractTractorId(operatorId: string): string | null {
  const match = operatorId.match(/tractor_(d+)/i);
  return match ? match[1] : null;
}

/**
 * Find contract key using start time + solo type as primary key.
 * Tractor ID (from Operator ID column S) is used ONLY for disambiguation
 * when multiple contracts share the same start time + solo type.
 *
 * Ambiguous cases handled by duration-derived solo type:
 *   16:30 + Solo1 → Tractor_1 or Tractor_9  (use tractor ID to pick)
 *   16:30 + Solo2 → Tractor_7
 *   18:30 + Solo1 → Tractor_7
 *   18:30 + Solo2 → Tractor_1
 *   21:30 + Solo1 → Tractor_5
 *   21:30 + Solo2 → Tractor_3
 */
function findContractKey(
  startTime: string,
  soloType: 'Solo1' | 'Solo2',
  tractorId: string | null,
  usedForDate: Set<string>
): { contract: string; canonicalTime: string } | null {
  if (!startTime) return null;
  const startMins = timeToMinutes(startTime);
  if (startMins < 0) return null;

  // Find all contracts matching solo type + start time (within 30 min tolerance)
  const matches = Object.entries(CANONICAL_START_TIMES)
    .filter(([key]) => key.startsWith(soloType + '_'))
    .filter(([_, time]) => Math.abs(timeToMinutes(time) - startMins) <= 30)
    .map(([key, time]) => ({ contract: key, canonicalTime: time }));

  if (matches.length === 0) return null;

  // Primary disambiguation: use tractor ID from operator if available
  if (tractorId) {
    const tractorKey = soloType + '_Tractor_' + tractorId;
    const tractorMatch = matches.find(m => m.contract === tractorKey);
    if (tractorMatch) return tractorMatch;
  }

  // Prefer non-used contract for this date (avoid dedup collision)
  const available = matches.find(m => !usedForDate.has(m.contract));
  if (available) return available;

  // Last resort: first match regardless of used status
  return matches[0];
}

/**
 * Parse date from various formats
 */
function parseDate(dateStr: string): string {
  if (!dateStr) return '';

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }

  // MM/DD/YYYY format
  const mdyMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const [, month, day, year] = mdyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // DD-MMM-YYYY format (e.g., "25-Nov-2025")
  const dmmyMatch = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (dmmyMatch) {
    const [, day, monthStr, year] = dmmyMatch;
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const month = months[monthStr.toLowerCase()] || '01';
    return `${year}-${month}-${day.padStart(2, '0')}`;
  }

  return dateStr;
}

/**
 * Parse cost value from string
 */
function parseCost(costStr: string): number {
  if (!costStr) return 0;
  // Remove $ and commas, parse as float
  const cleaned = costStr.replace(/[$,]/g, '').trim();
  const value = parseFloat(cleaned);
  return isNaN(value) ? 0 : value;
}

/**
 * Main reconstruction function - deterministic, no AI
 */
export function reconstructBlocksLocally(csvData: string): {
  success: boolean;
  blocks: ReconstructedBlock[];
  error?: string;
} {
  try {
    const rows = parseCSV(csvData);

    if (rows.length === 0) {
      return { success: false, blocks: [], error: "No data rows found in CSV" };
    }

    console.log(`[Local] Parsing ${rows.length} CSV rows`);
    console.log(`[Local] Available columns: ${Object.keys(rows[0]).join(', ')}`);

    // Log all date-related columns to help debug
    const dateColumns = Object.keys(rows[0]).filter(k =>
      k.toLowerCase().includes('date') ||
      k.toLowerCase().includes('time') ||
      k.toLowerCase().includes('arrival') ||
      k.toLowerCase().includes('departure')
    );
    console.log(`[Local] Date-related columns found: ${dateColumns.join(' | ')}`);

    // Group rows by Block ID - also keep raw rows for debugging
    const blockGroups = new Map<string, TripRow[]>();
    const blockRawRows = new Map<string, Record<string, string>[]>();

    for (const row of rows) {
      const blockId = findColumn(row, ['Block ID', 'BlockID', 'Block_ID', 'block_id']);
      if (!blockId) continue;

      const trip: TripRow = {
        blockId,
        operatorId: findColumn(row, ['Operator ID', 'OperatorID', 'Operator_ID', 'operator_id']),
        driver: findColumn(row, ['Driver Name', 'Driver', 'DriverName', 'driver']),
        // Amazon CSV uses various date columns - try all possibilities
        departureDate: findColumn(row, [
          // Primary: Stop 1 departure dates (planned)
          'Stop 1  Planned Departure Date',  // Double space variant
          'Stop 1 Planned Departure Date',
          // Primary: Stop 1 departure dates (actual)
          'Stop 1 Actual Departure Date',
          'Stop 1  Actual Departure Date',
          // Fallback: Stop 1 arrival dates
          'Stop 1 Planned Arrival Date',
          'Stop 1  Planned Arrival Date',
          'Stop 1 Actual Arrival Date',
          'Stop 1  Actual Arrival Date',
          // Fallback: Stop 2 dates
          'Stop 2 Planned Arrival Date',
          'Stop 2  Planned Arrival Date',
          'Stop 2 Planned Departure Date',
          'Stop 2  Planned Departure Date',
          // Legacy column names
          'Departure Date', 'DepartureDate', 'Date'
        ]),
        // FALLBACK: Departure time used only if Stop 1 arrival time is missing
        departureTime: findColumn(row, [
          'Stop 1  Planned Departure Time',
          'Stop 1 Planned Departure Time',
          'Stop 1 Actual Departure Time',
          'Stop 1  Actual Departure Time',
          'Departure Time', 'DepartureTime'
        ]),
        // PRIMARY block start time: Stop 1 arrival time.
        // NOTE: ALL rows are processed - _d1 and _d2 suffixes in operator IDs are NOT filtered.
        // Mathew Ivy's tractor (d2-only) must be included. extractContract() strips _d1/_d2 safely.
        stop1ArrivalTime: findColumn(row, [
          'Stop 1  Planned Arrival Time',
          'Stop 1 Planned Arrival Time',
          'Stop 1 Actual Arrival Time',
          'Stop 1  Actual Arrival Time',
        ]),
        // MULTI-DAY: Capture arrival DATE for Solo2 duration calculation
        arrivalDate: findColumn(row, [
          'Stop 2  Planned Arrival Date',
          'Stop 2 Planned Arrival Date',
          'Stop 2 Actual Arrival Date',
          'Stop 2  Actual Arrival Date',
          'Arrival Date', 'ArrivalDate'
        ]),
        // FUZZY MATCHING: Capture arrival TIME for duration calculation
        arrivalTime: findColumn(row, [
          'Stop 2  Planned Arrival Time',
          'Stop 2 Planned Arrival Time',
          'Stop 2 Actual Arrival Time',
          'Stop 2  Actual Arrival Time',
          'Arrival Time', 'ArrivalTime'
        ]),
        cost: parseCost(findColumn(row, ['Estimated Cost', 'Cost', 'Total Cost', 'TotalCost'])),
        origin: findColumn(row, ['Stop 1', 'Origin', 'Origin Location']),
        destination: findColumn(row, ['Stop 2', 'Destination', 'Destination Location']),
        // Trip Stage column: "Rejected", "Upcoming", etc. - CRITICAL for RED vs YELLOW distinction
        tripStage: findColumn(row, ['Trip Stage', 'TripStage', 'Stage', 'Block Stage', 'BlockStage']),
      };

      if (!blockGroups.has(blockId)) {
        blockGroups.set(blockId, []);
        blockRawRows.set(blockId, []);
      }
      blockGroups.get(blockId)!.push(trip);
      blockRawRows.get(blockId)!.push(row);
    }

    console.log(`[Local] Found ${blockGroups.size} unique blocks`);

    // CRITICAL DEBUG: Log all unique Trip Stage values found in the CSV
    const allTripStages = new Set<string>();
    for (const trips of blockGroups.values()) {
      for (const trip of trips) {
        if (trip.tripStage) {
          allTripStages.add(trip.tripStage);
        }
      }
    }
    console.log(`[Local DEBUG] All unique Trip Stage values in CSV: ${[...allTripStages].join(', ') || '(none found)'}`);

    // Log which blocks have "Rejected" trips (if any)
    const blocksWithRejected: string[] = [];
    for (const [blockId, trips] of blockGroups) {
      const hasRejected = trips.some(t => t.tripStage.toLowerCase() === 'rejected');
      if (hasRejected) {
        blocksWithRejected.push(blockId);
      }
    }
    console.log(`[Local DEBUG] Blocks with Trip Stage = "Rejected": ${blocksWithRejected.length > 0 ? blocksWithRejected.join(', ') : '(none)'}`);

    // Debug: Log sample extracted data from first few rows
    if (blockGroups.size > 0) {
      const firstBlock = blockGroups.entries().next().value;
      if (firstBlock) {
        const [sampleBlockId, sampleTrips] = firstBlock;
        const sampleTrip = sampleTrips[0];
        console.log(`[Local] Sample data from first block:`);
        console.log(`  Block ID: ${sampleBlockId}`);
        console.log(`  Operator ID: ${sampleTrip?.operatorId}`);
        console.log(`  Contract extracted: ${extractContract(sampleTrip?.operatorId || '')}`);
        console.log(`  Departure Date: ${sampleTrip?.departureDate}`);
        console.log(`  Parsed Date: ${parseDate(sampleTrip?.departureDate || '')}`);
        console.log(`  Driver: ${sampleTrip?.driver}`);
        console.log(`  Cost: ${sampleTrip?.cost}`);
      }
    }

    // Reconstruct each block
    const blocks: ReconstructedBlock[] = [];

    // Track used tractors per date for fuzzy matching collision detection
    const usedTractorsPerDate = new Map<string, Set<string>>();

    // First pass: Process blocks WITH explicit Tractor_ pattern to mark them as used
    const blocksWithTractor: [string, TripRow[]][] = [];
    const blocksWithoutTractor: [string, TripRow[]][] = [];

    for (const [blockId, trips] of blockGroups) {
      if (trips.length === 0) continue;
      const operatorId = trips[0].operatorId;
      const hasTractorPattern = /tractor_\d+/i.test(operatorId);

      if (hasTractorPattern) {
        blocksWithTractor.push([blockId, trips]);
      } else {
        blocksWithoutTractor.push([blockId, trips]);
      }
    }

    console.log(`[Local] Blocks with explicit Tractor_: ${blocksWithTractor.length}, Blocks needing fuzzy match: ${blocksWithoutTractor.length}`);

    // First pass: pre-register blocks that have explicit Tractor_ patterns.
    // This prevents fuzzy-matched blocks from colliding with them during dedup.
    for (const [blockId, trips] of blocksWithTractor) {
      const tractorId = extractTractorId(trips[0].operatorId);

      // Determine solo type from block duration so we pre-register the correct contract.
      const sortedT = [...trips].sort((a, b) => {
        const da = parseDate(a.departureDate), db = parseDate(b.departureDate);
        if (da !== db) return da.localeCompare(db);
        return (a.departureTime || '').localeCompare(b.departureTime || '');
      });
      const first = sortedT[0];
      const last  = sortedT[sortedT.length - 1];
      const startDateParsed = parseDate(first.departureDate);
      const endDateParsed   = parseDate(last.arrivalDate) || parseDate(last.departureDate);
      const durationHours   = (startDateParsed && endDateParsed)
        ? calculateDurationWithDates(startDateParsed, first.departureTime || '00:00', endDateParsed, last.arrivalTime || '23:59')
        : 14;
      const soloType = durationHours > 20 ? 'Solo2' : 'Solo1';

      // Get block start time: min Stop 1 arrival time, fall back to first departure time
      const arrivalTimes = trips.map(t => t.stop1ArrivalTime).filter(Boolean);
      const blockStartTime = arrivalTimes.length > 0
        ? arrivalTimes.reduce((earliest, t) => timeToMinutes(t) < timeToMinutes(earliest) ? t : earliest)
        : (first.departureTime || '');

      const usedForDate = usedTractorsPerDate.get(startDateParsed) || new Set<string>();
      const match = findContractKey(blockStartTime, soloType, tractorId, usedForDate);
      const contract = match ? match.contract : extractContract(trips[0].operatorId);
      const dates = trips.map(t => parseDate(t.departureDate)).filter(d => d).sort();
      const startDate = dates[0] || '';

      if (startDate && contract) {
        if (!usedTractorsPerDate.has(startDate)) {
          usedTractorsPerDate.set(startDate, new Set());
        }
        usedTractorsPerDate.get(startDate)!.add(contract);
      }
    }

    // Now process ALL blocks (with and without Tractor_)
    for (const [blockId, trips] of blockGroups) {
      if (trips.length === 0) continue;

      // Extract contract from first trip's Operator ID
      let contract = extractContract(trips[0].operatorId);
      let canonicalStartTime: string;
      let fuzzyMatchReason = '';

      // ── NEW MATCHING LOGIC ──────────────────────────────────────────────────
      // Primary key: start time + solo type. NOT tractor ID.
      // ALL blocks processed regardless of _d1/_d2 suffix in Operator ID.
      // Bug history: _d2-only drivers (e.g. Mathew Ivy) were dropped when a
      // filter was accidentally added. This code contains NO such filter.
      // extractContract() and extractTractorId() both strip _d1/_d2 safely.

      // Step 1: Calculate block duration → Solo type
      const sortedTrips = [...trips].sort((a, b) => {
        const dateA = parseDate(a.departureDate);
        const dateB = parseDate(b.departureDate);
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (a.departureTime || '').localeCompare(b.departureTime || '');
      });
      const firstTrip = sortedTrips[0];
      const lastTrip  = sortedTrips[sortedTrips.length - 1];
      const startDateForDuration = parseDate(firstTrip.departureDate);
      const endDateForDuration   = parseDate(lastTrip.arrivalDate) || parseDate(lastTrip.departureDate);

      let durationHours = 14;
      if (startDateForDuration && endDateForDuration) {
        durationHours = calculateDurationWithDates(
          startDateForDuration, firstTrip.departureTime || '00:00',
          endDateForDuration,   lastTrip.arrivalTime   || '23:59'
        );
        console.log('[Match] Block ' + blockId + ' duration: ' + startDateForDuration + ' ' + (firstTrip.departureTime||'') + ' → ' + endDateForDuration + ' ' + (lastTrip.arrivalTime||'') + ' = ' + durationHours.toFixed(1) + 'h');
      } else if (firstTrip.departureTime && lastTrip.arrivalTime) {
        durationHours = calculateDurationHours(firstTrip.departureTime, lastTrip.arrivalTime);
      }

      // Step 2: Solo type from duration (14h = Solo1, 38h = Solo2)
      const soloType: 'Solo1' | 'Solo2' = durationHours > 20 ? 'Solo2' : 'Solo1';

      // Step 3: Block start time = min(Stop 1 arrival time) across all trips.
      // Individual delivery trips can have late times (e.g. 20:55 for a 16:30 block).
      // Using the EARLIEST Stop 1 arrival gives the real contract start time.
      // Handles "8:30" (no leading zero) and "08:30" formats via normalizeTime().
      const allStop1ArrivalTimes = trips
        .map(t => t.stop1ArrivalTime)
        .filter(t => t && timeToMinutes(t) >= 0);
      const rawBlockStartTime = allStop1ArrivalTimes.length > 0
        ? allStop1ArrivalTimes.reduce((earliest, t) =>
            timeToMinutes(t) < timeToMinutes(earliest) ? t : earliest
          )
        : (firstTrip.departureTime || '12:00');
      const normalizedStartTime = normalizeTime(rawBlockStartTime);

      // Step 4: Match contract by start time + solo type; tractor only for disambiguation
      const tractorId = extractTractorId(trips[0].operatorId);
      const dates = trips.map(t => parseDate(t.departureDate)).filter(d => d).sort();
      const startDate = dates[0] || '';
      const usedForDate = usedTractorsPerDate.get(startDate) || new Set<string>();

      const contractMatch = findContractKey(normalizedStartTime, soloType, tractorId, usedForDate);
      if (contractMatch) {
        contract = contractMatch.contract;
        canonicalStartTime = contractMatch.canonicalTime;
        fuzzyMatchReason = 'startTime+soloType';
      } else {
        // Fallback: legacy fuzzy match for unusual CSVs without Stop 1 arrival time
        const fuzzyResult = fuzzyMatchTractor(rawBlockStartTime, durationHours, startDate, usedTractorsPerDate);
        contract = fuzzyResult.contract;
        canonicalStartTime = fuzzyResult.canonicalTime;
        fuzzyMatchReason = fuzzyResult.reason + ' (FALLBACK)';
      }

      // Mark contract as used for this date
      if (startDate && contract) {
        if (!usedTractorsPerDate.has(startDate)) usedTractorsPerDate.set(startDate, new Set());
        usedTractorsPerDate.get(startDate).add(contract);
      }

      console.log('[Match] Block ' + blockId + ': ' + fuzzyMatchReason + ' | operatorId="' + trips[0].operatorId + '" soloType=' + soloType + ' startTime=' + normalizedStartTime + ' duration=' + durationHours.toFixed(1) + 'h → ' + contract + ' (' + canonicalStartTime + ')');

      // Determine duration based on contract type
      const duration = contract.toLowerCase().includes('solo2') ? '38h' : '14h';

      // Find earliest date
      const dates = trips
        .map(t => parseDate(t.departureDate))
        .filter(d => d)
        .sort();
      const startDate = dates[0] || '';

      // Debug logging for blocks with no dates
      if (!startDate) {
        console.log(`[Local] WARNING: Block ${blockId} has no valid date`);
        console.log(`  Contract: ${contract}`);
        console.log(`  Trips count: ${trips.length}`);
        console.log(`  Raw departure dates: ${trips.map(t => t.departureDate || '(empty)').join(', ')}`);
        // Dump all date column values from first raw row to find the actual date
        const rawRows = blockRawRows.get(blockId);
        if (rawRows && rawRows[0]) {
          const firstRaw = rawRows[0];
          console.log(`  All date columns in first row:`);
          for (const col of dateColumns) {
            const val = firstRaw[col];
            if (val) {
              console.log(`    "${col}" = "${val}"`);
            }
          }
        }
      }

      // Sum all costs
      const totalCost = trips.reduce((sum, t) => sum + t.cost, 0);

      // Count driver occurrences to find primary driver
      const driverCounts = new Map<string, number>();
      for (const trip of trips) {
        if (trip.driver) {
          driverCounts.set(trip.driver, (driverCounts.get(trip.driver) || 0) + 1);
        }
      }

      // Sort drivers by count
      const sortedDrivers = Array.from(driverCounts.entries())
        .sort((a, b) => b[1] - a[1]);

      const primaryDriver = sortedDrivers[0]?.[0] || '';
      const relayDrivers = sortedDrivers.slice(1).map(d => d[0]);

      // Check if ANY trip in this block has Trip Stage = "Rejected"
      // This is the CRITICAL distinction: Rejected = RED, otherwise YELLOW
      const hasRejectedTrip = trips.some(t =>
        t.tripStage.toLowerCase() === 'rejected'
      );

      // Debug: ALWAYS log if hasRejectedTrip is true (this is the critical path!)
      if (hasRejectedTrip) {
        console.log(`[Local DEBUG] Block ${blockId} has REJECTED trip!`);
        console.log(`[Local DEBUG]   Primary driver: ${primaryDriver || '(none)'}`);
        console.log(`[Local DEBUG]   Trip stages: ${trips.map(t => t.tripStage || '(empty)').join(', ')}`);
      }

      // Debug: Log blocks that have no driver detected
      if (!primaryDriver) {
        console.log(`[Local DEBUG] Block ${blockId} has NO driver. Trip count: ${trips.length}`);
        console.log(`[Local DEBUG]   Trip drivers in CSV: ${trips.map(t => t.driver || '(empty)').join(', ')}`);
        console.log(`[Local DEBUG]   Trip stages: ${trips.map(t => t.tripStage || '(empty)').join(', ')}`);
        console.log(`[Local DEBUG]   hasRejectedTrip: ${hasRejectedTrip}`);
      }

      // Build route from first and last distinct locations
      const origins = [...new Set(trips.map(t => t.origin).filter(Boolean))];
      const destinations = [...new Set(trips.map(t => t.destination).filter(Boolean))];
      const route = origins[0] && destinations[destinations.length - 1]
        ? `${origins[0]}-${destinations[destinations.length - 1]}`
        : '';

      blocks.push({
        blockId,
        contract,
        canonicalStartTime,
        startDate,
        duration,
        cost: Math.round(totalCost * 100) / 100,
        primaryDriver,
        relayDrivers,
        loadCount: trips.length,
        route,
        hasRejectedTrip,
      });
    }

    // DEDUPLICATION: Merge blocks with same contract+date into a single block
    // Rule: Only ONE block per (contract + date) combination
    // - Keep the first blockId found (for tracking)
    // - Aggregate costs and load counts
    // - Prefer driver from non-rejected blocks
    const deduped = new Map<string, ReconstructedBlock>();
    for (const block of blocks) {
      const key = `${block.contract}_${block.startDate}`;

      if (!deduped.has(key)) {
        deduped.set(key, { ...block });
      } else {
        // Merge: aggregate costs and loads, prefer driver with assignment
        const existing = deduped.get(key)!;
        existing.cost += block.cost;
        existing.loadCount += block.loadCount;

        // If existing has no driver but this one does, use this driver
        if (!existing.primaryDriver && block.primaryDriver) {
          existing.primaryDriver = block.primaryDriver;
          existing.relayDrivers = block.relayDrivers;
        }
        // Add any new relay drivers
        for (const relay of block.relayDrivers) {
          if (relay && !existing.relayDrivers.includes(relay) && relay !== existing.primaryDriver) {
            existing.relayDrivers.push(relay);
          }
        }
        // If any merged block has rejected trip, mark the merged block as rejected
        if (block.hasRejectedTrip) {
          existing.hasRejectedTrip = true;
        }

        console.log(`[Local DEDUP] Merged block ${block.blockId} into ${existing.blockId} for ${key}`);
      }
    }

    const dedupedBlocks = Array.from(deduped.values());
    console.log(`[Local] Deduplicated: ${blocks.length} blocks → ${dedupedBlocks.length} unique contract+date combinations`);

    // Sort blocks by date then by block ID
    dedupedBlocks.sort((a, b) => {
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;
      return a.blockId.localeCompare(b.blockId);
    });

    console.log(`[Local] Reconstructed ${dedupedBlocks.length} blocks (from ${blocks.length} raw blocks)`);

    // Debug: Log how many blocks have drivers
    const blocksWithDrivers = dedupedBlocks.filter(b => b.primaryDriver);
    const blocksWithoutDrivers = dedupedBlocks.filter(b => !b.primaryDriver);
    const rejectedBlocks = dedupedBlocks.filter(b => b.hasRejectedTrip);
    const unassignedBlocks = blocksWithoutDrivers.filter(b => !b.hasRejectedTrip);

    console.log(`[Local] Blocks with drivers: ${blocksWithDrivers.length}, Blocks without drivers: ${blocksWithoutDrivers.length}`);
    console.log(`[Local] REJECTED blocks (Trip Stage=Rejected): ${rejectedBlocks.length} → will be RED`);
    console.log(`[Local] UNASSIGNED blocks (no driver, not rejected): ${unassignedBlocks.length} → will be YELLOW`);

    // Log first few blocks with drivers
    console.log(`[Local] Sample blocks WITH drivers:`, blocksWithDrivers.slice(0, 5).map(b => ({
      blockId: b.blockId,
      primaryDriver: b.primaryDriver
    })));

    // Log first few rejected blocks
    if (rejectedBlocks.length > 0) {
      console.log(`[Local] Sample REJECTED blocks:`, rejectedBlocks.slice(0, 5).map(b => ({
        blockId: b.blockId,
        contract: b.contract,
        startDate: b.startDate,
        hasRejectedTrip: b.hasRejectedTrip
      })));
    }

    // Log first few unassigned (not rejected) blocks
    if (unassignedBlocks.length > 0) {
      console.log(`[Local] Sample UNASSIGNED (not rejected) blocks:`, unassignedBlocks.slice(0, 5).map(b => ({
        blockId: b.blockId,
        contract: b.contract,
        startDate: b.startDate
      })));
    }

    return {
      success: true,
      blocks: dedupedBlocks,
    };
  } catch (error) {
    console.error('[Local] Reconstruction error:', error);
    return {
      success: false,
      blocks: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
