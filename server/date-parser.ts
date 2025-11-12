import { 
  parseISO, 
  startOfDay, 
  endOfDay, 
  startOfWeek, 
  endOfWeek, 
  addDays, 
  subDays,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  isValid,
  parse,
  getDay
} from "date-fns";

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Parse natural language date phrases into concrete Date objects
 * Supports phrases like:
 * - "last Sunday", "next Monday"
 * - "this week", "last week", "next week"
 * - "today", "tomorrow", "yesterday"
 * - "this month", "last month"
 * - ISO date strings: "2025-11-10"
 */
export function parseNaturalDate(phrase: string): Date | null {
  const normalized = phrase.toLowerCase().trim();
  const now = new Date();
  
  // Handle "today"
  if (normalized === "today") {
    return startOfDay(now);
  }
  
  // Handle "tomorrow"
  if (normalized === "tomorrow") {
    return startOfDay(addDays(now, 1));
  }
  
  // Handle "yesterday"
  if (normalized === "yesterday") {
    return startOfDay(subDays(now, 1));
  }
  
  // Handle plain weekday names: "monday", "friday" (defaults to next occurrence in current or next week)
  const plainDayPattern = /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i;
  const plainDayMatch = normalized.match(plainDayPattern);
  if (plainDayMatch) {
    const dayName = plainDayMatch[1].toLowerCase();
    return parseDayOfWeek(dayName, "upcoming");
  }
  
  // Handle day of week patterns with modifiers: "last Sunday", "next Monday", "this Friday"
  const dayOfWeekPattern = /^(last|next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i;
  const dayMatch = normalized.match(dayOfWeekPattern);
  if (dayMatch) {
    const direction = dayMatch[1].toLowerCase();
    const dayName = dayMatch[2].toLowerCase();
    return parseDayOfWeek(dayName, direction);
  }
  
  // Handle week patterns: "this week", "last week", "next week"
  if (normalized === "this week") {
    return startOfWeek(now, { weekStartsOn: 0 }); // Sunday
  }
  if (normalized === "last week") {
    return startOfWeek(subDays(now, 7), { weekStartsOn: 0 });
  }
  if (normalized === "next week") {
    return startOfWeek(addDays(now, 7), { weekStartsOn: 0 });
  }
  
  // Handle month patterns: "this month", "last month"
  if (normalized === "this month") {
    return startOfMonth(now);
  }
  if (normalized === "last month") {
    return startOfMonth(subMonths(now, 1));
  }
  
  // Try parsing as ISO date string
  try {
    const parsed = parseISO(normalized);
    if (isValid(parsed)) {
      return startOfDay(parsed);
    }
  } catch (e) {
    // Not a valid ISO date
  }
  
  // Try common date formats
  const formats = [
    "yyyy-MM-dd",
    "MM/dd/yyyy",
    "M/d/yyyy",
    "MM-dd-yyyy"
  ];
  
  for (const format of formats) {
    try {
      const parsed = parse(normalized, format, now);
      if (isValid(parsed)) {
        return startOfDay(parsed);
      }
    } catch (e) {
      // Try next format
    }
  }
  
  return null;
}

/**
 * Parse a date phrase into a date range
 * For single dates, returns a range covering that full day
 * For week/month phrases, returns the full range
 */
export function parseDateRange(phrase: string): DateRange | null {
  const normalized = phrase.toLowerCase().trim();
  const now = new Date();
  
  // Handle week ranges
  if (normalized === "this week") {
    return {
      startDate: startOfWeek(now, { weekStartsOn: 0 }),
      endDate: endOfWeek(now, { weekStartsOn: 0 })
    };
  }
  if (normalized === "last week") {
    const lastWeek = subDays(now, 7);
    return {
      startDate: startOfWeek(lastWeek, { weekStartsOn: 0 }),
      endDate: endOfWeek(lastWeek, { weekStartsOn: 0 })
    };
  }
  if (normalized === "next week") {
    const nextWeek = addDays(now, 7);
    return {
      startDate: startOfWeek(nextWeek, { weekStartsOn: 0 }),
      endDate: endOfWeek(nextWeek, { weekStartsOn: 0 })
    };
  }
  
  // Handle month ranges
  if (normalized === "this month") {
    return {
      startDate: startOfMonth(now),
      endDate: endOfMonth(now)
    };
  }
  if (normalized === "last month") {
    const lastMonth = subMonths(now, 1);
    return {
      startDate: startOfMonth(lastMonth),
      endDate: endOfMonth(lastMonth)
    };
  }
  
  // For single dates, return a full day range
  const singleDate = parseNaturalDate(phrase);
  if (singleDate) {
    return {
      startDate: startOfDay(singleDate),
      endDate: endOfDay(singleDate)
    };
  }
  
  return null;
}

/**
 * Helper to parse day of week with direction
 */
function parseDayOfWeek(dayName: string, direction: string): Date {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  const dayMap: Record<string, number> = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6
  };
  
  const targetDay = dayMap[dayName];
  
  if (direction === "this") {
    // "this Monday" means the Monday in the current week (Sunday-Saturday)
    // If the day has already passed this week, still return it (in the past)
    const weekStart = startOfWeek(now, { weekStartsOn: 0 }); // Sunday
    const targetDate = addDays(weekStart, targetDay);
    return startOfDay(targetDate);
  }
  
  if (direction === "upcoming") {
    // Plain weekday like "Monday" means the next occurrence (today or future)
    // If the day already passed this week, go to next week
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0) {
      // Day already passed this week, go to next week
      daysUntil += 7;
    }
    return startOfDay(addDays(now, daysUntil));
  }
  
  if (direction === "last") {
    // Find the most recent occurrence of this day (not including today)
    const daysSince = (currentDay - targetDay + 7) % 7;
    const daysBack = daysSince === 0 ? 7 : daysSince;
    return startOfDay(subDays(now, daysBack));
  }
  
  if (direction === "next") {
    // Find the next occurrence of this day (not including today)
    const daysUntil = (targetDay - currentDay + 7) % 7;
    const daysForward = daysUntil === 0 ? 7 : daysUntil;
    return startOfDay(addDays(now, daysForward));
  }
  
  return startOfDay(now);
}

/**
 * Format a date to ISO string for API responses
 */
export function formatDateForAPI(date: Date): string {
  return date.toISOString();
}
