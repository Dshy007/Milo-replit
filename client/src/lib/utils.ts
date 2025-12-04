import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get match percentage color based on value (100% = green, gradient down)
 * Used for DNA profile matching scores and consistency percentages
 * @param percentage - Value from 0-100
 * @returns Tailwind CSS color class for text
 */
export function getMatchColor(percentage: number): string {
  if (percentage >= 90) return "text-emerald-600 dark:text-emerald-400"; // 90-100%: Green
  if (percentage >= 75) return "text-green-600 dark:text-green-400";     // 75-89%: Light green
  if (percentage >= 60) return "text-lime-600 dark:text-lime-400";       // 60-74%: Lime
  if (percentage >= 45) return "text-yellow-600 dark:text-yellow-400";   // 45-59%: Yellow
  if (percentage >= 30) return "text-amber-600 dark:text-amber-400";     // 30-44%: Amber
  if (percentage >= 15) return "text-orange-600 dark:text-orange-400";   // 15-29%: Orange
  return "text-red-600 dark:text-red-400";                                // 0-14%: Red
}

/**
 * Get match percentage background color for visual indicators
 * @param percentage - Value from 0-100
 * @returns Tailwind CSS background color class
 */
export function getMatchBgColor(percentage: number): string {
  if (percentage >= 90) return "bg-emerald-100 dark:bg-emerald-900/30";
  if (percentage >= 75) return "bg-green-100 dark:bg-green-900/30";
  if (percentage >= 60) return "bg-lime-100 dark:bg-lime-900/30";
  if (percentage >= 45) return "bg-yellow-100 dark:bg-yellow-900/30";
  if (percentage >= 30) return "bg-amber-100 dark:bg-amber-900/30";
  if (percentage >= 15) return "bg-orange-100 dark:bg-orange-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}
