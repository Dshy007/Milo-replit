/**
 * Robust Statistical Analysis & Predictive Analytics
 * 
 * Provides safe statistical calculations and predictive models that
 * gracefully handle mixed data types and invalid values.
 */

import {
  cleanNumericArray,
  calculateStats,
  safeDivide,
  safeAverage,
  detectType,
  convertValue,
  type ColumnStats,
  type DataType,
} from "./data-cleaner";

/**
 * Regression analysis result
 */
export interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  predictions: number[];
  residuals: number[];
  isReliable: boolean;
  warnings: string[];
}

/**
 * Time series forecast result
 */
export interface ForecastResult {
  forecasts: number[];
  confidence: {
    lower: number[];
    upper: number[];
  };
  trend: "increasing" | "decreasing" | "stable";
  reliability: number; // 0-1
  warnings: string[];
}

/**
 * Dataset quality assessment
 */
export interface DataQuality {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  completeness: number; // 0-1
  numericColumns: string[];
  categoricalColumns: string[];
  dateColumns: string[];
  issues: Array<{
    column: string;
    issue: string;
    severity: "low" | "medium" | "high";
  }>;
}

/**
 * Calculate linear regression on clean numeric data
 * Automatically filters out invalid values
 */
export function calculateLinearRegression(
  xValues: unknown[],
  yValues: unknown[]
): RegressionResult {
  const warnings: string[] = [];

  // Clean input data
  const xCleaned = cleanNumericArray(xValues);
  const yCleaned = cleanNumericArray(yValues);

  if (xCleaned.invalidValues.length > 0) {
    warnings.push(`Filtered ${xCleaned.invalidValues.length} invalid X values`);
  }
  if (yCleaned.invalidValues.length > 0) {
    warnings.push(`Filtered ${yCleaned.invalidValues.length} invalid Y values`);
  }

  // Ensure equal lengths
  const minLength = Math.min(xCleaned.cleanValues.length, yCleaned.cleanValues.length);
  const x = xCleaned.cleanValues.slice(0, minLength);
  const y = yCleaned.cleanValues.slice(0, minLength);

  if (x.length < 2) {
    warnings.push("Insufficient data points for regression (need at least 2)");
    return {
      slope: 0,
      intercept: 0,
      rSquared: 0,
      predictions: [],
      residuals: [],
      isReliable: false,
      warnings,
    };
  }

  // Calculate means
  const xMean = x.reduce((sum, val) => sum + val, 0) / x.length;
  const yMean = y.reduce((sum, val) => sum + val, 0) / y.length;

  // Calculate slope and intercept
  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < x.length; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean);
    denominator += Math.pow(x[i] - xMean, 2);
  }

  const slope = safeDivide(numerator, denominator, 0);
  const intercept = yMean - slope * xMean;

  // Calculate predictions and residuals
  const predictions = x.map(xi => slope * xi + intercept);
  const residuals = y.map((yi, i) => yi - predictions[i]);

  // Calculate R-squared
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const ssResidual = residuals.reduce((sum, r) => sum + Math.pow(r, 2), 0);
  const rSquared = safeDivide(ssTotal - ssResidual, ssTotal, 0);

  // Determine reliability
  const isReliable = x.length >= 5 && rSquared > 0.5;
  if (!isReliable) {
    if (x.length < 5) {
      warnings.push("Low sample size may affect reliability");
    }
    if (rSquared <= 0.5) {
      warnings.push(`Low R² (${rSquared.toFixed(2)}) indicates weak correlation`);
    }
  }

  return {
    slope,
    intercept,
    rSquared,
    predictions,
    residuals,
    isReliable,
    warnings,
  };
}

/**
 * Simple moving average forecast
 * Automatically handles invalid values
 */
export function forecastMovingAverage(
  values: unknown[],
  periods: number = 3,
  forecastSteps: number = 1
): ForecastResult {
  const warnings: string[] = [];
  const { cleanValues, invalidValues } = cleanNumericArray(values);

  if (invalidValues.length > 0) {
    warnings.push(`Filtered ${invalidValues.length} invalid values before forecasting`);
  }

  if (cleanValues.length < periods) {
    warnings.push(`Insufficient data (${cleanValues.length} values, need ${periods})`);
    return {
      forecasts: [],
      confidence: { lower: [], upper: [] },
      trend: "stable",
      reliability: 0,
      warnings,
    };
  }

  const forecasts: number[] = [];
  const workingData = [...cleanValues];

  // Generate forecasts
  for (let step = 0; step < forecastSteps; step++) {
    const window = workingData.slice(-periods);
    const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
    forecasts.push(avg);
    workingData.push(avg); // Add forecast to working data for next iteration
  }

  // Calculate confidence intervals (simple standard deviation based)
  const recentValues = cleanValues.slice(-periods * 2);
  const stdDev = Math.sqrt(
    recentValues.reduce((sum, val) => {
      const mean = recentValues.reduce((s, v) => s + v, 0) / recentValues.length;
      return sum + Math.pow(val - mean, 2);
    }, 0) / recentValues.length
  );

  const confidence = {
    lower: forecasts.map(f => f - 1.96 * stdDev), // 95% confidence
    upper: forecasts.map(f => f + 1.96 * stdDev),
  };

  // Determine trend
  const firstHalf = cleanValues.slice(0, Math.floor(cleanValues.length / 2));
  const secondHalf = cleanValues.slice(Math.floor(cleanValues.length / 2));
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  let trend: "increasing" | "decreasing" | "stable";
  if (secondAvg > firstAvg * 1.1) {
    trend = "increasing";
  } else if (secondAvg < firstAvg * 0.9) {
    trend = "decreasing";
  } else {
    trend = "stable";
  }

  // Calculate reliability (based on data quality and consistency)
  const dataQuality = cleanValues.length / values.length;
  const consistency = Math.max(0, 1 - (stdDev / Math.abs(safeAverage(cleanValues, 1))));
  const reliability = (dataQuality + consistency) / 2;

  if (reliability < 0.7) {
    warnings.push(`Low reliability (${(reliability * 100).toFixed(0)}%) due to data quality or high variability`);
  }

  return {
    forecasts,
    confidence,
    trend,
    reliability,
    warnings,
  };
}

/**
 * Assess overall data quality of a dataset
 */
export function assessDataQuality<T extends Record<string, unknown>>(
  data: T[]
): DataQuality {
  if (data.length === 0) {
    return {
      totalRows: 0,
      validRows: 0,
      invalidRows: 0,
      completeness: 0,
      numericColumns: [],
      categoricalColumns: [],
      dateColumns: [],
      issues: [],
    };
  }

  const columns = Object.keys(data[0]) as (keyof T)[];
  const numericColumns: string[] = [];
  const categoricalColumns: string[] = [];
  const dateColumns: string[] = [];
  const issues: Array<{ column: string; issue: string; severity: "low" | "medium" | "high" }> = [];

  let totalValidCells = 0;
  let totalCells = data.length * columns.length;

  // Analyze each column
  for (const col of columns) {
    const columnValues = data.map(row => row[col]);
    const typeResults = columnValues.map(val => detectType(val));

    // Count types
    const typeCounts: Record<DataType, number> = {
      number: 0,
      string: 0,
      boolean: 0,
      date: 0,
      null: 0,
      invalid: 0,
    };

    typeResults.forEach(type => {
      typeCounts[type]++;
    });

    // Classify column
    const nonNullCount = data.length - typeCounts.null - typeCounts.invalid;
    if (nonNullCount === 0) {
      issues.push({
        column: String(col),
        issue: "Column contains only null/invalid values",
        severity: "high",
      });
      continue;
    }

    const numberRatio = typeCounts.number / nonNullCount;
    const stringRatio = typeCounts.string / nonNullCount;
    const dateRatio = typeCounts.date / nonNullCount;

    if (numberRatio > 0.8) {
      numericColumns.push(String(col));
      totalValidCells += typeCounts.number;

      if (numberRatio < 1) {
        issues.push({
          column: String(col),
          issue: `${((1 - numberRatio) * 100).toFixed(0)}% of values are not numeric`,
          severity: numberRatio > 0.9 ? "low" : "medium",
        });
      }
    } else if (dateRatio > 0.8) {
      dateColumns.push(String(col));
      totalValidCells += typeCounts.date;
    } else {
      categoricalColumns.push(String(col));
      totalValidCells += typeCounts.string;

      if (typeCounts.invalid > 0 || typeCounts.null > data.length * 0.5) {
        issues.push({
          column: String(col),
          issue: "High rate of missing/invalid values",
          severity: "medium",
        });
      }
    }

    // Check for mixed types
    const nonNullTypes = Object.entries(typeCounts)
      .filter(([type]) => type !== "null" && type !== "invalid")
      .filter(([, count]) => count > 0);

    if (nonNullTypes.length > 1) {
      issues.push({
        column: String(col),
        issue: `Mixed data types detected (${nonNullTypes.map(([t]) => t).join(", ")})`,
        severity: "medium",
      });
    }
  }

  const completeness = totalValidCells / totalCells;

  // Count valid rows (rows with no null/invalid values in any column)
  let validRows = 0;
  for (const row of data) {
    const hasInvalidCell = columns.some(col => {
      const type = detectType(row[col]);
      return type === "null" || type === "invalid";
    });
    if (!hasInvalidCell) {
      validRows++;
    }
  }

  return {
    totalRows: data.length,
    validRows,
    invalidRows: data.length - validRows,
    completeness,
    numericColumns,
    categoricalColumns,
    dateColumns,
    issues,
  };
}

/**
 * Calculate percentile from numeric data
 */
export function calculatePercentile(values: unknown[], percentile: number): number | null {
  const { cleanValues } = cleanNumericArray(values);

  if (cleanValues.length === 0) {
    return null;
  }

  const sorted = [...cleanValues].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate correlation coefficient between two variables
 */
export function calculateCorrelation(xValues: unknown[], yValues: unknown[]): {
  correlation: number;
  isSignificant: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const xCleaned = cleanNumericArray(xValues);
  const yCleaned = cleanNumericArray(yValues);

  if (xCleaned.invalidValues.length > 0 || yCleaned.invalidValues.length > 0) {
    warnings.push("Filtered invalid values before correlation analysis");
  }

  const minLength = Math.min(xCleaned.cleanValues.length, yCleaned.cleanValues.length);
  if (minLength < 3) {
    warnings.push("Insufficient data for correlation (need at least 3 pairs)");
    return { correlation: 0, isSignificant: false, warnings };
  }

  const x = xCleaned.cleanValues.slice(0, minLength);
  const y = yCleaned.cleanValues.slice(0, minLength);

  const xMean = x.reduce((sum, val) => sum + val, 0) / x.length;
  const yMean = y.reduce((sum, val) => sum + val, 0) / y.length;

  let numerator = 0;
  let xDenom = 0;
  let yDenom = 0;

  for (let i = 0; i < x.length; i++) {
    const xDiff = x[i] - xMean;
    const yDiff = y[i] - yMean;
    numerator += xDiff * yDiff;
    xDenom += xDiff * xDiff;
    yDenom += yDiff * yDiff;
  }

  const correlation = safeDivide(numerator, Math.sqrt(xDenom * yDenom), 0);

  // Simple significance test (|r| > 0.5 with n > 10)
  const isSignificant = Math.abs(correlation) > 0.5 && x.length > 10;

  if (!isSignificant && x.length <= 10) {
    warnings.push("Small sample size may affect significance");
  }

  return { correlation, isSignificant, warnings };
}

/**
 * Export summary statistics for a column
 */
export function summarizeColumn(values: unknown[]): ColumnStats & {
  percentile25: number | null;
  percentile75: number | null;
  iqr: number | null;
} {
  const stats = calculateStats(values);
  const p25 = calculatePercentile(values, 25);
  const p75 = calculatePercentile(values, 75);
  const iqr = p25 !== null && p75 !== null ? p75 - p25 : null;

  return {
    ...stats,
    percentile25: p25,
    percentile75: p75,
    iqr,
  };
}
