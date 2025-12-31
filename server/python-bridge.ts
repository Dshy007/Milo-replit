import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface PythonResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: string;
}

/**
 * Get the Python executable path for the current platform
 */
function getPythonCommand(): string {
  if (process.platform === 'win32') {
    // Windows: Try common Python install locations
    const windowsPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310', 'python.exe'),
      'C:\\Python312\\python.exe',
      'C:\\Python311\\python.exe',
      'python', // Fall back to PATH
    ];

    for (const pythonPath of windowsPaths) {
      if (fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    }
    return 'python'; // Last resort
  }

  // Unix/Mac: Use python3
  return 'python3';
}

export async function runPythonScript<T = any>(
  scriptName: string,
  args: string[] = [],
  stdinData?: string
): Promise<PythonResult<T>> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'python', scriptName);

    if (!fs.existsSync(scriptPath)) {
      resolve({
        success: false,
        error: `Python script not found: ${scriptPath}`,
        errorType: 'FileNotFound'
      });
      return;
    }

    const pythonCommand = getPythonCommand();
    console.log(`[Python Bridge] Running: ${pythonCommand} ${scriptPath}${stdinData ? ' (with stdin data)' : ''}`);

    // Only pass args if no stdinData (for large payloads, use stdin)
    const pythonProcess = spawn(pythonCommand, [scriptPath, ...(stdinData ? [] : args)]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: stderr || `Python process exited with code ${code}`,
          errorType: 'ProcessError'
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          success: result.success !== false,
          data: result
        });
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse Python output: ${stdout}`,
          errorType: 'ParseError'
        });
      }
    });

    pythonProcess.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        errorType: 'SpawnError'
      });
    });

    // Write stdin data if provided
    if (stdinData) {
      pythonProcess.stdin.write(stdinData);
      pythonProcess.stdin.end();
    }
  });
}

export interface ExcelParseResult {
  success: boolean;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  rows: Array<{
    row_number: number;
    valid: boolean;
    errors: string[];
    warnings: string[];
    data: {
      blockId: string;
      driverName: string;
      operatorId: string;
      site: string;
      contractType: string;
      tractor: string;
      stop1Arrival: string;
      stop1Departure: string;
      stop1ArrivalTime: string;
      stop1DepartureTime: string;
      stop2Arrival?: string;
      stop2Departure?: string;
      stop2ArrivalTime?: string;
      stop2DepartureTime?: string;
    };
  }>;
  summary: {
    contract_types: Record<string, number>;
    tractors: string[];
    drivers: string[];
    date_range: any;
  };
  error?: string;
}

export async function parseExcelFile(filePath: string): Promise<PythonResult<ExcelParseResult>> {
  return runPythonScript<ExcelParseResult>('excel_parser.py', [filePath]);
}

export interface AssignmentRecommendation {
  block_id: string;
  contract_type: string;
  shift_start: string;
  shift_end: string;
  recommendations: Array<{
    driver_id: string;
    driver_name: string;
    score: number;
    reasons: string[];
    availability: {
      available: boolean;
      reason: string;
      compliance_score: number;
      rest_hours: number;
      next_available: string;
    };
  }>;
}

export interface CoverageAnalysis {
  coverage_percentage: number;
  total_slots: number;
  filled_slots: number;
  gaps: Array<{
    block_id: string;
    date: string;
    contract_type: string;
    priority: string;
  }>;
  overstaffed: any[];
  recommendations: string[];
}

export async function predictAssignments(input: {
  action: 'predict';
  blocks: any[];
  drivers: any[];
  constraints?: any;
  historical?: any[];
}): Promise<PythonResult<{ recommendations: AssignmentRecommendation[] }>> {
  const jsonInput = JSON.stringify(input);
  // Use stdin for large payloads to avoid ENAMETOOLONG error on Windows
  return runPythonScript('assignment_predictor.py', [], jsonInput);
}

export async function analyzeCoverage(input: {
  action: 'analyze_coverage';
  schedule: any[];
  date_range: any;
  historical?: any[];
}): Promise<PythonResult<{ analysis: CoverageAnalysis }>> {
  const jsonInput = JSON.stringify(input);
  // Use stdin for large payloads to avoid ENAMETOOLONG error on Windows
  return runPythonScript('assignment_predictor.py', [], jsonInput);
}

// ============================================================================
// Vector Store (ChromaDB) Functions
// ============================================================================

export interface VectorStoreStats {
  patterns_count: number;
  blocks_count: number;
  drivers_count: number;
}

export interface VectorMatch {
  id: string;
  document: string;
  metadata: Record<string, any>;
  distance: number | null;
}

export async function getVectorStoreStats(): Promise<PythonResult<{ stats: VectorStoreStats }>> {
  return runPythonScript('vector_store.py', [], JSON.stringify({ action: 'stats' }));
}

export async function bulkImportToVectorStore(records: any[]): Promise<PythonResult<{
  result: {
    added: number;
    skipped: number;
    errors: number;
    total: number;
  };
}>> {
  return runPythonScript('vector_store.py', [], JSON.stringify({
    action: 'bulk_import',
    records
  }));
}

export async function findSimilarAssignments(params: {
  block_id?: string;
  day_of_week?: number;
  start_time?: string;
  contract_type?: string;
  n_results?: number;
}): Promise<PythonResult<{ matches: VectorMatch[] }>> {
  return runPythonScript('vector_store.py', [], JSON.stringify({
    action: 'find_similar',
    ...params
  }));
}

export async function getDriverVectorHistory(driverId: string): Promise<PythonResult<{ history: VectorMatch[] }>> {
  return runPythonScript('vector_store.py', [], JSON.stringify({
    action: 'driver_history',
    driver_id: driverId
  }));
}

export async function resetVectorStore(): Promise<PythonResult<{ message: string }>> {
  return runPythonScript('vector_store.py', [], JSON.stringify({ action: 'reset' }));
}

// ============================================================================
// XGBoost Ownership Model Functions
// ============================================================================

export interface SlotDistribution {
  slot_type: 'owned' | 'rotating' | 'unknown';
  owner: string | null;
  owner_share: number;
  shares: Record<string, number>;
  total_assignments: number;
  slot?: string;
}

export interface DriverPattern {
  driver: string;
  typical_days: number;
  day_list: string[];
  day_counts: Record<string, number>;
  confidence: number;
}

/**
 * Get ownership distribution for a slot from XGBoost model.
 * Returns who owns the slot and their share percentage.
 */
export async function getSlotDistribution(params: {
  soloType: string;
  tractorId: string;
  dayOfWeek: number;
  canonicalTime?: string;
}): Promise<PythonResult<SlotDistribution>> {
  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'get_distribution',
    soloType: params.soloType,
    tractorId: params.tractorId,
    dayOfWeek: params.dayOfWeek,
    canonicalTime: params.canonicalTime
  }));
}

/**
 * Get ownership distributions for MULTIPLE slots in a SINGLE Python call.
 * PERFORMANCE: Loads model once, returns all distributions in one subprocess.
 *
 * @param slots - Array of slot parameters to query
 * @returns Map of cacheKey -> SlotDistribution
 */
export async function getBatchSlotDistributions(slots: Array<{
  soloType: string;
  tractorId: string;
  dayOfWeek: number;
  canonicalTime?: string;
}>): Promise<PythonResult<{ distributions: Record<string, SlotDistribution>; count: number }>> {
  console.log(`[Python Bridge] Batch loading ${slots.length} slot distributions`);
  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'batch_get_distributions',
    slots
  }));
}

/**
 * Get a driver's typical work pattern from XGBoost model.
 * Returns how many days they typically work and which days.
 */
export async function getDriverPattern(driverName: string): Promise<PythonResult<DriverPattern>> {
  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'get_driver_pattern',
    driverName
  }));
}

/**
 * Get patterns for all drivers at once.
 */
export async function getAllDriverPatterns(): Promise<PythonResult<{
  patterns: Record<string, DriverPattern>;
  count: number;
}>> {
  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'get_all_patterns'
  }));
}

/**
 * Predict slot owner using XGBoost model.
 */
export async function predictSlotOwner(params: {
  soloType: string;
  tractorId: string;
  dayOfWeek: number;
  canonicalTime?: string;
}): Promise<PythonResult<{
  driver: string;
  confidence: number;
  slot: string;
}>> {
  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'predict',
    soloType: params.soloType,
    tractorId: params.tractorId,
    dayOfWeek: params.dayOfWeek,
    canonicalTime: params.canonicalTime
  }));
}

// ============================================================
// AVAILABILITY MODEL FUNCTIONS
// ============================================================

export interface DriverHistoryItem {
  serviceDate: string;
  soloType?: string;
  tractorId?: string;
}

export interface BatchAffinityResult {
  // Affinity scores (pattern strength), NOT predictions
  // Key: driverId -> slotKey -> affinity score (0.0-1.0)
  predictions: Record<string, Record<string, number>>; // 'predictions' kept for backward compat
  driverCount: number;
  blockCount: number;
  totalPredictions: number;
}

// Backward compatibility alias
export type BatchAvailabilityResult = BatchAffinityResult;

export interface BlockSlotInfo {
  date: string;
  soloType: string;
  tractorId: string;
}

/**
 * Score slot PATTERN AFFINITY for ALL drivers × ALL blocks.
 *
 * This is PATTERN MATCHING, not prediction.
 * Question answered: "How well does Solo1_Tractor_1_Monday match Driver X's historical pattern?"
 * NOT: "Will Driver X work this slot?" (we don't predict the future)
 *
 * @param drivers - Array of {id, name, history} for each driver (history must include soloType, tractorId)
 * @param blocks - Array of {date, soloType, tractorId} to score
 * @returns Affinity scores: driverId -> "soloType|tractorId|date" -> score (0.0-1.0)
 *          1.0 = Strong historical match (driver frequently worked this exact slot)
 *          0.0 = No historical match (driver never worked this slot)
 */
export async function getBatchSlotAffinity(
  drivers: Array<{
    id: string;
    name: string;
    history: DriverHistoryItem[];
  }>,
  blocks: BlockSlotInfo[]
): Promise<PythonResult<BatchAffinityResult>> {
  console.log(`[Python Bridge] Scoring pattern affinity for ${drivers.length} drivers × ${blocks.length} slots`);

  return runPythonScript('xgboost_availability.py', [], JSON.stringify({
    action: 'batch_predict',
    drivers: drivers.map(d => ({
      id: d.id,
      name: d.name,
      history: d.history
    })),
    blocks
  }));
}

// Backward compatibility alias
export const getBatchSlotAvailability = getBatchSlotAffinity;

/**
 * DEPRECATED: Use getBatchSlotAffinity for slot-aware pattern matching.
 */
export async function getBatchAvailability(
  drivers: Array<{
    id: string;
    name: string;
    history: DriverHistoryItem[];
  }>,
  dates: string[]
): Promise<PythonResult<BatchAffinityResult>> {
  console.log(`[Python Bridge] WARNING: getBatchAvailability is deprecated. Use getBatchSlotAffinity.`);

  const blocks: BlockSlotInfo[] = dates.map(date => ({
    date,
    soloType: 'solo1',
    tractorId: 'Tractor_1'
  }));

  return getBatchSlotAffinity(drivers, blocks);
}

/**
 * Get availability prediction for a single driver on a single date.
 * Use getBatchAvailability() for multiple predictions - it's faster.
 */
export async function getDriverAvailability(
  driverId: string,
  date: string,
  history: DriverHistoryItem[]
): Promise<PythonResult<{ probability: number }>> {
  return runPythonScript('xgboost_availability.py', [], JSON.stringify({
    action: 'predict',
    driverId,
    date,
    history
  }));
}

// ============================================================================
// XGBoost Training Functions
// ============================================================================

export interface TrainingAssignment {
  driverId: string;
  driverName: string;
  soloType: string;
  tractorId: string;
  dayOfWeek: number;
  serviceDate: string;
  startTime?: string;
}

export interface TrainingResult {
  success: boolean;
  message?: string;
  accuracy?: number;
  samples?: number;
  drivers?: number;
  slots?: number;
}

/**
 * Train the XGBoost Ownership model with historical assignments.
 * This teaches the model who typically works each slot (soloType + tractor + day + time).
 *
 * @param assignments - Array of historical block assignments
 * @returns Training result with accuracy metrics
 */
export async function trainOwnershipModel(
  assignments: TrainingAssignment[]
): Promise<PythonResult<TrainingResult>> {
  console.log(`[Python Bridge] Training ownership model with ${assignments.length} assignments`);

  return runPythonScript('xgboost_ownership.py', [], JSON.stringify({
    action: 'train',
    assignments
  }));
}

/**
 * Train the XGBoost Availability model with driver histories.
 * This teaches the model which days each driver typically works.
 *
 * @param driverHistories - Map of driverId to their assignment history
 * @returns Training result with accuracy metrics
 */
export async function trainAvailabilityModel(
  driverHistories: Record<string, DriverHistoryItem[]>
): Promise<PythonResult<TrainingResult>> {
  console.log(`[Python Bridge] Training availability model with ${Object.keys(driverHistories).length} drivers`);

  return runPythonScript('xgboost_availability.py', [], JSON.stringify({
    action: 'train',
    histories: driverHistories
  }));
}

/**
 * Train BOTH XGBoost models (ownership + availability) with historical data.
 * Call this when user clicks "Re-analyze" to refresh all patterns.
 *
 * @param assignments - Historical block assignments for ownership model
 * @param driverHistories - Driver histories for availability model
 * @returns Combined training results
 */
export async function trainAllModels(
  assignments: TrainingAssignment[],
  driverHistories: Record<string, DriverHistoryItem[]>
): Promise<{
  ownership: PythonResult<TrainingResult>;
  availability: PythonResult<TrainingResult>;
}> {
  console.log(`[Python Bridge] Training ALL models: ${assignments.length} assignments, ${Object.keys(driverHistories).length} drivers`);

  // Train both models in parallel
  const [ownershipResult, availabilityResult] = await Promise.all([
    trainOwnershipModel(assignments),
    trainAvailabilityModel(driverHistories)
  ]);

  return {
    ownership: ownershipResult,
    availability: availabilityResult
  };
}
