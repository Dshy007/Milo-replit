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
}

interface TripRow {
  blockId: string;
  operatorId: string;
  driver: string;
  departureDate: string;
  cost: number;
  origin: string;
  destination: string;
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
 */
function extractContract(operatorId: string): string {
  // Match Solo1_Tractor_N or Solo2_Tractor_N pattern
  const match = operatorId.match(/(Solo[12]_Tractor_\d+)/i);
  if (match) {
    return match[1];
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
        cost: parseCost(findColumn(row, ['Estimated Cost', 'Cost', 'Total Cost', 'TotalCost'])),
        origin: findColumn(row, ['Stop 1', 'Origin', 'Origin Location']),
        destination: findColumn(row, ['Stop 2', 'Destination', 'Destination Location']),
      };

      if (!blockGroups.has(blockId)) {
        blockGroups.set(blockId, []);
        blockRawRows.set(blockId, []);
      }
      blockGroups.get(blockId)!.push(trip);
      blockRawRows.get(blockId)!.push(row);
    }

    console.log(`[Local] Found ${blockGroups.size} unique blocks`);

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

    for (const [blockId, trips] of blockGroups) {
      if (trips.length === 0) continue;

      // Extract contract from first trip's Operator ID
      const contract = extractContract(trips[0].operatorId);

      // Look up canonical start time
      const canonicalStartTime = CANONICAL_START_TIMES[contract] || '00:00';

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
      });
    }

    // Sort blocks by date then by block ID
    blocks.sort((a, b) => {
      const dateCompare = a.startDate.localeCompare(b.startDate);
      if (dateCompare !== 0) return dateCompare;
      return a.blockId.localeCompare(b.blockId);
    });

    console.log(`[Local] Reconstructed ${blocks.length} blocks`);

    return {
      success: true,
      blocks,
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
