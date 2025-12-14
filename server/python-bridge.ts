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
