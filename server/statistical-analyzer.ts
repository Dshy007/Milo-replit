/**
 * Statistical Analyzer - DISABLED
 *
 * Original file moved to: server/disabled/statistical-analyzer.ts.bak
 * Reason: Replacing custom pattern recognition with scikit-learn
 * See: PLAN-bolt-on-scheduler.md
 */

// Re-export types from data-cleaner that other files depend on
export { type ColumnStats, type DataType } from "./data-cleaner";

export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predictions: number[];
  residuals: number[];
  isReliable: boolean;
  warnings: string[];
}

export interface ForecastResult {
  forecasts: number[];
  confidence: {
    lower: number[];
    upper: number[];
  };
  trend: "increasing" | "decreasing" | "stable";
  reliability: number;
  warnings: string[];
}

export interface DataQuality {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  completeness: number;
  numericColumns: string[];
  categoricalColumns: string[];
  dateColumns: string[];
  issues: Array<{
    column: string;
    issue: string;
    severity: "low" | "medium" | "high";
  }>;
}

// Stub implementations
export function calculateLinearRegression(xValues: unknown[], yValues: unknown[]): RegressionResult {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return {
    slope: 0,
    intercept: 0,
    rSquared: 0,
    predictions: [],
    residuals: [],
    isReliable: false,
    warnings: ["Statistical Analyzer disabled - pending sklearn replacement"],
  };
}

export function forecastMovingAverage(
  values: unknown[],
  periods: number = 3,
  forecastSteps: number = 1
): ForecastResult {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return {
    forecasts: [],
    confidence: { lower: [], upper: [] },
    trend: "stable",
    reliability: 0,
    warnings: ["Statistical Analyzer disabled - pending sklearn replacement"],
  };
}

export function assessDataQuality<T extends Record<string, unknown>>(data: T[]): DataQuality {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return {
    totalRows: data.length,
    validRows: 0,
    invalidRows: data.length,
    completeness: 0,
    numericColumns: [],
    categoricalColumns: [],
    dateColumns: [],
    issues: [{ column: "*", issue: "Statistical Analyzer disabled", severity: "high" }],
  };
}

export function calculatePercentile(values: unknown[], percentile: number): number | null {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return null;
}

export function calculateCorrelation(xValues: unknown[], yValues: unknown[]): {
  correlation: number;
  isSignificant: boolean;
  warnings: string[];
} {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return {
    correlation: 0,
    isSignificant: false,
    warnings: ["Statistical Analyzer disabled - pending sklearn replacement"],
  };
}

export function summarizeColumn(values: unknown[]): any {
  console.warn("[Statistical Analyzer] DISABLED - pending sklearn replacement");
  return {
    count: 0,
    nullCount: values.length,
    mean: null,
    median: null,
    min: null,
    max: null,
    stdDev: null,
    percentile25: null,
    percentile75: null,
    iqr: null,
  };
}
