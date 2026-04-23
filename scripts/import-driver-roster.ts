/**
 * Import driver roster from CSV export.
 *
 * Usage:
 *   cross-env NODE_ENV=development tsx scripts/import-driver-roster.ts <path-to-csv>
 *
 * Expected CSV columns (Amazon Relay Driver Roster export):
 *   Relay status, Last name, First name, Email address, Mobile phone number, Domiciles
 *
 * Behavior:
 *   - Clears ALL existing drivers for the first tenant (use with care in prod)
 *   - Parses CSV, normalizes phone numbers
 *   - Maps "Active" -> status=active/isActive=true
 *   - Maps "Inactive" -> status=inactive/isActive=false
 *   - Maps "Invited" -> status=on_leave/isActive=false (closest enum match)
 *   - Skips rows with blank first+last name
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db } from "../server/db";
import { tenants, drivers } from "../shared/schema";
import { eq } from "drizzle-orm";

type Row = {
  relayStatus: string;
  lastName: string;
  firstName: string;
  email: string;
  phone: string;
  domicile: string;
};

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === "," && !inQuotes) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCSV(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    status: header.indexOf("relay status"),
    last: header.indexOf("last name"),
    first: header.indexOf("first name"),
    email: header.indexOf("email address"),
    phone: header.indexOf("mobile phone number"),
    domicile: header.indexOf("domiciles"),
  };
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = parseCSVLine(lines[i]);
    rows.push({
      relayStatus: p[idx.status] || "",
      lastName: p[idx.last] || "",
      firstName: p[idx.first] || "",
      email: p[idx.email] || "",
      phone: p[idx.phone] || "",
      domicile: p[idx.domicile] || "MKC",
    });
  }
  return rows;
}

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length === 0) return null;
  // Normalize to +1XXXXXXXXXX if we have 10 or 11 digits
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function mapStatus(relayStatus: string): { status: string; isActive: boolean } {
  const s = relayStatus.toLowerCase();
  if (s === "active") return { status: "active", isActive: true };
  if (s === "inactive") return { status: "inactive", isActive: false };
  if (s === "invited") return { status: "on_leave", isActive: false };
  return { status: "inactive", isActive: false };
}

async function run() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: tsx scripts/import-driver-roster.ts <csv-path>");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  console.log(`[import] Reading: ${path.resolve(csvPath)}`);
  const text = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text);
  console.log(`[import] Parsed ${rows.length} rows from CSV`);

  const tenantRows = await db.select().from(tenants).limit(1);
  if (tenantRows.length === 0) {
    console.error("[import] No tenant found. Sign up at http://localhost:3000 first.");
    process.exit(1);
  }
  const tenant = tenantRows[0];
  console.log(`[import] Target tenant: ${tenant.name} (${tenant.id})`);

  // Clear existing drivers for this tenant
  const cleared = await db
    .delete(drivers)
    .where(eq(drivers.tenantId, tenant.id))
    .returning();
  console.log(`[import] Cleared ${cleared.length} existing drivers for this tenant`);

  // Insert from CSV
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.firstName && !r.lastName) {
      console.log(`[import] Skipping row with no name (email: ${r.email})`);
      skipped++;
      continue;
    }
    const { status, isActive } = mapStatus(r.relayStatus);
    await db.insert(drivers).values({
      tenantId: tenant.id,
      firstName: r.firstName || "(unknown)",
      lastName: r.lastName || "(unknown)",
      email: r.email || null,
      phoneNumber: normalizePhone(r.phone),
      domicile: r.domicile || "MKC",
      status,
      isActive,
      loadEligible: isActive,
      profileVerified: true,
    });
    inserted++;
  }

  console.log(`[import] ✓ Inserted ${inserted} drivers (skipped ${skipped})`);
  process.exit(0);
}

run().catch((err) => {
  console.error("[import] FAILED:", err);
  process.exit(1);
});
