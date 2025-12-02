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
  departureTime: string;  // For fuzzy matching
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
        // FUZZY MATCHING: Capture departure TIME for time-based tractor matching
        departureTime: findColumn(row, [
          'Stop 1  Planned Departure Time',
          'Stop 1 Planned Departure Time',
          'Stop 1 Actual Departure Time',
          'Stop 1  Actual Departure Time',
          'Departure Time', 'DepartureTime'
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

    // Process blocks WITH Tractor_ first (they claim their slots)
    for (const [blockId, trips] of blocksWithTractor) {
      const contract = extractContract(trips[0].operatorId);
      const dates = trips.map(t => parseDate(t.departureDate)).filter(d => d).sort();
      const startDate = dates[0] || '';

      // Mark this tractor as used for this date
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

      // Check if contract lookup succeeds (has Tractor_ pattern)
      const hasTractorPattern = /tractor_\d+/i.test(trips[0].operatorId);

      if (hasTractorPattern && CANONICAL_START_TIMES[contract]) {
        // Direct lookup succeeded
        canonicalStartTime = CANONICAL_START_TIMES[contract];
      } else {
        // FUZZY MATCHING: No Tractor_ pattern in Operator ID
        // Use departure time and duration to find best matching tractor

        // Get earliest departure time and latest arrival time for duration calculation
        const departureTimes = trips.map(t => t.departureTime).filter(Boolean);
        const arrivalTimes = trips.map(t => t.arrivalTime).filter(Boolean);

        // Get first departure time (earliest trip start)
        const blockDepartureTime = departureTimes[0] || '12:00'; // Default to noon if no time found

        // Calculate duration from times, or estimate from trip count
        let durationHours = 14; // Default to Solo1 duration
        if (departureTimes[0] && arrivalTimes[arrivalTimes.length - 1]) {
          durationHours = calculateDurationHours(departureTimes[0], arrivalTimes[arrivalTimes.length - 1]);
        } else {
          // Estimate: more trips usually means longer route
          durationHours = trips.length > 3 ? 20 : 14;
        }

        // Get the date for collision tracking
        const dates = trips.map(t => parseDate(t.departureDate)).filter(d => d).sort();
        const startDate = dates[0] || '';

        // Perform fuzzy match
        const fuzzyResult = fuzzyMatchTractor(blockDepartureTime, durationHours, startDate, usedTractorsPerDate);
        contract = fuzzyResult.contract;
        canonicalStartTime = fuzzyResult.canonicalTime;
        fuzzyMatchReason = fuzzyResult.reason;

        // Mark this tractor as now used for this date
        if (startDate) {
          if (!usedTractorsPerDate.has(startDate)) {
            usedTractorsPerDate.set(startDate, new Set());
          }
          usedTractorsPerDate.get(startDate)!.add(contract);
        }

        console.log(`[FUZZY] Block ${blockId}: ${fuzzyMatchReason}`);
        console.log(`[FUZZY]   Operator ID was: "${trips[0].operatorId}"`);
        console.log(`[FUZZY]   Departure time: ${blockDepartureTime}, Duration: ${durationHours.toFixed(1)}h`);
        console.log(`[FUZZY]   Assigned to: ${contract} (${canonicalStartTime})`);
      }

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
