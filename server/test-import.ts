import { parseExcelSchedule } from "./excel-import";
import * as fs from "fs";
import * as path from "path";

async function testImport() {
  const tenantId = "3cf00ed3-3eb9-43bf-b001-aee880b30304";
  const userId = "e0e879bf-d0db-4af4-8133-5fe9880ae7d5";
  
  // Read the Excel file
  const filePath = path.join(process.cwd(), "attached_assets", "fullrosterNov9-15_1763079864996.xlsx");
  const fileBuffer = fs.readFileSync(filePath);
  
  console.log(`Importing Excel file: ${filePath}`);
  console.log(`File size: ${fileBuffer.length} bytes`);
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`User ID: ${userId}\n`);
  
  try {
    const result = await parseExcelSchedule(tenantId, fileBuffer, userId);
    
    console.log("=== Import Results ===");
    console.log(`Created: ${result.created}`);
    console.log(`Failed: ${result.failed}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Committed with warnings: ${result.committedWithWarnings}`);
    console.log(`\nErrors (${result.errors.length}):`);
    result.errors.forEach((err, i) => console.log(`${i + 1}. ${err}`));
    console.log(`\nWarnings (${result.warnings.length}):`);
    result.warnings.forEach((warn, i) => console.log(`${i + 1}. ${warn}`));
    
    process.exit(0);
  } catch (error: any) {
    console.error("Import failed with exception:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testImport();
