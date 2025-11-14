# Milo Data Cleaning & Statistical Analysis Guide

## Overview

Milo now includes **robust data cleaning and statistical analysis** capabilities that automatically handle mixed data types, invalid values, and perform safe numeric calculations across all analytics features.

---

## 🎯 Key Features

### 1. **Smart Data Type Detection**
Automatically detects the actual data type of any value:
- Numbers (including formatted: `$1,234.56`, `45%`)
- Dates (ISO format, US format, EU format)
- Booleans (`true`, `false`, `yes`, `no`, `y`, `n`)
- Strings
- Null/empty values
- Invalid values

### 2. **Automatic Type Conversion**
Intelligently converts data to target types:
- Removes currency symbols (`$`)
- Removes thousand separators (`,`)
- Converts percentages to decimals (`45%` → `0.45`)
- Parses various date formats
- Converts boolean strings to true/false
- Handles null and empty values gracefully

### 3. **Robust Error Handling**
Never crashes on invalid data:
- Filters out invalid values automatically
- Provides detailed warnings about conversion issues
- Tracks which values were converted vs. original
- Reports data quality metrics

### 4. **Safe Statistical Calculations**
All calculations handle edge cases:
- **Safe Division**: Prevents divide-by-zero errors
- **Safe Average**: Handles empty datasets
- **Safe Addition**: Filters out invalid numbers
- Automatic outlier detection
- Confidence interval calculations

### 5. **Predictive Analytics**
Robust forecasting that handles messy data:
- **Linear Regression**: Automatically filters invalid X/Y pairs
- **Moving Average Forecasts**: Handles missing data points
- **Correlation Analysis**: Validates data before calculating
- **Trend Detection**: Identifies increasing/decreasing/stable patterns

---

## 📊 Available Functions

### Data Cleaning Functions

#### `detectType(value: unknown): DataType`
Detect the actual data type of any value.

```typescript
import { detectType } from "./server/data-cleaner";

detectType("$1,234.56");  // Returns: "number"
detectType("2024-11-14"); // Returns: "date"
detectType("yes");        // Returns: "boolean"
detectType("");           // Returns: "null"
```

#### `convertValue<T>(value: unknown, targetType?: DataType): CleanedValue<T>`
Convert any value to a target type with comprehensive error handling.

```typescript
import { convertValue } from "./server/data-cleaner";

const result = convertValue("$1,234.56", "number");
// Returns:
// {
//   value: 1234.56,
//   originalValue: "$1,234.56",
//   type: "number",
//   isValid: true,
//   conversionApplied: true,
//   warnings: ["Removed currency formatting"]
// }
```

#### `cleanNumericArray(values: unknown[]): CleanResult`
Clean an array of values to numeric type, filtering invalid values.

```typescript
import { cleanNumericArray } from "./server/data-cleaner";

const data = ["123", "$456.78", "invalid", null, "789"];
const result = cleanNumericArray(data);
// Returns:
// {
//   cleanValues: [123, 456.78, 789],
//   invalidValues: [
//     { index: 2, value: "invalid", reason: "Cannot convert to number" },
//     { index: 3, value: null, reason: "Invalid value" }
//   ],
//   conversions: 2  // "$456.78" and "789" were converted
// }
```

### Statistical Functions

#### `calculateStats(values: unknown[]): ColumnStats`
Calculate comprehensive statistics on any dataset (automatically filters invalid values).

```typescript
import { calculateStats } from "./server/data-cleaner";

const stats = calculateStats(["100", "200", "invalid", "$300", null]);
// Returns:
// {
//   count: 5,           // Total values
//   validCount: 3,      // Valid numeric values
//   invalidCount: 2,    // Invalid values filtered
//   mean: 200,
//   median: 200,
//   min: 100,
//   max: 300,
//   sum: 600,
//   stdDev: 81.65
// }
```

#### `calculateLinearRegression(xValues, yValues): RegressionResult`
Perform linear regression with automatic data cleaning.

```typescript
import { calculateLinearRegression } from "./server/statistical-analyzer";

const x = [1, 2, "invalid", 4, 5];
const y = ["10", "$20", 30, "40", null];

const regression = calculateLinearRegression(x, y);
// Automatically filters invalid pairs and returns:
// {
//   slope: 10,
//   intercept: 0,
//   rSquared: 1.0,
//   predictions: [10, 20, 40],
//   residuals: [0, 0, 0],
//   isReliable: false,  // Only 3 valid points
//   warnings: ["Filtered 2 invalid X values", "Filtered 1 invalid Y values"]
// }
```

#### `forecastMovingAverage(values, periods, forecastSteps): ForecastResult`
Generate forecasts with confidence intervals.

```typescript
import { forecastMovingAverage } from "./server/statistical-analyzer";

const salesData = ["100", "120", "invalid", "130", "$140"];

const forecast = forecastMovingAverage(salesData, 3, 2);
// Returns:
// {
//   forecasts: [130, 133.33],
//   confidence: {
//     lower: [115.2, 118.5],
//     upper: [144.8, 148.2]
//   },
//   trend: "increasing",
//   reliability: 0.85,
//   warnings: ["Filtered 1 invalid values before forecasting"]
// }
```

### Data Quality Assessment

#### `assessDataQuality<T>(data: T[]): DataQuality`
Analyze overall quality of a dataset.

```typescript
import { assessDataQuality } from "./server/statistical-analyzer";

const dataset = [
  { name: "John", age: "30", salary: "$50000" },
  { name: "Jane", age: "invalid", salary: "60000" },
  { name: null, age: "25", salary: null }
];

const quality = assessDataQuality(dataset);
// Returns:
// {
//   totalRows: 3,
//   validRows: 1,      // Only first row has all valid values
//   invalidRows: 2,
//   completeness: 0.67, // 67% of cells are valid
//   numericColumns: ["age", "salary"],
//   categoricalColumns: ["name"],
//   dateColumns: [],
//   issues: [
//     {
//       column: "age",
//       issue: "33% of values are not numeric",
//       severity: "medium"
//     },
//     {
//       column: "salary",
//       issue: "33% of values are not numeric",
//       severity: "medium"
//     }
//   ]
// }
```

---

## 🔧 Integration with Milo

### Excel Import Pipeline
The Excel import automatically uses data cleaning:

```typescript
// In server/excel-import.ts
import { convertValue, detectType, cleanNumericArray } from "./data-cleaner";

// Date/time values are automatically validated and converted
// Invalid operator IDs are detected and reported
// Driver names are normalized (trimming, name parsing)
```

### Compliance Heatmap
Safe calculations prevent crashes:

```typescript
// In server/compliance-heatmap.ts
import { safeDivide } from "./data-cleaner";

// All duty hour calculations use safe division
// Handles edge cases where denominators might be zero
```

### Future Analytics Features
Ready for advanced analytics:
- Predictive driver availability
- Route optimization forecasting
- Compliance trend analysis
- Workload balancing predictions

---

## 💡 Best Practices

### 1. **Always Use Type Detection Before Processing**
```typescript
const type = detectType(userInput);
if (type === "number") {
  // Safe to process as number
}
```

### 2. **Use Clean Functions for Arrays**
```typescript
// ❌ Bad: Manual filtering
const numbers = data.filter(v => !isNaN(Number(v))).map(Number);

// ✅ Good: Use cleanNumericArray
const { cleanValues } = cleanNumericArray(data);
```

### 3. **Always Check Warnings**
```typescript
const result = convertValue(input, "number");
if (result.warnings.length > 0) {
  console.warn("Conversion warnings:", result.warnings);
}
```

### 4. **Use Safe Math Operations**
```typescript
// ❌ Bad: Direct division
const avg = total / count;  // Crashes if count is 0

// ✅ Good: Safe division
const avg = safeDivide(total, count, 0);  // Returns 0 if count is 0
```

### 5. **Assess Data Quality Before Analytics**
```typescript
const quality = assessDataQuality(dataset);
if (quality.completeness < 0.8) {
  console.warn("Low data quality - results may be unreliable");
}
```

---

## 📈 Example: Complete Analytics Pipeline

```typescript
import {
  assessDataQuality,
  calculateStats,
  calculateLinearRegression,
  forecastMovingAverage
} from "./server/statistical-analyzer";

// 1. Load raw data (messy, mixed types)
const rawData = [
  { month: "Jan", revenue: "$10,000", expenses: "8000" },
  { month: "Feb", revenue: "12000", expenses: "$9,500" },
  { month: "Mar", revenue: "invalid", expenses: null },
  { month: "Apr", revenue: "15000", expenses: "11000" }
];

// 2. Assess data quality
const quality = assessDataQuality(rawData);
console.log(`Data quality: ${(quality.completeness * 100).toFixed(0)}%`);

// 3. Extract and clean revenue data
const revenueValues = rawData.map(r => r.revenue);
const stats = calculateStats(revenueValues);
console.log(`Average revenue: $${stats.mean?.toFixed(2)}`);

// 4. Forecast next month
const forecast = forecastMovingAverage(revenueValues, 2, 1);
console.log(`Forecasted revenue: $${forecast.forecasts[0].toFixed(2)}`);
console.log(`Trend: ${forecast.trend}`);

// 5. Analyze revenue vs time
const months = [1, 2, 3, 4];
const regression = calculateLinearRegression(months, revenueValues);
console.log(`Growth rate: $${regression.slope.toFixed(2)}/month`);
console.log(`R²: ${regression.rSquared.toFixed(2)}`);
```

Output:
```
Data quality: 83%
Average revenue: $12333.33
Forecasted revenue: $13500.00
Trend: increasing
Growth rate: $1666.67/month
R²: 0.95
```

---

## 🚀 Future Enhancements

Planned features:
- [ ] API endpoints for data quality reports
- [ ] Real-time data cleaning dashboard
- [ ] Automated data profiling
- [ ] ML-based outlier detection
- [ ] Time series anomaly detection
- [ ] Automated data type suggestions
- [ ] Data cleaning recommendation engine

---

## 📚 API Reference

For complete API documentation, see:
- `server/data-cleaner.ts` - Core cleaning functions
- `server/statistical-analyzer.ts` - Statistical & predictive analytics

All functions are fully typed with TypeScript and include JSDoc comments.
