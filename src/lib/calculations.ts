/**
 * Financial calculation utilities
 * These functions ensure consistent calculation across the application
 */

/**
 * Calculate final tuition value after discount
 * @param baseAmount - The base tuition amount
 * @param discountPercent - Discount percentage (0-100)
 * @returns Final amount after discount
 */
export function calculateFinalTuition(
  baseAmount: number,
  discountPercent: number = 0
): number {
  if (baseAmount < 0) return 0;
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100');
  }
  return baseAmount * (1 - discountPercent / 100);
}

/**
 * Calculate tuition with discount and penalties
 * @param baseAmount - The base tuition amount
 * @param discountAmount - Discount amount (not percentage)
 * @param penaltyAmount - Penalty amount
 * @returns Final amount after discount and penalties
 */
export function calculateTuitionWithPenalty(
  baseAmount: number,
  discountAmount: number = 0,
  penaltyAmount: number = 0
): number {
  return baseAmount - discountAmount + penaltyAmount;
}

/**
 * Format currency in Brazilian Real
 * @param value - The numeric value to format
 * @returns Formatted currency string
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

/**
 * Check if a tuition is overdue
 * @param dueDate - The due date string
 * @param status - Current status
 * @returns true if overdue
 */
export function isTuitionOverdue(
  dueDate: string,
  status: string
): boolean {
  return new Date(dueDate) < new Date() && status === "pending";
}

/**
 * Calculate class revenue
 * @param tuitionPerStudent - Tuition amount per student
 * @param studentCount - Number of students in class
 * @returns Total revenue for the class
 */
export function calculateClassRevenue(
  tuitionPerStudent: number,
  studentCount: number
): number {
  return tuitionPerStudent * studentCount;
}
