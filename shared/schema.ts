import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, decimal, uniqueIndex, index, check, pgEnum, date, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { addYears, isAfter } from "date-fns";

// Enums
export const patternGroupEnum = pgEnum("pattern_group", ["sunWed", "wedSat"]);

// Tenants (Organizations)
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;

// Users (with tenant relationship)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("user"), // admin, manager, user
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Drivers
export const drivers = pgTable("drivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  licenseNumber: text("license_number"), // Optional - for tracking
  licenseExpiry: timestamp("license_expiry"), // Optional - for tracking
  phoneNumber: text("phone_number"),
  email: text("email"),
  domicile: text("domicile"), // Driver's base location (e.g., "MKC", "NYC")
  profileVerified: boolean("profile_verified").default(false), // Indicates if profile is verified
  loadEligible: boolean("load_eligible").default(true), // Whether driver is eligible for loads
  status: text("status").notNull().default("active"), // active, inactive, on_leave
  certifications: text("certifications").array(),
  // AI Scheduler Preferences - Control how many days per week driver works
  schedulingMinDays: integer("scheduling_min_days"), // Minimum days per week (e.g., 1 for part-time)
  schedulingMaxDays: integer("scheduling_max_days"), // Maximum days per week (e.g., 3 for part-time)
  schedulingAllowedDays: text("scheduling_allowed_days").array(), // Specific days only (e.g., ["saturday"] for "just Saturday")
  schedulingNotes: text("scheduling_notes"), // Free-form notes like "Part-time student" or "Only weekends"
  // DOT Compliance Fields - Optional for tracking, validated if provided
  requiresDotCompliance: boolean("requires_dot_compliance").default(false), // If true, DOT fields become mandatory
  cdlClass: text("cdl_class"), // A, B, or C
  medicalCertExpiry: timestamp("medical_cert_expiry"), // DOT medical certification
  dateOfBirth: timestamp("date_of_birth"), // To validate age >= 21
  endorsements: text("endorsements"), // H (Hazmat), N (Tank), T (Doubles/Triples), P (Passenger), S (School Bus), X (Hazmat+Tank)
  // Active/Inactive for XGBoost matching
  isActive: boolean("is_active").default(true), // If false, XGBoost ignores this driver
  daysOff: text("days_off").array(), // Days driver is unavailable (e.g., ["sunday", "saturday"])
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Base schema without refinements - for frontend .extend() usage
export const baseInsertDriverSchema = createInsertSchema(drivers, {
  licenseExpiry: z.coerce.date().optional().nullable(),
  medicalCertExpiry: z.coerce.date().optional().nullable(),
  dateOfBirth: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Full schema with conditional DOT validation - fields optional but validated if provided
export const insertDriverSchema = baseInsertDriverSchema
.refine((data) => {
  // If dateOfBirth is provided, validate driver is at least 21
  if (data.dateOfBirth) {
    const age = (Date.now() - data.dateOfBirth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return age >= 21;
  }
  return true;
}, {
  message: "Driver must be at least 21 years old for interstate commerce",
  path: ["dateOfBirth"],
})
.refine((data) => {
  // If medicalCertExpiry is provided, validate it's not expired
  if (data.medicalCertExpiry) {
    return data.medicalCertExpiry > new Date();
  }
  return true;
}, {
  message: "Medical certification must not be expired",
  path: ["medicalCertExpiry"],
})
.refine((data) => {
  // If licenseExpiry is provided, validate it's not expired
  if (data.licenseExpiry) {
    return data.licenseExpiry > new Date();
  }
  return true;
}, {
  message: "CDL license must not be expired",
  path: ["licenseExpiry"],
})
.refine((data) => {
  // If requiresDotCompliance is true, ensure all DOT fields are provided
  if (data.requiresDotCompliance) {
    return !!(data.licenseNumber && data.licenseExpiry && data.medicalCertExpiry && data.dateOfBirth && data.cdlClass);
  }
  return true;
}, {
  message: "All DOT compliance fields (license, medical cert, DOB, CDL class) are required when DOT compliance is enabled",
  path: ["requiresDotCompliance"],
});

// Update schema with same conditional validation
export const updateDriverSchema = baseInsertDriverSchema.omit({ tenantId: true }).partial()
.refine((data) => {
  // If dateOfBirth is being updated, validate age
  if (data.dateOfBirth) {
    const age = (Date.now() - data.dateOfBirth.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    return age >= 21;
  }
  return true;
}, {
  message: "Driver must be at least 21 years old for interstate commerce",
  path: ["dateOfBirth"],
})
.refine((data) => {
  // If medicalCertExpiry is being updated, validate it's not expired
  if (data.medicalCertExpiry) {
    return data.medicalCertExpiry > new Date();
  }
  return true;
}, {
  message: "Medical certification must not be expired",
  path: ["medicalCertExpiry"],
})
.refine((data) => {
  // If licenseExpiry is being updated, validate it's not expired
  if (data.licenseExpiry) {
    return data.licenseExpiry > new Date();
  }
  return true;
}, {
  message: "CDL license must not be expired",
  path: ["licenseExpiry"],
});
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type UpdateDriver = z.infer<typeof updateDriverSchema>;
export type Driver = typeof drivers.$inferSelect;

// Trucks/Vehicles
export const trucks = pgTable("trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  truckNumber: text("truck_number").notNull(),
  type: text("type"), // tractor, trailer, van, etc.
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  fuel: text("fuel"), // diesel, gas, electric, hybrid
  vin: text("vin"),
  licensePlate: text("license_plate"),
  lastKnownLocation: text("last_known_location"), // Track where truck was last seen
  status: text("status").notNull().default("available"), // available, in_use, maintenance, retired
  complianceStatus: text("compliance_status").notNull().default("pending"), // pending, complete
  lastInspection: timestamp("last_inspection"),
  nextInspection: timestamp("next_inspection"),
  // DOT Compliance Fields - nullable to support bulk imports
  usdotNumber: text("usdot_number"), // Required for interstate commerce when complete
  gvwr: integer("gvwr"), // Gross Vehicle Weight Rating in lbs (triggers DOT if >= 10,001)
  registrationExpiry: timestamp("registration_expiry"),
  insuranceExpiry: timestamp("insurance_expiry"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Base schema without refinements - for frontend .extend() usage
export const baseInsertTruckSchema = createInsertSchema(trucks, {
  lastInspection: z.coerce.date().optional().nullable(),
  nextInspection: z.coerce.date().optional().nullable(),
  registrationExpiry: z.coerce.date().optional().nullable(),
  insuranceExpiry: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Full validated schema with conditional validation based on complianceStatus
export const insertTruckSchema = baseInsertTruckSchema
.refine((data) => {
  // If complianceStatus is 'complete', require core fields
  if (data.complianceStatus === 'complete') {
    return !!(data.make && data.model && data.year && data.vin && data.licensePlate);
  }
  return true;
}, {
  message: "Complete compliance requires: make, model, year, VIN, and license plate",
  path: ["complianceStatus"],
})
.refine((data) => {
  // If complianceStatus is 'complete', require DOT fields
  if (data.complianceStatus === 'complete') {
    return !!(data.usdotNumber && data.gvwr && data.registrationExpiry && data.insuranceExpiry);
  }
  return true;
}, {
  message: "Complete compliance requires: USDOT number, GVWR, registration expiry, and insurance expiry",
  path: ["complianceStatus"],
})
.refine((data) => {
  // Validate both inspection dates are provided or neither
  const hasLast = data.lastInspection !== undefined && data.lastInspection !== null;
  const hasNext = data.nextInspection !== undefined && data.nextInspection !== null;
  
  if (hasLast !== hasNext) {
    return false;
  }
  
  // If both provided, validate chronological order and 12-month requirement
  if (hasLast && hasNext) {
    if (data.nextInspection! <= data.lastInspection!) {
      return false;
    }
    const limit = addYears(data.lastInspection!, 1);
    return !isAfter(data.nextInspection!, limit);
  }
  
  return true;
}, {
  message: "Inspection dates must both be provided, in chronological order, and next inspection within 12 months of last",
  path: ["nextInspection"],
})
.refine((data) => {
  // Validate registration is not expired (only if provided)
  if (data.registrationExpiry) {
    return data.registrationExpiry > new Date();
  }
  return true;
}, {
  message: "Vehicle registration must not be expired",
  path: ["registrationExpiry"],
})
.refine((data) => {
  // Validate insurance is not expired (only if provided)
  if (data.insuranceExpiry) {
    return data.insuranceExpiry > new Date();
  }
  return true;
}, {
  message: "Vehicle insurance must not be expired",
  path: ["insuranceExpiry"],
})
.refine((data) => {
  // Validate GVWR is within DOT threshold (only if provided)
  if (data.gvwr !== null && data.gvwr !== undefined) {
    return data.gvwr >= 10001;
  }
  return true;
}, {
  message: "GVWR must be at least 10,001 lbs for DOT compliance tracking",
  path: ["gvwr"],
});

// Update schema must also enforce DOT compliance
export const updateTruckSchema = baseInsertTruckSchema.omit({ tenantId: true }).partial()
.refine((data) => {
  // If inspection dates are being updated, validate them
  const hasLast = data.lastInspection !== undefined && data.lastInspection !== null;
  const hasNext = data.nextInspection !== undefined && data.nextInspection !== null;
  
  // If updating, both must be provided or both omitted
  if ((hasLast && !hasNext) || (!hasLast && hasNext)) {
    return false;
  }
  
  // If both provided, validate order and interval
  if (hasLast && hasNext) {
    if (data.nextInspection! <= data.lastInspection!) {
      return false;
    }
    // Next must be within 12 calendar months of last (handles leap years)
    const limit = addYears(data.lastInspection!, 1);
    return !isAfter(data.nextInspection!, limit);
  }
  
  return true;
}, {
  message: "Inspection dates must be in chronological order and within 12 months (DOT requirement)",
  path: ["nextInspection"],
})
.refine((data) => {
  // If registrationExpiry is being updated, validate it's not expired
  if (data.registrationExpiry) {
    return data.registrationExpiry > new Date();
  }
  return true;
}, {
  message: "Vehicle registration must not be expired",
  path: ["registrationExpiry"],
})
.refine((data) => {
  // If insuranceExpiry is being updated, validate it's not expired
  if (data.insuranceExpiry) {
    return data.insuranceExpiry > new Date();
  }
  return true;
}, {
  message: "Vehicle insurance must not be expired",
  path: ["insuranceExpiry"],
})
.refine((data) => {
  // If GVWR is being updated, validate it meets DOT threshold
  if (data.gvwr !== undefined && data.gvwr !== null) {
    return data.gvwr >= 10001;
  }
  return true;
}, {
  message: "GVWR must be at least 10,001 lbs for DOT compliance tracking",
  path: ["gvwr"],
});
export type InsertTruck = z.infer<typeof insertTruckSchema>;
export type UpdateTruck = z.infer<typeof updateTruckSchema>;
export type Truck = typeof trucks.$inferSelect;

// Routes
export const routes = pgTable("routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  distance: decimal("distance", { precision: 10, scale: 2 }), // miles
  estimatedDuration: integer("estimated_duration"), // minutes
  // DOT Compliance Fields
  maxWeight: integer("max_weight"), // Maximum weight allowed on route in lbs (bridge/road restrictions)
  hazmatAllowed: boolean("hazmat_allowed").notNull().default(true), // Some routes prohibit hazmat
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRouteSchema = createInsertSchema(routes).omit({ id: true, createdAt: true, updatedAt: true });
export const updateRouteSchema = insertRouteSchema.omit({ tenantId: true }).partial();
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type UpdateRoute = z.infer<typeof updateRouteSchema>;
export type Route = typeof routes.$inferSelect;

// Contracts (Bench Contracts with specific start times and tractors)
export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), // e.g., "Solo1 16:30 Tractor_1"
  type: text("type").notNull(), // solo1, solo2, team
  startTime: text("start_time").notNull(), // HH:MM format (e.g., "16:30") - facility local time
  status: text("status").notNull().default("active"), // active, inactive, pending
  tractorId: text("tractor_id").notNull(), // e.g., "Tractor_1", "Tractor_2"
  domicile: text("domicile").default(""), // e.g., "PHX", "LAX", "DFW"
  duration: integer("duration").notNull(), // hours: 14 for Solo1, 38 for Solo2
  baseRoutes: integer("base_routes").notNull(), // number of base routes (10 for Solo1, 7 for Solo2)
  daysPerWeek: integer("days_per_week").notNull().default(6), // rolling 6-day pattern
  protectedDrivers: boolean("protected_drivers").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one contract per (tenant, type, startTime, tractor)
  uniqueContract: sql`UNIQUE (${table.tenantId}, ${table.type}, ${table.startTime}, ${table.tractorId})`,
}));

export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true });
export const updateContractSchema = insertContractSchema.omit({ tenantId: true }).partial();
export type InsertContract = z.infer<typeof insertContractSchema>;
export type UpdateContract = z.infer<typeof updateContractSchema>;
export type Contract = typeof contracts.$inferSelect;

// Schedules (Driver Assignments)
export const schedules = pgTable("schedules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  truckId: varchar("truck_id").references(() => trucks.id),
  routeId: varchar("route_id").references(() => routes.id),
  contractId: varchar("contract_id").references(() => contracts.id),
  scheduledDate: timestamp("scheduled_date").notNull(),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  status: text("status").notNull().default("scheduled"), // scheduled, in_progress, completed, cancelled
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertScheduleSchema = createInsertSchema(schedules, {
  scheduledDate: z.coerce.date(),
  startTime: z.coerce.date().optional().nullable(),
  endTime: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateScheduleSchema = insertScheduleSchema.omit({ tenantId: true }).partial();
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type UpdateSchedule = z.infer<typeof updateScheduleSchema>;
export type Schedule = typeof schedules.$inferSelect;

// Loads (Freight)
export const loads = pgTable("loads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  scheduleId: varchar("schedule_id").references(() => schedules.id),
  loadNumber: text("load_number").notNull().unique(),
  pickupLocation: text("pickup_location").notNull(),
  deliveryLocation: text("delivery_location").notNull(),
  pickupTime: timestamp("pickup_time").notNull(),
  deliveryTime: timestamp("delivery_time").notNull(),
  weight: decimal("weight", { precision: 10, scale: 2 }), // pounds
  description: text("description"),
  // DOT Compliance Fields
  hazmatClass: text("hazmat_class"), // DOT Hazmat Classes: 1 (Explosives), 2 (Gases), 3 (Flammable Liquids), 4 (Flammable Solids), 5 (Oxidizers), 6 (Toxic), 7 (Radioactive), 8 (Corrosive), 9 (Miscellaneous)
  requiresPlacard: boolean("requires_placard").notNull().default(false), // Hazmat placarding required
  status: text("status").notNull().default("pending"), // pending, picked_up, in_transit, delivered, cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Base schema without refinements - for frontend .extend() usage
export const baseInsertLoadSchema = createInsertSchema(loads, {
  pickupTime: z.coerce.date(),
  deliveryTime: z.coerce.date(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Full validated schema with refinements - for backend validation
export const insertLoadSchema = baseInsertLoadSchema
.refine((data) => {
  // Validate hazmat class is valid DOT classification (1-9) if provided
  if (data.hazmatClass) {
    const validClasses = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    return validClasses.includes(data.hazmatClass);
  }
  return true;
}, {
  message: "Hazmat class must be a valid DOT classification (1-9)",
  path: ["hazmatClass"],
})
.refine((data) => {
  // Validate weight is positive if provided
  if (data.weight) {
    return parseFloat(data.weight.toString()) > 0;
  }
  return true;
}, {
  message: "Load weight must be positive",
  path: ["weight"],
})
.refine((data) => {
  // If hazmat class is provided, placard is usually required
  // Exception: small quantities may not require placarding
  // This is a warning-level check - we'll accept both but validate consistency
  return true; // Allow flexibility for small quantities
}, {
  message: "Consider whether placard is required for this hazmat class",
  path: ["requiresPlacard"],
});

export const updateLoadSchema = baseInsertLoadSchema.omit({ tenantId: true }).partial()
.refine((data) => {
  // Validate hazmat class if being updated
  if (data.hazmatClass) {
    const validClasses = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    return validClasses.includes(data.hazmatClass);
  }
  return true;
}, {
  message: "Hazmat class must be a valid DOT classification (1-9)",
  path: ["hazmatClass"],
})
.refine((data) => {
  // Validate weight is positive if being updated
  if (data.weight !== undefined) {
    return data.weight === null || parseFloat(data.weight.toString()) > 0;
  }
  return true;
}, {
  message: "Load weight must be positive",
  path: ["weight"],
});

export type InsertLoad = z.infer<typeof insertLoadSchema>;
export type UpdateLoad = z.infer<typeof updateLoadSchema>;
export type Load = typeof loads.$inferSelect;

// Blocks (Scheduled instances of contracts - immutable time windows)
// Supports Amazon's weekly "block tours" where same blockId runs daily Sun-Sat
export const blocks = pgTable("blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockId: text("block_id").notNull(), // Amazon block tour ID: "B-00000001"
  serviceDate: timestamp("service_date", { mode: "date" }).notNull(), // Calendar date this block instance runs
  contractId: varchar("contract_id").notNull().references(() => contracts.id),
  startTimestamp: timestamp("start_timestamp").notNull(), // Full start date+time in CT
  endTimestamp: timestamp("end_timestamp").notNull(), // Calculated: startTimestamp + duration
  tractorId: text("tractor_id").notNull(), // e.g., "Tractor_1"
  soloType: text("solo_type").notNull(), // solo1, solo2, team
  duration: integer("duration").notNull(), // hours: 14 for Solo1, 38 for Solo2
  status: text("status").notNull().default("unassigned"), // unassigned, assigned, completed, cancelled
  isCarryover: boolean("is_carryover").notNull().default(false), // True for Fri/Sat from previous week
  isRejectedLoad: boolean("is_rejected_load").notNull().default(false), // True if Amazon rejected the driver assignment (no driver in CSV)
  onBenchStatus: text("on_bench_status").notNull().default("on_bench"), // on_bench, off_bench
  offBenchReason: text("off_bench_reason"), // non_contract_time, wrong_tractor_for_contract
  // Pattern-aware fields for Amazon's dynamic shift assignments
  patternGroup: patternGroupEnum("pattern_group"), // 'sunWed' or 'wedSat' - Amazon's rotating duty cycles
  canonicalStart: timestamp("canonical_start"), // UTC timestamp of contract's canonical start time (immutable per cycle, basis for bump calculations)
  cycleId: text("cycle_id"), // Pattern-aware cycle identifier format: "${patternGroup}:${cycleStartDateISO}" (e.g., "sunWed:2025-11-09")
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one block per (tenant, blockId, serviceDate) - supports daily occurrences of weekly tours
  uniqueBlockId: uniqueIndex("blocks_tenant_block_servicedate_idx").on(table.tenantId, table.blockId, table.serviceDate),
  // Index for time range queries
  timeRangeIdx: index("blocks_time_range_idx").on(table.startTimestamp, table.endTimestamp),
  // Index for pattern-based queries
  patternIdx: index("blocks_pattern_idx").on(table.patternGroup, table.cycleId),
}));

export const insertBlockSchema = createInsertSchema(blocks, {
  serviceDate: z.coerce.date(),
  startTimestamp: z.coerce.date(),
  endTimestamp: z.coerce.date(),
  canonicalStart: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateBlockSchema = insertBlockSchema.omit({ tenantId: true }).partial();
export type InsertBlock = z.infer<typeof insertBlockSchema>;
export type UpdateBlock = z.infer<typeof updateBlockSchema>;
export type Block = typeof blocks.$inferSelect;

// Shift Templates (Reusable shift definitions keyed by operatorId, not Amazon's transient block IDs)
// Amazon provides different block IDs each week, so we key on operatorId for stability
export const shiftTemplates = pgTable("shift_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  operatorId: text("operator_id").notNull(), // Stable key from Excel: "FTIM_MKC_Solo1_Tractor_2_d2"
  contractId: varchar("contract_id").notNull().references(() => contracts.id),
  canonicalStartTime: text("canonical_start_time").notNull(), // HH:MM format (e.g., "20:30")
  defaultDuration: integer("default_duration").notNull(), // hours: 14 for Solo1, 38 for Solo2 (NOTE: may span midnight)
  defaultTractorId: text("default_tractor_id"), // e.g., "Tractor_2" (nullable - Amazon often omits)
  soloType: text("solo_type").notNull(), // solo1, solo2, team
  patternGroup: patternGroupEnum("pattern_group"), // 'sunWed' or 'wedSat'
  status: text("status").notNull().default("active"), // active, inactive
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`), // JSONB metadata for structured data
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one template per (tenant, operatorId)
  uniqueOperatorId: uniqueIndex("shift_templates_tenant_operator_idx").on(table.tenantId, table.operatorId),
  // Index for contract lookups
  contractIdIdx: index("shift_templates_contract_id_idx").on(table.contractId),
}));

export const insertShiftTemplateSchema = createInsertSchema(shiftTemplates).omit({ id: true, createdAt: true });
export const updateShiftTemplateSchema = insertShiftTemplateSchema.omit({ tenantId: true }).partial();
export type InsertShiftTemplate = z.infer<typeof insertShiftTemplateSchema>;
export type UpdateShiftTemplate = z.infer<typeof updateShiftTemplateSchema>;
export type ShiftTemplate = typeof shiftTemplates.$inferSelect;

// Shift Occurrences (Daily instances of shift templates)
// Each occurrence represents a specific day's shift, replacing the role of the blocks table
export const shiftOccurrences = pgTable("shift_occurrences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  templateId: varchar("template_id").notNull().references(() => shiftTemplates.id),
  serviceDate: date("service_date").notNull(), // Calendar date this shift runs (timezone-safe date storage)
  scheduledStart: timestamp("scheduled_start").notNull(), // Full start date+time (facility local time)
  scheduledEnd: timestamp("scheduled_end").notNull(), // Full end date+time (may cross midnight)
  actualStart: timestamp("actual_start"), // Actual start time (nullable, filled when shift starts)
  actualEnd: timestamp("actual_end"), // Actual end time (nullable, filled when shift completes)
  tractorId: text("tractor_id"), // e.g., "Tractor_2" (nullable - imports may lack this)
  externalBlockId: text("external_block_id"), // Amazon's transient block ID (nullable, informational only)
  status: text("status").notNull().default("unassigned"), // unassigned, assigned, in_progress, completed, cancelled
  isCarryover: boolean("is_carryover").notNull().default(false), // True for Fri/Sat from previous week
  importBatchId: text("import_batch_id"), // Track which Excel import created this occurrence
  // Pattern-aware fields for rolling-6 calculations
  patternGroup: patternGroupEnum("pattern_group"), // 'sunWed' or 'wedSat' (derived from template)
  cycleId: text("cycle_id"), // Pattern-aware cycle identifier: "${patternGroup}:${cycleStartDateISO}"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one occurrence per (tenant, template, serviceDate)
  uniqueOccurrence: uniqueIndex("shift_occurrences_tenant_template_date_idx").on(table.tenantId, table.templateId, table.serviceDate),
  // Index for time range queries
  timeRangeIdx: index("shift_occurrences_time_range_idx").on(table.scheduledStart, table.scheduledEnd),
  // Index for pattern-based queries
  patternIdx: index("shift_occurrences_pattern_idx").on(table.patternGroup, table.cycleId),
  // Index for external block ID lookups (for migration/debugging)
  externalBlockIdIdx: index("shift_occurrences_external_block_id_idx").on(table.externalBlockId),
  // Index for template + date lookups
  templateDateIdx: index("shift_occurrences_template_date_idx").on(table.templateId, table.serviceDate),
}));

export const insertShiftOccurrenceSchema = createInsertSchema(shiftOccurrences, {
  serviceDate: z.coerce.date(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  actualStart: z.coerce.date().optional().nullable(),
  actualEnd: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateShiftOccurrenceSchema = insertShiftOccurrenceSchema.omit({ tenantId: true }).partial();
export type InsertShiftOccurrence = z.infer<typeof insertShiftOccurrenceSchema>;
export type UpdateShiftOccurrence = z.infer<typeof updateShiftOccurrenceSchema>;
export type ShiftOccurrence = typeof shiftOccurrences.$inferSelect;

// Block Assignments (Link blocks/shifts to drivers with validation)
// MIGRATION: Transitioning from blockId to shiftOccurrenceId
export const blockAssignments = pgTable("block_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockId: varchar("block_id").references(() => blocks.id), // DEPRECATED: Nullable during migration, will be removed
  shiftOccurrenceId: varchar("shift_occurrence_id").references(() => shiftOccurrences.id), // NEW: Replaces blockId
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id), // User who made the assignment
  notes: text("notes"),
  validationStatus: text("validation_status").notNull().default("valid"), // valid, warning, violation
  validationSummary: text("validation_summary"), // JSONB string with rolling-6 metrics, warnings, reasons
  isActive: boolean("is_active").notNull().default(true), // Soft-delete: false when archived
  archivedAt: timestamp("archived_at"), // When assignment was archived (null if active)
  importBatchId: text("import_batch_id"), // Track which Excel import created this assignment
  amazonBlockId: text("amazon_block_id"), // Amazon's Block ID as metadata (no foreign key) - e.g., "B-00000001"
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one active driver per block (legacy)
  uniqueBlockAssignment: uniqueIndex("block_assignments_tenant_block_idx").on(table.tenantId, table.blockId).where(sql`${table.isActive} = true AND ${table.blockId} IS NOT NULL`),
  // Unique constraint: one active driver per shift occurrence (new)
  uniqueShiftAssignment: uniqueIndex("block_assignments_tenant_shift_idx").on(table.tenantId, table.shiftOccurrenceId).where(sql`${table.isActive} = true AND ${table.shiftOccurrenceId} IS NOT NULL`),
  // Index for driver lookups
  driverIdIdx: index("block_assignments_driver_id_idx").on(table.driverId),
  // Index for tenant+driver+time queries
  driverTimeIdx: index("block_assignments_driver_time_idx").on(table.tenantId, table.driverId, table.assignedAt),
  // Index for shift occurrence lookups
  shiftOccurrenceIdIdx: index("block_assignments_shift_occurrence_id_idx").on(table.shiftOccurrenceId),
}));

export const insertBlockAssignmentSchema = createInsertSchema(blockAssignments, {
  assignedAt: z.coerce.date().optional(),
}).omit({ id: true, createdAt: true });
export const updateBlockAssignmentSchema = insertBlockAssignmentSchema.omit({ tenantId: true }).partial();
export type InsertBlockAssignment = z.infer<typeof insertBlockAssignmentSchema>;
export type UpdateBlockAssignment = z.infer<typeof updateBlockAssignmentSchema>;
export type BlockAssignment = typeof blockAssignments.$inferSelect;

// Assignment History (Track all driver assignments with pattern-aware bump calculations)
export const assignmentHistory = pgTable("assignment_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockId: varchar("block_id").notNull().references(() => blocks.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  contractId: varchar("contract_id").notNull().references(() => contracts.id),
  startTimestamp: timestamp("start_timestamp").notNull(), // Actual block start time
  canonicalStart: timestamp("canonical_start").notNull(), // Contract's canonical start time for this cycle (snapshot)
  patternGroup: patternGroupEnum("pattern_group").notNull(), // sunWed or wedSat - required for pattern-aware validation
  cycleId: text("cycle_id").notNull(), // Pattern-aware cycle identifier
  bumpMinutes: integer("bump_minutes").notNull().default(0), // Time difference from canonical start in minutes (can be negative)
  isAutoAssigned: boolean("is_auto_assigned").notNull().default(false), // True if auto-assigned by engine
  confidenceScore: integer("confidence_score"), // 0-100 confidence level if auto-assigned
  assignmentSource: text("assignment_source").notNull().default("manual"), // auto, manual, suggested
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Index for driver pattern lookups
  driverPatternIdx: index("assignment_history_driver_pattern_idx").on(table.tenantId, table.driverId, table.patternGroup, table.cycleId),
  // Index for contract lookups
  contractIdx: index("assignment_history_contract_idx").on(table.contractId, table.patternGroup),
  // Index for time-based queries
  timeIdx: index("assignment_history_time_idx").on(table.assignedAt),
}));

export const insertAssignmentHistorySchema = createInsertSchema(assignmentHistory, {
  startTimestamp: z.coerce.date(),
  canonicalStart: z.coerce.date(),
  assignedAt: z.coerce.date().optional(),
}).omit({ id: true, createdAt: true });
export type InsertAssignmentHistory = z.infer<typeof insertAssignmentHistorySchema>;
export type AssignmentHistory = typeof assignmentHistory.$inferSelect;

// Driver Contract Stats (Aggregated driver performance per contract and pattern)
export const driverContractStats = pgTable("driver_contract_stats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  contractId: varchar("contract_id").notNull().references(() => contracts.id),
  patternGroup: patternGroupEnum("pattern_group").notNull(), // sunWed or wedSat - required for pattern-aware aggregation
  lastWorked: timestamp("last_worked"), // Most recent assignment for this driver+contract+pattern
  totalAssignments: integer("total_assignments").notNull().default(0), // Count of assignments
  streakCount: integer("streak_count").notNull().default(0), // Consecutive weeks worked on same contract+pattern
  avgBumpMinutes: integer("avg_bump_minutes").notNull().default(0), // Average bump from canonical time
  lastCycleId: text("last_cycle_id"), // Most recent cycle worked
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one stat record per driver+contract+pattern
  uniqueDriverContractPattern: uniqueIndex("driver_contract_stats_unique_idx").on(table.tenantId, table.driverId, table.contractId, table.patternGroup),
  // Index for driver lookups
  driverIdx: index("driver_contract_stats_driver_idx").on(table.driverId),
  // Index for contract+pattern queries
  contractPatternIdx: index("driver_contract_stats_contract_pattern_idx").on(table.contractId, table.patternGroup),
}));

export const insertDriverContractStatsSchema = createInsertSchema(driverContractStats, {
  lastWorked: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateDriverContractStatsSchema = insertDriverContractStatsSchema.omit({ tenantId: true }).partial();
export type InsertDriverContractStats = z.infer<typeof insertDriverContractStatsSchema>;
export type UpdateDriverContractStats = z.infer<typeof updateDriverContractStatsSchema>;
export type DriverContractStats = typeof driverContractStats.$inferSelect;

// Protected Driver Rules (Special scheduling constraints for specific drivers)
export const protectedDriverRules = pgTable("protected_driver_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  ruleName: text("rule_name").notNull(), // e.g., "No Fridays", "Weekend Solo1 Only"
  ruleType: text("rule_type").notNull(), // day_restriction, time_restriction, solo_restriction
  blockedDays: text("blocked_days").array(), // e.g., ["Friday"], ["Saturday", "Sunday"]
  allowedDays: text("allowed_days").array(), // e.g., ["Saturday", "Sunday", "Monday"]
  allowedSoloTypes: text("allowed_solo_types").array(), // e.g., ["solo1"]
  allowedStartTimes: text("allowed_start_times").array(), // e.g., ["16:30"]
  maxStartTime: text("max_start_time"), // Latest allowed start time (e.g., "17:30")
  isWeekdayOnly: boolean("is_weekday_only").notNull().default(false), // Rule applies only on weekdays
  effectiveFrom: timestamp("effective_from"), // Rule starts applying from this date
  effectiveTo: timestamp("effective_to"), // Rule expires after this date
  isProtected: boolean("is_protected").notNull().default(true), // Cannot reassign their blocks
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one rule per (tenant, driver, rule_name)
  uniqueDriverRule: uniqueIndex("protected_driver_rules_tenant_driver_name_idx").on(table.tenantId, table.driverId, table.ruleName),
  // Index for driver lookups
  driverIdIdx: index("protected_driver_rules_driver_id_idx").on(table.driverId),
  // Check constraint for rule_type enum
  ruleTypeCheck: check("rule_type_check", sql`${table.ruleType} IN ('day_restriction', 'time_restriction', 'solo_restriction')`),
}));

export const insertProtectedDriverRuleSchema = createInsertSchema(protectedDriverRules).omit({ id: true, createdAt: true, updatedAt: true });
export const updateProtectedDriverRuleSchema = insertProtectedDriverRuleSchema.omit({ tenantId: true }).partial();
export type InsertProtectedDriverRule = z.infer<typeof insertProtectedDriverRuleSchema>;
export type UpdateProtectedDriverRule = z.infer<typeof updateProtectedDriverRuleSchema>;
export type ProtectedDriverRule = typeof protectedDriverRules.$inferSelect;

// Special Requests (Driver availability management - unavailability tracking and recurring patterns)
export const specialRequests = pgTable("special_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  // New fields (nullable during migration, will be made NOT NULL after backfill)
  availabilityType: text("availability_type"), // available, unavailable
  startDate: timestamp("start_date"), // Start of availability change
  endDate: timestamp("end_date"), // End of availability change (null for single day or recurring)
  startTime: text("start_time"), // HH:MM format (e.g., "16:30") - time of day when availability change begins
  endTime: text("end_time"), // HH:MM format (e.g., "21:30") - optional, for time range restrictions
  blockType: text("block_type"), // solo1, solo2, team - links to contract types
  contractId: varchar("contract_id").references(() => contracts.id), // Optional: specific contract/tractor, null = "any tractor at this time"
  isRecurring: boolean("is_recurring").default(false), // True for permanent patterns
  recurringPattern: text("recurring_pattern"), // every_monday, every_friday, every_weekend, every_week
  recurringDays: text("recurring_days").array(), // For custom patterns: ["monday", "friday"]
  reason: text("reason"), // Reason for unavailability
  status: text("status").default("approved"), // approved, cancelled (auto-approve for self-service)
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id), // User who approved/cancelled
  notes: text("notes"), // Admin notes about the request
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Legacy fields (kept for backward compatibility during migration)
  requestType: text("request_type"), // DEPRECATED: will be removed after migration
  affectedDate: timestamp("affected_date"), // DEPRECATED: will be removed after migration
  affectedBlockId: varchar("affected_block_id").references(() => blocks.id), // DEPRECATED
  swapCandidateId: varchar("swap_candidate_id").references(() => drivers.id), // DEPRECATED
}, (table) => ({
  // Index for driver lookups
  driverIdIdx: index("special_requests_driver_id_idx").on(table.driverId),
  // Index for date range queries
  startDateIdx: index("special_requests_start_date_idx").on(table.startDate),
  endDateIdx: index("special_requests_end_date_idx").on(table.endDate),
  // Index for recurring patterns
  isRecurringIdx: index("special_requests_is_recurring_idx").on(table.isRecurring),
  // Index for status filtering
  statusIdx: index("special_requests_status_idx").on(table.status),
  // Check constraint for availability_type enum
  availabilityTypeCheck: check("availability_type_check", sql`${table.availabilityType} IN ('available', 'unavailable')`),
  // Check constraint for status enum
  statusCheck: check("status_check", sql`${table.status} IN ('approved', 'cancelled', 'pending', 'rejected')`),
  // Check constraint for recurring_pattern enum
  recurringPatternCheck: check("recurring_pattern_check", sql`${table.recurringPattern} IS NULL OR ${table.recurringPattern} IN ('every_monday', 'every_tuesday', 'every_wednesday', 'every_thursday', 'every_friday', 'every_saturday', 'every_sunday', 'every_weekend', 'every_week', 'custom')`),
  // Check constraint for block_type enum
  blockTypeCheck: check("block_type_check", sql`${table.blockType} IS NULL OR ${table.blockType} IN ('solo1', 'solo2', 'team')`),
}));

// Time format validation regex (HH:MM format: 00:00 to 23:59)
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Base schema without complex validation - for frontend usage
export const baseInsertSpecialRequestSchema = createInsertSchema(specialRequests, {
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  startTime: z.string().regex(TIME_REGEX, "Time must be in HH:MM format (e.g., 16:30)").optional().nullable(),
  endTime: z.string().regex(TIME_REGEX, "Time must be in HH:MM format (e.g., 21:30)").optional().nullable(),
  reviewedAt: z.coerce.date().optional().nullable(),
  // Legacy fields for backward compatibility
  affectedDate: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Form schema for frontend forms (omits tenantId, no transform)
export const formSpecialRequestSchema = baseInsertSpecialRequestSchema.omit({ tenantId: true });

// Helper function to convert HH:MM to minutes for comparison
const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Full validated schema with refinements and backward compatibility
export const insertSpecialRequestSchema = baseInsertSpecialRequestSchema
.refine((data) => {
  // startTime and blockType must be provided together (both or neither, and both non-empty)
  const startTimeProvided = data.startTime !== undefined && data.startTime !== null;
  const blockTypeProvided = data.blockType !== undefined && data.blockType !== null;
  
  // If either is provided, both must be provided
  if (startTimeProvided !== blockTypeProvided) {
    return false;
  }
  
  // If both are provided, both must be non-empty
  if (startTimeProvided && blockTypeProvided) {
    const startTimeFilled = data.startTime!.trim() !== "";
    const blockTypeFilled = data.blockType!.trim() !== "";
    return startTimeFilled && blockTypeFilled;
  }
  
  return true;
}, {
  message: "startTime and blockType must be provided together and cannot be empty",
  path: ["startTime"],
})
.refine((data) => {
  // If endDate is provided, it must be after or equal to startDate
  if (data.endDate) {
    return data.endDate >= data.startDate;
  }
  return true;
}, {
  message: "End date must be after or equal to start date",
  path: ["endDate"],
})
.refine((data) => {
  // If both times are provided, ensure endTime >= startTime for same-day requests
  if (data.startTime && data.endTime) {
    // Single-day (no endDate) or same-day range
    if (!data.endDate || (data.startDate && data.endDate.getTime() === data.startDate.getTime())) {
      return timeToMinutes(data.endTime) >= timeToMinutes(data.startTime);
    }
  }
  return true;
}, {
  message: "End time must be after or equal to start time on the same day",
  path: ["endTime"],
})
.refine((data) => {
  // If isRecurring is true, must have a recurring pattern or custom days
  if (data.isRecurring) {
    return !!data.recurringPattern || (data.recurringDays && data.recurringDays.length > 0);
  }
  return true;
}, {
  message: "Recurring patterns require a pattern type or custom days to be specified",
  path: ["isRecurring"],
})
.refine((data) => {
  // If recurring pattern is "custom", must have custom days
  if (data.recurringPattern === "custom") {
    return data.recurringDays && data.recurringDays.length > 0;
  }
  return true;
}, {
  message: "Custom recurring patterns require specific days to be selected",
  path: ["recurringDays"],
})
.transform((data) => {
  // Backward compatibility: backfill legacy fields from new fields
  // If new fields are provided but legacy fields are missing, populate them
  if (data.availabilityType && !data.requestType) {
    data.requestType = data.availabilityType === "unavailable" ? "time_off" : undefined;
  }
  if (data.startDate && !data.affectedDate) {
    data.affectedDate = data.startDate;
  }
  
  // Forward compatibility: populate new fields from legacy if new fields missing
  if (data.requestType && !data.availabilityType) {
    data.availabilityType = "unavailable"; // Legacy requests were always unavailability
  }
  if (data.affectedDate && !data.startDate) {
    data.startDate = data.affectedDate;
    data.endDate = data.endDate || data.affectedDate; // Single-day range
  }
  
  return data;
});

export const updateSpecialRequestSchema = baseInsertSpecialRequestSchema.omit({ tenantId: true }).partial();
export type InsertSpecialRequest = z.infer<typeof insertSpecialRequestSchema>;
export type UpdateSpecialRequest = z.infer<typeof updateSpecialRequestSchema>;
export type SpecialRequest = typeof specialRequests.$inferSelect;

// Assignment Patterns (Cached driver-block pattern analysis for Auto-Build)
export const assignmentPatterns = pgTable("assignment_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockSignature: text("block_signature").notNull(), // Normalized key: "contractId_soloType_startTimeBucket_dayOfWeek_tractor"
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  weightedCount: decimal("weighted_count", { precision: 10, scale: 4 }).notNull().default("0"), // Exponentially decayed assignment count
  rawCount: integer("raw_count").notNull().default(0), // Total number of assignments (unweighted)
  lastAssigned: timestamp("last_assigned"), // Most recent assignment date
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull().default("0"), // Normalized confidence score (0-1)
  decayFactor: decimal("decay_factor", { precision: 5, scale: 4 }).notNull().default("0.8660"), // Decay factor (default: 4-week half-life)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one pattern per (tenant, blockSignature, driver)
  uniquePattern: uniqueIndex("assignment_patterns_tenant_sig_driver_idx").on(table.tenantId, table.blockSignature, table.driverId),
  // Index for blockSignature lookups
  blockSignatureIdx: index("assignment_patterns_block_sig_idx").on(table.blockSignature),
  // Index for driver lookups
  driverIdIdx: index("assignment_patterns_driver_id_idx").on(table.driverId),
  // Index for confidence scoring
  confidenceIdx: index("assignment_patterns_confidence_idx").on(table.confidence),
}));

export const insertAssignmentPatternSchema = createInsertSchema(assignmentPatterns, {
  lastAssigned: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateAssignmentPatternSchema = insertAssignmentPatternSchema.omit({ tenantId: true }).partial();
export type InsertAssignmentPattern = z.infer<typeof insertAssignmentPatternSchema>;
export type UpdateAssignmentPattern = z.infer<typeof updateAssignmentPatternSchema>;
export type AssignmentPattern = typeof assignmentPatterns.$inferSelect;

// Auto-Build Runs (Stores Auto-Build suggestion batches for review/approval workflow)
export const autoBuildRuns = pgTable("auto_build_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  targetWeekStart: timestamp("target_week_start").notNull(), // Sunday of target week
  targetWeekEnd: timestamp("target_week_end").notNull(), // Saturday of target week
  status: text("status").notNull().default("pending"), // pending, approved, rejected, partial
  suggestions: text("suggestions").notNull(), // JSON: [{blockId, driverId, confidence, score, rationale}]
  totalBlocks: integer("total_blocks").notNull().default(0),
  highConfidence: integer("high_confidence").notNull().default(0), // Blocks with confidence >= 0.5
  mediumConfidence: integer("medium_confidence").notNull().default(0), // Blocks with confidence 0.35-0.5
  lowConfidence: integer("low_confidence").notNull().default(0), // Blocks with confidence < 0.35
  createdBy: varchar("created_by").references(() => users.id), // User who triggered auto-build
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id), // User who approved/rejected
  reviewedAt: timestamp("reviewed_at"),
  approvedBlockIds: text("approved_block_ids").array(), // Block IDs that were approved (for partial approval)
  notes: text("notes"), // Admin notes about the run
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Index for target week queries
  targetWeekIdx: index("auto_build_runs_target_week_idx").on(table.targetWeekStart, table.targetWeekEnd),
  // Index for status filtering
  statusIdx: index("auto_build_runs_status_idx").on(table.status),
  // Check constraint for status enum
  statusCheck: check("auto_build_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected', 'partial')`),
}));

export const insertAutoBuildRunSchema = createInsertSchema(autoBuildRuns, {
  targetWeekStart: z.coerce.date(),
  targetWeekEnd: z.coerce.date(),
  reviewedAt: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateAutoBuildRunSchema = insertAutoBuildRunSchema.omit({ tenantId: true }).partial();
export type InsertAutoBuildRun = z.infer<typeof insertAutoBuildRunSchema>;
export type UpdateAutoBuildRun = z.infer<typeof updateAutoBuildRunSchema>;
export type AutoBuildRun = typeof autoBuildRuns.$inferSelect;

// Driver Availability Preferences
// Allows granular control of driver availability by block type, start time, and day of week
export const driverAvailabilityPreferences = pgTable("driver_availability_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  blockType: text("block_type").notNull(), // solo1, solo2, team
  startTime: text("start_time").notNull(), // e.g., "16:30", "20:30", "11:30"
  dayOfWeek: text("day_of_week").notNull(), // monday, tuesday, wednesday, thursday, friday, saturday, sunday
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one preference per driver + block type + start time + day
  uniquePreference: uniqueIndex("driver_pref_unique_idx").on(
    table.driverId,
    table.blockType,
    table.startTime,
    table.dayOfWeek
  ),
  // Index for quick lookups by driver
  driverIdx: index("driver_pref_driver_idx").on(table.driverId),
}));

export const insertDriverAvailabilityPreferenceSchema = createInsertSchema(driverAvailabilityPreferences).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true 
});
export const updateDriverAvailabilityPreferenceSchema = insertDriverAvailabilityPreferenceSchema.omit({ tenantId: true }).partial();
export type InsertDriverAvailabilityPreference = z.infer<typeof insertDriverAvailabilityPreferenceSchema>;
export type UpdateDriverAvailabilityPreference = z.infer<typeof updateDriverAvailabilityPreferenceSchema>;
export type DriverAvailabilityPreference = typeof driverAvailabilityPreferences.$inferSelect;

// Python Analysis Results
export const analysisResults = pgTable("analysis_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  analysisType: text("analysis_type").notNull(), // excel_parse, coverage_analysis, assignment_prediction
  inputData: jsonb("input_data"), // The input parameters/data used
  result: jsonb("result").notNull(), // JSON result from Python script
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  executionTimeMs: integer("execution_time_ms"), // How long Python script took
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  typeIdx: index("analysis_results_type_idx").on(table.analysisType),
  createdAtIdx: index("analysis_results_created_at_idx").on(table.createdAt),
}));

export const insertAnalysisResultSchema = createInsertSchema(analysisResults).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
export type AnalysisResult = typeof analysisResults.$inferSelect;

// AI Chat Sessions (Milo conversations with memory)
export const aiChatSessions = pgTable("ai_chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  title: text("title"), // Auto-generated from first message or user-set
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  messageCount: integer("message_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true), // False when archived
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("ai_chat_sessions_user_idx").on(table.userId),
  lastMessageIdx: index("ai_chat_sessions_last_message_idx").on(table.lastMessageAt),
  activeIdx: index("ai_chat_sessions_active_idx").on(table.isActive),
}));

export const insertAiChatSessionSchema = createInsertSchema(aiChatSessions, {
  lastMessageAt: z.coerce.date().optional(),
}).omit({ id: true, createdAt: true });
export type InsertAiChatSession = z.infer<typeof insertAiChatSessionSchema>;
export type AiChatSession = typeof aiChatSessions.$inferSelect;

// AI Chat Messages (Individual messages within a session)
export const aiChatMessages = pgTable("ai_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull().references(() => aiChatSessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" or "assistant"
  content: text("content").notNull(),
  tokensUsed: integer("tokens_used"), // Track API usage for assistant messages
  toolCalls: jsonb("tool_calls"), // Store any tool/function calls made
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sessionIdx: index("ai_chat_messages_session_idx").on(table.sessionId),
  createdAtIdx: index("ai_chat_messages_created_at_idx").on(table.createdAt),
}));

export const insertAiChatMessageSchema = createInsertSchema(aiChatMessages).omit({
  id: true,
  createdAt: true
});
export type InsertAiChatMessage = z.infer<typeof insertAiChatMessageSchema>;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;

// AI Assistant Query History (legacy - kept for backward compatibility)
export const aiQueryHistory = pgTable("ai_query_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  query: text("query").notNull(), // User's natural language query
  context: jsonb("context"), // Additional context provided to AI (current week, filters, etc.)
  response: text("response").notNull(), // AI's response
  tokensUsed: integer("tokens_used"), // Track API usage
  responseTimeMs: integer("response_time_ms"),
  helpful: boolean("helpful"), // User feedback (thumbs up/down)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("ai_query_user_idx").on(table.userId),
  createdAtIdx: index("ai_query_created_at_idx").on(table.createdAt),
}));

export const insertAiQueryHistorySchema = createInsertSchema(aiQueryHistory).omit({
  id: true,
  createdAt: true
});
export type InsertAiQueryHistory = z.infer<typeof insertAiQueryHistorySchema>;
export type AiQueryHistory = typeof aiQueryHistory.$inferSelect;

// Assignment Predictions
export const assignmentPredictions = pgTable("assignment_predictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  shiftOccurrenceId: varchar("shift_occurrence_id").references(() => shiftOccurrences.id),
  blockId: text("block_id"),
  recommendedDriverId: varchar("recommended_driver_id").references(() => drivers.id),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 2 }), // 0.00 to 100.00
  reasons: text("reasons").array(), // Reasons for recommendation
  alternativeDrivers: jsonb("alternative_drivers"), // Top 3-5 alternatives with scores
  appliedToSchedule: boolean("applied_to_schedule").default(false), // Was this recommendation accepted?
  appliedAt: timestamp("applied_at"),
  appliedBy: varchar("applied_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  occurrenceIdx: index("predictions_occurrence_idx").on(table.shiftOccurrenceId),
  driverIdx: index("predictions_driver_idx").on(table.recommendedDriverId),
  appliedIdx: index("predictions_applied_idx").on(table.appliedToSchedule),
}));

export const insertAssignmentPredictionSchema = createInsertSchema(assignmentPredictions, {
  appliedAt: z.coerce.date().optional().nullable(),
}).omit({
  id: true,
  createdAt: true
});
export type InsertAssignmentPrediction = z.infer<typeof insertAssignmentPredictionSchema>;
export type AssignmentPrediction = typeof assignmentPredictions.$inferSelect;

// ══════════════════════════════════════════════════════════════════════════════
//                         NEURAL INTELLIGENCE TABLES
//                    "Where Silicon Minds Learn to Dispatch"
// ══════════════════════════════════════════════════════════════════════════════

// Neural Agents - The Team Registry
// Stores configuration for each AI agent (Architect, Scout, Analyst, Executor)
export const neuralAgents = pgTable("neural_agents", {
  id: varchar("id").primaryKey(), // "architect", "scout", "analyst", "executor"
  displayName: text("display_name").notNull(), // "Claude - The Architect"
  provider: text("provider").notNull(), // "anthropic", "google", "openai", "manus"
  model: text("model").notNull(), // "claude-sonnet-4", "gemini-pro", etc.
  systemPrompt: text("system_prompt").notNull(), // Full prompt with all rules
  capabilities: text("capabilities").array(), // ["reasoning", "real_time", "execution"]
  status: text("status").notNull().default("active"), // "active", "degraded", "offline"
  lastHealthCheck: timestamp("last_health_check"),
  config: jsonb("config"), // Provider-specific settings
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNeuralAgentSchema = createInsertSchema(neuralAgents).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertNeuralAgent = z.infer<typeof insertNeuralAgentSchema>;
export type NeuralAgent = typeof neuralAgents.$inferSelect;

// Neural Thoughts - Every Branch in the Decision Tree
// Stores the organic branching thought process for each decision
export const neuralThoughts = pgTable("neural_thoughts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  parentId: varchar("parent_id"), // Self-reference for tree structure (handled by app logic)
  agentId: varchar("agent_id").notNull().references(() => neuralAgents.id),
  sessionId: varchar("session_id").references(() => aiChatSessions.id),

  thoughtType: text("thought_type").notNull(), // "question", "hypothesis", "conclusion", "action"
  content: text("content").notNull(), // The actual thought
  confidence: integer("confidence").notNull().default(0), // 0-100
  status: text("status").notNull().default("exploring"), // "exploring", "promising", "converged", "ruled_out"

  evidence: jsonb("evidence"), // Supporting data
  metadata: jsonb("metadata"), // Tool calls, timings, etc.

  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(), // 6 weeks from creation
}, (table) => ({
  tenantIdx: index("neural_thoughts_tenant_idx").on(table.tenantId),
  parentIdx: index("neural_thoughts_parent_idx").on(table.parentId),
  sessionIdx: index("neural_thoughts_session_idx").on(table.sessionId),
  statusIdx: index("neural_thoughts_status_idx").on(table.status),
  expiresIdx: index("neural_thoughts_expires_idx").on(table.expiresAt),
}));

export const insertNeuralThoughtSchema = createInsertSchema(neuralThoughts, {
  expiresAt: z.coerce.date(),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertNeuralThought = z.infer<typeof insertNeuralThoughtSchema>;
export type NeuralThought = typeof neuralThoughts.$inferSelect;

// Neural Patterns - Learned Insights That Grow Stronger Over Time
// Stores patterns like "Maria performs well in rain conditions"
export const neuralPatterns = pgTable("neural_patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),

  patternType: text("pattern_type").notNull(), // "driver", "route", "schedule", "weather", "operational"
  subjectId: varchar("subject_id"), // FK to driver/block/route if applicable
  subjectType: text("subject_type"), // "driver", "block", "route", "user"

  pattern: text("pattern").notNull(), // The learned insight
  confidence: integer("confidence").notNull().default(50), // 0-100, grows with confirmation
  observations: integer("observations").notNull().default(1), // How many times observed

  lastObserved: timestamp("last_observed").defaultNow().notNull(),
  firstObserved: timestamp("first_observed").defaultNow().notNull(),
  evidence: jsonb("evidence"), // Array of supporting instances

  status: text("status").notNull().default("hypothesis"), // "hypothesis", "confirmed", "deprecated"

  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(), // Resets on each observation
}, (table) => ({
  tenantIdx: index("neural_patterns_tenant_idx").on(table.tenantId),
  typeIdx: index("neural_patterns_type_idx").on(table.patternType),
  subjectIdx: index("neural_patterns_subject_idx").on(table.subjectId),
  statusIdx: index("neural_patterns_status_idx").on(table.status),
  confidenceIdx: index("neural_patterns_confidence_idx").on(table.confidence),
}));

export const insertNeuralPatternSchema = createInsertSchema(neuralPatterns, {
  lastObserved: z.coerce.date().optional(),
  firstObserved: z.coerce.date().optional(),
  expiresAt: z.coerce.date(),
}).omit({
  id: true,
  createdAt: true,
});
export type InsertNeuralPattern = z.infer<typeof insertNeuralPatternSchema>;
export type NeuralPattern = typeof neuralPatterns.$inferSelect;

// Neural Profiles - Deep Knowledge About Entities (Drivers, Routes, etc.)
// Stores learned traits, preferences, strengths, and concerns
export const neuralProfiles = pgTable("neural_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),

  entityType: text("entity_type").notNull(), // "driver", "block", "route", "user"
  entityId: varchar("entity_id").notNull(),

  learnedTraits: jsonb("learned_traits").notNull().default({}),
  // Structure:
  // {
  //   "preferences": ["morning shifts", "Route A"],
  //   "strengths": ["rain driving", "on-time"],
  //   "concerns": ["fatigue after 8h"],
  //   "reliability_score": 94,
  //   "best_for": ["solo1", "sunWed"],
  //   "avoid": ["late nights"]
  // }

  interactionCount: integer("interaction_count").notNull().default(0),
  lastUpdated: timestamp("last_updated").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(), // 6 weeks from last update
}, (table) => ({
  tenantIdx: index("neural_profiles_tenant_idx").on(table.tenantId),
  entityIdx: index("neural_profiles_entity_idx").on(table.entityType, table.entityId),
  uniqueEntity: uniqueIndex("neural_profiles_unique").on(table.tenantId, table.entityType, table.entityId),
}));

export const insertNeuralProfileSchema = createInsertSchema(neuralProfiles, {
  lastUpdated: z.coerce.date().optional(),
  expiresAt: z.coerce.date(),
}).omit({
  id: true,
});
export type InsertNeuralProfile = z.infer<typeof insertNeuralProfileSchema>;
export type NeuralProfile = typeof neuralProfiles.$inferSelect;

// Neural Decisions - Audit Trail of Every AI Choice
// Stores what was decided, why, and what happened
export const neuralDecisions = pgTable("neural_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  sessionId: varchar("session_id").references(() => aiChatSessions.id),
  thoughtId: varchar("thought_id").references(() => neuralThoughts.id),
  agentId: varchar("agent_id").notNull().references(() => neuralAgents.id),

  decision: text("decision").notNull(),
  reasoning: jsonb("reasoning").notNull(), // Branch path that led here
  actionTaken: jsonb("action_taken"), // What was executed (if any)

  dotStatus: text("dot_status"), // "valid", "warning", "violation"
  protectedRuleCheck: jsonb("protected_rule_check"), // Pass/fail with details

  outcome: text("outcome").notNull().default("pending"), // "pending", "success", "partial", "failed"
  outcomeNotes: text("outcome_notes"),
  userFeedback: text("user_feedback"), // thumbs up/down + comment

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("neural_decisions_tenant_idx").on(table.tenantId),
  sessionIdx: index("neural_decisions_session_idx").on(table.sessionId),
  outcomeIdx: index("neural_decisions_outcome_idx").on(table.outcome),
  agentIdx: index("neural_decisions_agent_idx").on(table.agentId),
}));

export const insertNeuralDecisionSchema = createInsertSchema(neuralDecisions).omit({
  id: true,
  createdAt: true,
});
export type InsertNeuralDecision = z.infer<typeof insertNeuralDecisionSchema>;
export type NeuralDecision = typeof neuralDecisions.$inferSelect;

// Neural Routing - How Tasks Flow Through the System
// Logs which agent handled each request and why
export const neuralRouting = pgTable("neural_routing", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  sessionId: varchar("session_id").references(() => aiChatSessions.id),

  userInput: text("user_input").notNull(),
  detectedIntent: text("detected_intent").notNull(), // "lookup", "analysis", "action", "weather"

  routedTo: varchar("routed_to").notNull().references(() => neuralAgents.id),
  routingReason: text("routing_reason").notNull(),
  fallbackChain: jsonb("fallback_chain"), // ["architect", "analyst", "scout"]

  responseTimeMs: integer("response_time_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tenantIdx: index("neural_routing_tenant_idx").on(table.tenantId),
  intentIdx: index("neural_routing_intent_idx").on(table.detectedIntent),
  agentIdx: index("neural_routing_agent_idx").on(table.routedTo),
  sessionIdx: index("neural_routing_session_idx").on(table.sessionId),
}));

export const insertNeuralRoutingSchema = createInsertSchema(neuralRouting).omit({
  id: true,
  createdAt: true,
});
export type InsertNeuralRouting = z.infer<typeof insertNeuralRoutingSchema>;
export type NeuralRouting = typeof neuralRouting.$inferSelect;

// ══════════════════════════════════════════════════════════════════════════════
//                         DRIVER DNA PROFILES
//                    "Where Patterns Become Intelligence"
// ══════════════════════════════════════════════════════════════════════════════

// Driver DNA Profiles - AI-inferred driver scheduling preferences
// Built from historical pattern analysis using Gemini
export const driverDnaProfiles = pgTable("driver_dna_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),

  // Structured preferences (inferred from AI)
  preferredDays: text("preferred_days").array(), // ['sunday', 'monday', 'tuesday', 'wednesday']
  preferredStartTimes: text("preferred_start_times").array(), // ['04:00', '04:30']
  preferredTractors: text("preferred_tractors").array(), // ['Tractor_3', 'Tractor_5']
  preferredContractType: text("preferred_contract_type"), // 'solo1', 'solo2', 'team'
  homeBlocks: text("home_blocks").array(), // Block IDs driver consistently runs

  // Pattern metrics
  consistencyScore: decimal("consistency_score", { precision: 5, scale: 4 }), // 0.0 to 1.0
  patternGroup: text("pattern_group"), // 'sunWed', 'wedSat', 'mixed'
  weeksAnalyzed: integer("weeks_analyzed"),
  assignmentsAnalyzed: integer("assignments_analyzed"),

  // AI-generated content
  aiSummary: text("ai_summary"), // Natural language summary from Gemini
  insights: jsonb("insights"), // Array of insight strings

  // Metadata
  analysisStartDate: timestamp("analysis_start_date"),
  analysisEndDate: timestamp("analysis_end_date"),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  analysisVersion: integer("analysis_version").default(1),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one DNA profile per driver per tenant
  uniqueDriverDna: uniqueIndex("driver_dna_profiles_tenant_driver_idx").on(table.tenantId, table.driverId),
  // Index for pattern group queries
  patternGroupIdx: index("driver_dna_profiles_pattern_group_idx").on(table.patternGroup),
  // Index for consistency score ranking
  consistencyIdx: index("driver_dna_profiles_consistency_idx").on(table.consistencyScore),
}));

export const insertDriverDnaProfileSchema = createInsertSchema(driverDnaProfiles, {
  analysisStartDate: z.coerce.date().optional().nullable(),
  analysisEndDate: z.coerce.date().optional().nullable(),
  lastAnalyzedAt: z.coerce.date().optional().nullable(),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateDriverDnaProfileSchema = insertDriverDnaProfileSchema.omit({ tenantId: true }).partial();
export type InsertDriverDnaProfile = z.infer<typeof insertDriverDnaProfileSchema>;
export type UpdateDriverDnaProfile = z.infer<typeof updateDriverDnaProfileSchema>;
export type DriverDnaProfile = typeof driverDnaProfiles.$inferSelect;
