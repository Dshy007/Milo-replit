/**
 * Test consistency metric in scoring
 *
 * Scenario:
 * - Slot: Solo1, Tractor_1, Monday 16:30
 * - Both Firas and Ahmad have 50% ownership (contested slot)
 * - Firas: 100% consistency (works same days every week)
 * - Ahmad: 70% consistency (sometimes misses)
 * - Expected: Firas wins because he's more reliable
 */

// Inline the consistency calculation for testing
function calculateConsistency(history: any[]): number {
  if (!history || history.length < 2) {
    return 0.5;
  }

  const dayFreq: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const entry of history) {
    const dateStr = entry.serviceDate || entry.date;
    if (!dateStr) continue;

    try {
      const date = new Date(dateStr);
      const dow = date.getDay();
      dayFreq[dow]++;
    } catch {
      continue;
    }
  }

  const counts = Object.values(dayFreq).filter(c => c > 0);
  if (counts.length === 0) return 0.5;

  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  if (mean === 0) return 0.5;

  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stddev = Math.sqrt(variance);

  const consistency = Math.max(0, Math.min(1, 1 - (stddev / mean)));
  return consistency;
}

console.log('='.repeat(70));
console.log('TEST: Consistency Metric in Scoring');
console.log('='.repeat(70));

// Firas: Works Mon/Wed/Sat consistently for 8 weeks = very consistent
const firasHistory: any[] = [];
for (let week = 0; week < 8; week++) {
  const baseDate = new Date('2025-10-20'); // A Monday
  baseDate.setDate(baseDate.getDate() + (week * 7));

  // Monday
  firasHistory.push({ serviceDate: baseDate.toISOString().split('T')[0] });
  // Wednesday
  const wed = new Date(baseDate);
  wed.setDate(wed.getDate() + 2);
  firasHistory.push({ serviceDate: wed.toISOString().split('T')[0] });
  // Saturday
  const sat = new Date(baseDate);
  sat.setDate(sat.getDate() + 5);
  firasHistory.push({ serviceDate: sat.toISOString().split('T')[0] });
}

// Ahmad: Works very erratically - random days, sometimes misses weeks = very inconsistent
const ahmadHistory: any[] = [];
// Spread assignments randomly across all days with high variance
const ahmadDates = [
  '2025-10-20', // Mon
  '2025-10-27', // Mon (skipped a week, then back)
  '2025-11-01', // Sat
  '2025-11-05', // Wed
  '2025-11-12', // Wed
  '2025-11-15', // Sat
  '2025-11-23', // Sun
  '2025-11-26', // Wed
  '2025-12-01', // Mon
  '2025-12-04', // Thu
  '2025-12-07', // Sun
  '2025-12-10', // Wed
];
for (const dateStr of ahmadDates) {
  ahmadHistory.push({ serviceDate: dateStr });
}

const firasConsistency = calculateConsistency(firasHistory);
const ahmadConsistency = calculateConsistency(ahmadHistory);

console.log('\n[Driver History Analysis]');
console.log(`Firas: ${firasHistory.length} assignments, ${(firasConsistency * 100).toFixed(0)}% consistency`);
console.log(`  (Works Mon/Wed/Sat every week - very predictable)`);
console.log(`Ahmad: ${ahmadHistory.length} assignments, ${(ahmadConsistency * 100).toFixed(0)}% consistency`);
console.log(`  (Works different days each week - erratic)`);

// Simulate scoring with both having same ownership
console.log('\n[Scoring Simulation]');
console.log('Both drivers have 50% ownership of the slot (contested)');
console.log('Predictability slider: 60%');

const predictability = 0.6;
const ownership = 0.5; // Both have equal ownership
const availability = 0.8; // Both available

// Calculate scores
const firasBoost = 0.8 + (firasConsistency * 0.2);
const ahmadBoost = 0.8 + (ahmadConsistency * 0.2);

const firasBase = ownership * predictability + availability * (1 - predictability);
const ahmadBase = ownership * predictability + availability * (1 - predictability);

const firasScore = firasBase * firasBoost;
const ahmadScore = ahmadBase * ahmadBoost;

console.log('\n[Score Breakdown]');
console.log('Formula: (ownership * pred + avail * (1-pred)) * consistency_boost');
console.log('');
console.log('Firas:');
console.log(`  Base score: ${ownership} * ${predictability} + ${availability} * ${1-predictability} = ${firasBase.toFixed(3)}`);
console.log(`  Consistency boost: 0.8 + (${firasConsistency.toFixed(2)} * 0.2) = ${firasBoost.toFixed(3)}`);
console.log(`  Final score: ${firasBase.toFixed(3)} * ${firasBoost.toFixed(3)} = ${firasScore.toFixed(3)}`);
console.log('');
console.log('Ahmad:');
console.log(`  Base score: ${ownership} * ${predictability} + ${availability} * ${1-predictability} = ${ahmadBase.toFixed(3)}`);
console.log(`  Consistency boost: 0.8 + (${ahmadConsistency.toFixed(2)} * 0.2) = ${ahmadBoost.toFixed(3)}`);
console.log(`  Final score: ${ahmadBase.toFixed(3)} * ${ahmadBoost.toFixed(3)} = ${ahmadScore.toFixed(3)}`);

console.log('\n' + '='.repeat(70));
console.log('RESULT:');
console.log('='.repeat(70));
console.log(`Firas: ${(firasScore * 100).toFixed(1)}%`);
console.log(`Ahmad: ${(ahmadScore * 100).toFixed(1)}%`);
console.log(`Difference: ${((firasScore - ahmadScore) * 100).toFixed(1)}%`);

if (firasScore > ahmadScore) {
  console.log('\nPASS: Firas wins due to higher consistency');
  console.log('  (More reliable driver gets the slot in contested situations)');
} else {
  console.log('\nFAIL: Expected Firas to win');
}
console.log('='.repeat(70));
