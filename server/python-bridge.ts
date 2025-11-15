import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface PythonResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: string;
}

export async function runPythonScript<T = any>(
  scriptName: string,
  args: string[] = []
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

    const pythonProcess = spawn('python3', [scriptPath, ...args]);
    
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
  return runPythonScript('assignment_predictor.py', [jsonInput]);
}

export async function analyzeCoverage(input: {
  action: 'analyze_coverage';
  schedule: any[];
  date_range: any;
  historical?: any[];
}): Promise<PythonResult<{ analysis: CoverageAnalysis }>> {
  const jsonInput = JSON.stringify(input);
  return runPythonScript('assignment_predictor.py', [jsonInput]);
}
