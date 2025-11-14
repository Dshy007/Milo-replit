/**
 * Smart Data Cleaning & Type Conversion Utilities
 * 
 * Provides robust data cleaning, type detection, validation, and statistical
 * calculations for Excel imports and analytics pipelines.
 */

/**
 * Data type classification
 */
export type DataType = 
  | "number"
  | "string"
  | "boolean"
  | "date"
  | "null"
  | "invalid";

/**
 * Cleaned value with metadata
 */
export interface CleanedValue<T = unknown> {
  value: T;
  originalValue: unknown;
  type: DataType;
  isValid: boolean;
  conversionApplied: boolean;
  warnings: string[];
}

/**
 * Column statistics for numeric data
 */
export interface ColumnStats {
  count: number;
  validCount: number;
  invalidCount: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  sum: number | null;
  stdDev: number | null;
}

/**
 * Smart type detection - determines the actual data type of a value
 */
export function detectType(value: unknown): DataType {
  // Handle null/undefined
  if (value === null || value === undefined || value === "") {
    return "null";
  }

  // Already a number
  if (typeof value === "number" && !isNaN(value) && isFinite(value)) {
    return "number";
  }

  // Already a boolean
  if (typeof value === "boolean") {
    return "boolean";
  }

  // Already a Date
  if (value instanceof Date && !isNaN(value.getTime())) {
    return "date";
  }

  // String analysis
  if (typeof value === "string") {
    const trimmed = value.trim();

    // Empty string
    if (trimmed === "") {
      return "null";
    }

    // Boolean strings
    const lowerTrimmed = trimmed.toLowerCase();
    if (["true", "false", "yes", "no", "y", "n"].includes(lowerTrimmed)) {
      return "boolean";
    }

    // Numeric strings (including decimals, negatives, percentages, currency)
    // Remove common formatting: $, commas, %
    const numericTest = trimmed
      .replace(/^\$/, "")      // Remove leading $
      .replace(/,/g, "")       // Remove commas
      .replace(/%$/, "");      // Remove trailing %

    if (/^-?\d+\.?\d*$/.test(numericTest)) {
      return "number";
    }

    // Date strings (ISO format or common date patterns)
    if (
      /^\d{4}-\d{2}-\d{2}/.test(trimmed) || // ISO date
      /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(trimmed) || // US date
      /^\d{1,2}-\d{1,2}-\d{2,4}/.test(trimmed) // EU date
    ) {
      const parsedDate = new Date(trimmed);
      if (!isNaN(parsedDate.getTime())) {
        return "date";
      }
    }

    // Default to string
    return "string";
  }

  // Unknown type
  return "invalid";
}

/**
 * Convert value to target type with robust error handling
 */
export function convertValue<T = unknown>(
  value: unknown,
  targetType?: DataType
): CleanedValue<T> {
  const warnings: string[] = [];
  const originalValue = value;
  const detectedType = detectType(value);
  const type = targetType || detectedType;

  // Handle null values
  if (detectedType === "null") {
    return {
      value: null as T,
      originalValue,
      type: "null",
      isValid: true,
      conversionApplied: false,
      warnings: [],
    };
  }

  // Invalid type detection
  if (detectedType === "invalid") {
    return {
      value: null as T,
      originalValue,
      type: "invalid",
      isValid: false,
      conversionApplied: false,
      warnings: ["Could not detect valid data type"],
    };
  }

  try {
    // Number conversion
    if (type === "number") {
      if (typeof value === "number") {
        return {
          value: value as T,
          originalValue,
          type: "number",
          isValid: true,
          conversionApplied: false,
          warnings: [],
        };
      }

      if (typeof value === "string") {
        // Clean numeric string
        const cleaned = value.trim()
          .replace(/^\$/, "")       // Remove $
          .replace(/,/g, "")        // Remove commas
          .replace(/%$/, "");       // Remove %

        const parsed = parseFloat(cleaned);

        if (!isNaN(parsed) && isFinite(parsed)) {
          if (value.includes("%")) {
            warnings.push("Converted percentage to decimal (divided by 100)");
            return {
              value: (parsed / 100) as T,
              originalValue,
              type: "number",
              isValid: true,
              conversionApplied: true,
              warnings,
            };
          }

          if (value.includes("$") || value.includes(",")) {
            warnings.push("Removed currency formatting");
          }

          return {
            value: parsed as T,
            originalValue,
            type: "number",
            isValid: true,
            conversionApplied: true,
            warnings,
          };
        }
      }

      // Conversion failed
      return {
        value: null as T,
        originalValue,
        type: "invalid",
        isValid: false,
        conversionApplied: false,
        warnings: [`Cannot convert "${value}" to number`],
      };
    }

    // Boolean conversion
    if (type === "boolean") {
      if (typeof value === "boolean") {
        return {
          value: value as T,
          originalValue,
          type: "boolean",
          isValid: true,
          conversionApplied: false,
          warnings: [],
        };
      }

      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        const trueValues = ["true", "yes", "y", "1"];
        const falseValues = ["false", "no", "n", "0"];

        if (trueValues.includes(lower)) {
          return {
            value: true as T,
            originalValue,
            type: "boolean",
            isValid: true,
            conversionApplied: true,
            warnings: [`Converted "${value}" to boolean true`],
          };
        }

        if (falseValues.includes(lower)) {
          return {
            value: false as T,
            originalValue,
            type: "boolean",
            isValid: true,
            conversionApplied: true,
            warnings: [`Converted "${value}" to boolean false`],
          };
        }
      }

      return {
        value: null as T,
        originalValue,
        type: "invalid",
        isValid: false,
        conversionApplied: false,
        warnings: [`Cannot convert "${value}" to boolean`],
      };
    }

    // Date conversion
    if (type === "date") {
      if (value instanceof Date) {
        return {
          value: value as T,
          originalValue,
          type: "date",
          isValid: true,
          conversionApplied: false,
          warnings: [],
        };
      }

      if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          return {
            value: parsed as T,
            originalValue,
            type: "date",
            isValid: true,
            conversionApplied: true,
            warnings: [`Converted "${value}" to date`],
          };
        }
      }

      return {
        value: null as T,
        originalValue,
        type: "invalid",
        isValid: false,
        conversionApplied: false,
        warnings: [`Cannot convert "${value}" to date`],
      };
    }

    // String conversion (always succeeds)
    if (type === "string") {
      return {
        value: String(value) as T,
        originalValue,
        type: "string",
        isValid: true,
        conversionApplied: typeof value !== "string",
        warnings: typeof value !== "string" ? [`Converted to string`] : [],
      };
    }

    // Fallback
    return {
      value: value as T,
      originalValue,
      type: detectedType,
      isValid: true,
      conversionApplied: false,
      warnings: [],
    };
  } catch (error) {
    return {
      value: null as T,
      originalValue,
      type: "invalid",
      isValid: false,
      conversionApplied: false,
      warnings: [`Conversion error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/**
 * Clean an array of values to numeric type, filtering out invalid values
 */
export function cleanNumericArray(values: unknown[]): {
  cleanValues: number[];
  invalidValues: Array<{ index: number; value: unknown; reason: string }>;
  conversions: number;
} {
  const cleanValues: number[] = [];
  const invalidValues: Array<{ index: number; value: unknown; reason: string }> = [];
  let conversions = 0;

  values.forEach((value, index) => {
    const cleaned = convertValue<number>(value, "number");

    if (cleaned.isValid && cleaned.value !== null) {
      cleanValues.push(cleaned.value);
      if (cleaned.conversionApplied) {
        conversions++;
      }
    } else {
      invalidValues.push({
        index,
        value: cleaned.originalValue,
        reason: cleaned.warnings.join("; ") || "Invalid value",
      });
    }
  });

  return { cleanValues, invalidValues, conversions };
}

/**
 * Calculate robust statistics on numeric data
 */
export function calculateStats(values: unknown[]): ColumnStats {
  const { cleanValues, invalidValues } = cleanNumericArray(values);

  if (cleanValues.length === 0) {
    return {
      count: values.length,
      validCount: 0,
      invalidCount: invalidValues.length,
      mean: null,
      median: null,
      min: null,
      max: null,
      sum: null,
      stdDev: null,
    };
  }

  // Calculate basic stats
  const sum = cleanValues.reduce((acc, val) => acc + val, 0);
  const mean = sum / cleanValues.length;
  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);

  // Calculate median
  const sorted = [...cleanValues].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  // Calculate standard deviation
  const squaredDiffs = cleanValues.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / cleanValues.length;
  const stdDev = Math.sqrt(variance);

  return {
    count: values.length,
    validCount: cleanValues.length,
    invalidCount: invalidValues.length,
    mean,
    median,
    min,
    max,
    sum,
    stdDev,
  };
}

/**
 * Safe division with zero handling
 */
export function safeDivide(numerator: number, denominator: number, defaultValue: number = 0): number {
  if (denominator === 0 || !isFinite(denominator) || isNaN(denominator)) {
    return defaultValue;
  }
  const result = numerator / denominator;
  return isFinite(result) && !isNaN(result) ? result : defaultValue;
}

/**
 * Safe addition that handles invalid numbers
 */
export function safeAdd(...values: unknown[]): number {
  const { cleanValues } = cleanNumericArray(values);
  return cleanValues.reduce((acc, val) => acc + val, 0);
}

/**
 * Safe average calculation
 */
export function safeAverage(values: unknown[], defaultValue: number = 0): number {
  const { cleanValues } = cleanNumericArray(values);
  if (cleanValues.length === 0) {
    return defaultValue;
  }
  const sum = cleanValues.reduce((acc, val) => acc + val, 0);
  return sum / cleanValues.length;
}

/**
 * Filter dataset to only include rows with valid values in specified columns
 */
export function filterValidRows<T extends Record<string, unknown>>(
  data: T[],
  requiredColumns: (keyof T)[]
): {
  validRows: T[];
  invalidRows: Array<{ row: T; index: number; issues: string[] }>;
} {
  const validRows: T[] = [];
  const invalidRows: Array<{ row: T; index: number; issues: string[] }> = [];

  data.forEach((row, index) => {
    const issues: string[] = [];

    for (const col of requiredColumns) {
      const value = row[col];
      const cleaned = convertValue(value);

      if (!cleaned.isValid || cleaned.type === "null" || cleaned.type === "invalid") {
        issues.push(`Column "${String(col)}": ${cleaned.warnings.join("; ") || "invalid value"}`);
      }
    }

    if (issues.length === 0) {
      validRows.push(row);
    } else {
      invalidRows.push({ row, index, issues });
    }
  });

  return { validRows, invalidRows };
}

/**
 * Detect column types across an entire dataset
 */
export function detectColumnTypes<T extends Record<string, unknown>>(
  data: T[]
): Record<keyof T, { primaryType: DataType; typeDistribution: Record<DataType, number> }> {
  if (data.length === 0) {
    return {} as Record<keyof T, { primaryType: DataType; typeDistribution: Record<DataType, number> }>;
  }

  const columns = Object.keys(data[0]) as (keyof T)[];
  const result = {} as Record<keyof T, { primaryType: DataType; typeDistribution: Record<DataType, number> }>;

  for (const col of columns) {
    const typeDistribution: Record<DataType, number> = {
      number: 0,
      string: 0,
      boolean: 0,
      date: 0,
      null: 0,
      invalid: 0,
    };

    data.forEach(row => {
      const type = detectType(row[col]);
      typeDistribution[type]++;
    });

    // Determine primary type (excluding nulls)
    const nonNullTypes = Object.entries(typeDistribution)
      .filter(([type]) => type !== "null")
      .sort(([, a], [, b]) => b - a);

    const primaryType = (nonNullTypes[0]?.[0] as DataType) || "string";

    result[col] = { primaryType, typeDistribution };
  }

  return result;
}
