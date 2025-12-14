/**
 * LAYER 0: Pure XGBoost Ownership Scores - NOTHING ELSE
 *
 * This test calls ONLY the XGBoost ownership model.
 * NO bump logic, NO constraint filter, NO OR-Tools, NO fairness logic.
 *
 * Purpose: Verify XGBoost ownership model works correctly in isolation.
 */

import { spawn } from 'child_process';

// =============================================================================
// CONFIGURATION
// =============================================================================

const PYTHON_PATH = 'C:/Users/shire/AppData/Local/Programs/Python/Python312/python.exe';

interface TestSlot {
  label: string;
  soloType: string;
  tractorId: string;
  canonicalTime: string;
  dayOfWeek: number;  // Sunday = 0
  expectedOwner: string;
}

// Test blocks for Sunday Dec 14
const TEST_SLOTS: TestSlot[] = [
  {
    label: 'Block 1: 00:30 Tractor_8',
    soloType: 'solo1',
    tractorId: 'Tractor_8',
    canonicalTime: '00:30',
    dayOfWeek: 0,
    expectedOwner: 'Brian Worts'
  },
  {
    label: 'Block 2: 01:30 Tractor_6',
    soloType: 'solo1',
    tractorId: 'Tractor_6',
    canonicalTime: '01:30',
    dayOfWeek: 0,
    expectedOwner: 'Richard Ewing'
  },
  {
    label: 'Block 3: 16:30 Tractor_1',
    soloType: 'solo1',
    tractorId: 'Tractor_1',
    canonicalTime: '16:30',
    dayOfWeek: 0,
    expectedOwner: 'Tareef Mahdi'
  }
];

// =============================================================================
// PURE PYTHON CALL - No TypeScript logic
// =============================================================================

/**
 * Calls Python xgboost_ownership.py with get_distribution action.
 * Returns raw JSON response from Python.
 */
async function callXGBoostOwnership(
  soloType: string,
  tractorId: string,
  dayOfWeek: number,
  canonicalTime: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const input = {
      action: 'get_distribution',
      soloType,
      tractorId,
      dayOfWeek,
      canonicalTime
    };

    const proc = spawn(PYTHON_PATH, ['python/xgboost_ownership.py']);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('Python stderr:', stderr);
        reject(new Error(`Python exited with code ${code}`));
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (e) {
        console.error('Failed to parse:', stdout);
        reject(e);
      }
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

// =============================================================================
// MAIN TEST
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('LAYER 0: Pure XGBoost Ownership Scores');
  console.log('='.repeat(80));
  console.log('');
  console.log('What this test does:');
  console.log('  ✓ Calls Python xgboost_ownership.py directly');
  console.log('  ✓ Uses get_distribution action');
  console.log('  ✓ Returns raw ownership data');
  console.log('');
  console.log('What this test does NOT do:');
  console.log('  ✗ NO bump logic');
  console.log('  ✗ NO constraint filter');
  console.log('  ✗ NO OR-Tools optimization');
  console.log('  ✗ NO fairness/balance logic');
  console.log('  ✗ NO TypeScript processing of scores');
  console.log('');
  console.log('='.repeat(80));

  for (const slot of TEST_SLOTS) {
    console.log('');
    console.log('-'.repeat(80));
    console.log(`${slot.label} (Sunday, ${slot.soloType})`);
    console.log('-'.repeat(80));

    // Call XGBoost
    const result = await callXGBoostOwnership(
      slot.soloType,
      slot.tractorId,
      slot.dayOfWeek,
      slot.canonicalTime
    );

    // Display raw result
    console.log('');
    console.log('RAW XGBOOST RESPONSE:');
    console.log(`  slot_type: ${result.slot_type}`);
    console.log(`  owner: ${result.owner || '(none - rotating)'}`);
    console.log(`  owner_share: ${((result.owner_share || 0) * 100).toFixed(1)}%`);
    console.log(`  total_assignments: ${result.total_assignments}`);

    // Show all shares
    console.log('');
    console.log('ALL OWNERSHIP SHARES:');
    const shares = result.shares || {};
    const sortedShares = Object.entries(shares)
      .sort((a, b) => (b[1] as number) - (a[1] as number));

    if (sortedShares.length === 0) {
      console.log('  (no data)');
    } else {
      for (const [driver, share] of sortedShares) {
        const pct = ((share as number) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round((share as number) * 20));
        console.log(`  ${pct.padStart(5)}% ${bar} ${driver}`);
      }
    }

    // Verify expected
    console.log('');
    console.log('VERIFICATION:');
    console.log(`  Expected owner: ${slot.expectedOwner}`);

    const actualOwner = result.owner || '';
    const topDriver = sortedShares.length > 0 ? sortedShares[0][0] : '';
    const topShare = sortedShares.length > 0 ? sortedShares[0][1] : 0;

    // Check if expected driver is in top position
    const expectedLower = slot.expectedOwner.toLowerCase();
    const topLower = topDriver.toLowerCase();
    const isMatch = topLower.includes(expectedLower.split(' ')[0]) ||
                    topLower.includes(expectedLower.split(' ')[1] || '');

    if (isMatch) {
      console.log(`  Actual top driver: ${topDriver} (${((topShare as number) * 100).toFixed(1)}%)`);
      console.log(`  Result: ✓ CORRECT - XGBoost ranks expected driver #1`);
    } else {
      console.log(`  Actual top driver: ${topDriver} (${((topShare as number) * 100).toFixed(1)}%)`);
      console.log(`  Result: ✗ MISMATCH - Expected ${slot.expectedOwner}, got ${topDriver}`);
    }

    // Show slot classification
    console.log('');
    console.log('SLOT CLASSIFICATION:');
    if (result.slot_type === 'owned') {
      console.log(`  This is an OWNED slot (${result.owner} has ≥70% ownership)`);
    } else if (result.slot_type === 'rotating') {
      console.log(`  This is a ROTATING slot (no driver has ≥70% ownership)`);
    } else {
      console.log(`  Unknown slot type: ${result.slot_type}`);
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('LAYER 0 TEST COMPLETE');
  console.log('='.repeat(80));

  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
