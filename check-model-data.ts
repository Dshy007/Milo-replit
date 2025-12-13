import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

// Try to find the right database
const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data.db';
console.log('Using database:', dbPath);
const db = new Database(dbPath);

// Mike Burton assignments
const mikeAssignments = db.prepare(`
  SELECT a.serviceDate, a.startTime, d.name, a.tractorId
  FROM assignments a
  JOIN drivers d ON a.driverId = d.id
  WHERE d.name LIKE '%Burton%' OR d.name LIKE '%Michael Shane%'
  ORDER BY a.serviceDate DESC
`).all() as any[];

console.log('=== MIKE BURTON IN DATABASE ===');
console.log('Total assignments:', mikeAssignments.length);
if (mikeAssignments.length > 0) {
  console.log('Date range:', mikeAssignments[mikeAssignments.length-1].serviceDate, 'to', mikeAssignments[0].serviceDate);
  console.log('Last 10:');
  mikeAssignments.slice(0, 10).forEach(a => {
    const dow = new Date(a.serviceDate).toLocaleDateString('en-US', { weekday: 'short' });
    console.log('  ', a.serviceDate, dow, a.startTime, a.tractorId);
  });
}

// Josh Green assignments
const joshAssignments = db.prepare(`
  SELECT a.serviceDate, a.startTime, d.name, a.tractorId
  FROM assignments a
  JOIN drivers d ON a.driverId = d.id
  WHERE d.name LIKE '%Joshua%Green%'
  ORDER BY a.serviceDate DESC
`).all() as any[];

console.log('');
console.log('=== JOSH GREEN IN DATABASE ===');
console.log('Total assignments:', joshAssignments.length);
if (joshAssignments.length > 0) {
  console.log('Date range:', joshAssignments[joshAssignments.length-1].serviceDate, 'to', joshAssignments[0].serviceDate);
}

// Total assignments in DB
const total = db.prepare(`SELECT COUNT(*) as cnt FROM assignments`).get() as any;
const dateRange = db.prepare(`SELECT MIN(serviceDate) as minDate, MAX(serviceDate) as maxDate FROM assignments`).get() as any;

console.log('');
console.log('=== TOTAL DATABASE ===');
console.log('Total assignments:', total.cnt);
console.log('Date range:', dateRange.minDate, 'to', dateRange.maxDate);
