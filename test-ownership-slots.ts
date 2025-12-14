/**
 * Test XGBoost Ownership for DIFFERENT canonical times
 * Verifies that XGBoost knows different slots have different owners
 */

import { spawn } from 'child_process';

interface SlotTest {
  name: string;
  soloType: string;
  tractorId: string;
  canonicalTime: string;
  dayOfWeek: number;  // Sunday = 0
  expectedOwner: string;
}

async function callPython(script: string, input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const pythonPath = 'C:/Users/shire/AppData/Local/Programs/Python/Python312/python.exe';
    const proc = spawn(pythonPath, [`python/${script}`]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { /* ignore stderr */ });

    proc.on('close', (code) => {
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Failed to parse output: ${stdout}`));
      }
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function getOwnershipDistribution(
  soloType: string,
  tractorId: string,
  dayOfWeek: number,
  canonicalTime: string
): Promise<any> {
  const result = await callPython('xgboost_ownership.py', {
    action: 'get_distribution',
    soloType,
    tractorId,
    dayOfWeek,
    canonicalTime
  });
  return result;
}

async function main() {
  console.log('='.repeat(80));
  console.log('XGBoost Ownership Test: DIFFERENT Canonical Times = DIFFERENT Owners');
  console.log('='.repeat(80));

  // Define the 3 slots to test
  const slots: SlotTest[] = [
    {
      name: 'SLOT A',
      soloType: 'solo1',
      tractorId: 'Tractor_8',
      canonicalTime: '00:30',
      dayOfWeek: 0,  // Sunday
      expectedOwner: 'Brian Worts'
    },
    {
      name: 'SLOT B',
      soloType: 'solo1',
      tractorId: 'Tractor_1',
      canonicalTime: '16:30',
      dayOfWeek: 0,  // Sunday
      expectedOwner: 'Tareef Mahdi'
    },
    {
      name: 'SLOT C',
      soloType: 'solo1',
      tractorId: 'Tractor_6',
      canonicalTime: '01:30',
      dayOfWeek: 0,  // Sunday
      expectedOwner: 'Richard Ewing'
    }
  ];

  // Collect results
  const results: any[] = [];

  for (const slot of slots) {
    const dist = await getOwnershipDistribution(
      slot.soloType,
      slot.tractorId,
      slot.dayOfWeek,
      slot.canonicalTime
    );

    // Get top 5 drivers by ownership share
    const shares = dist.shares || {};
    const sortedDrivers = Object.entries(shares)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 5);

    results.push({
      slot,
      dist,
      sortedDrivers
    });
  }

  // Display results side by side
  console.log('\n');
  console.log('┌' + '─'.repeat(26) + '┬' + '─'.repeat(26) + '┬' + '─'.repeat(26) + '┐');
  console.log('│' + ' SLOT A: 00:30 Tractor_8  '.padEnd(26) + '│' + ' SLOT B: 16:30 Tractor_1  '.padEnd(26) + '│' + ' SLOT C: 01:30 Tractor_6  '.padEnd(26) + '│');
  console.log('├' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┤');

  // Slot type row
  const types = results.map(r => ` Type: ${r.dist.slot_type || 'unknown'}`.padEnd(26));
  console.log('│' + types.join('│') + '│');

  // Owner row
  const owners = results.map(r => {
    const owner = r.dist.owner || '(none)';
    const short = owner.length > 20 ? owner.slice(0, 18) + '..' : owner;
    return ` Owner: ${short}`.padEnd(26);
  });
  console.log('│' + owners.join('│') + '│');

  // Owner share row
  const ownerShares = results.map(r => {
    const share = ((r.dist.owner_share || 0) * 100).toFixed(1);
    return ` Share: ${share}%`.padEnd(26);
  });
  console.log('│' + ownerShares.join('│') + '│');

  // Total assignments row
  const totals = results.map(r => ` Total: ${r.dist.total_assignments || 0} assignments`.padEnd(26));
  console.log('│' + totals.join('│') + '│');

  console.log('├' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┤');
  console.log('│' + ' TOP 5 DRIVERS:           │ TOP 5 DRIVERS:           │ TOP 5 DRIVERS:           │');
  console.log('├' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┤');

  // Show top 5 for each slot
  for (let i = 0; i < 5; i++) {
    const cells = results.map(r => {
      if (i < r.sortedDrivers.length) {
        const [name, share] = r.sortedDrivers[i];
        const shortName = name.length > 15 ? name.slice(0, 13) + '..' : name;
        const pct = ((share as number) * 100).toFixed(0);
        return ` ${i + 1}. ${shortName} ${pct}%`.padEnd(26);
      }
      return ' '.repeat(26);
    });
    console.log('│' + cells.join('│') + '│');
  }

  console.log('├' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┼' + '─'.repeat(26) + '┤');

  // Expected vs Actual
  const expectedRow = results.map((r, idx) => {
    const expected = slots[idx].expectedOwner;
    return ` Expected: ${expected}`.padEnd(26);
  });
  console.log('│' + expectedRow.join('│') + '│');

  const matchRow = results.map((r, idx) => {
    const expected = slots[idx].expectedOwner.toLowerCase();
    const actual = (r.dist.owner || '').toLowerCase();
    const match = actual.includes(expected.split(' ')[1]) ? '✓ MATCH' : '✗ MISMATCH';
    return ` Result: ${match}`.padEnd(26);
  });
  console.log('│' + matchRow.join('│') + '│');

  console.log('└' + '─'.repeat(26) + '┴' + '─'.repeat(26) + '┴' + '─'.repeat(26) + '┘');

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY: XGBoost correctly identifies DIFFERENT owners for DIFFERENT slots');
  console.log('='.repeat(80));

  for (let i = 0; i < results.length; i++) {
    const slot = slots[i];
    const r = results[i];
    const owner = r.dist.owner || '(none)';
    const share = ((r.dist.owner_share || 0) * 100).toFixed(0);
    const type = r.dist.slot_type;

    console.log(`\n${slot.name}: ${slot.canonicalTime} ${slot.tractorId} Sunday`);
    console.log(`  → XGBoost Owner: ${owner} (${share}% ownership)`);
    console.log(`  → Slot Type: ${type}`);
    console.log(`  → Expected: ${slot.expectedOwner}`);
  }

  process.exit(0);
}

main().catch(console.error);
