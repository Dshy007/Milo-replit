import * as XLSX from 'xlsx';

const filePath = 'attached_assets/fullrosterNov9-15 with names_1763157968272.xlsx';
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

console.log("=== COLUMN HEADERS ===");
if (data.length > 0) {
  console.log(Object.keys(data[0]).join('\n'));
}

console.log("\n=== FIRST 3 ROWS ===");
console.log(JSON.stringify(data.slice(0, 3), null, 2));

console.log(`\n=== TOTAL ROWS: ${data.length} ===`);
