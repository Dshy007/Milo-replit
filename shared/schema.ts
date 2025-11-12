import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, decimal, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { addYears, isAfter } from "date-fns";

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
  // DOT Compliance Fields - Optional for tracking, validated if provided
  requiresDotCompliance: boolean("requires_dot_compliance").default(false), // If true, DOT fields become mandatory
  cdlClass: text("cdl_class"), // A, B, or C
  medicalCertExpiry: timestamp("medical_cert_expiry"), // DOT medical certification
  dateOfBirth: timestamp("date_of_birth"), // To validate age >= 21
  endorsements: text("endorsements"), // H (Hazmat), N (Tank), T (Doubles/Triples), P (Passenger), S (School Bus), X (Hazmat+Tank)
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
export const blocks = pgTable("blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockId: text("block_id").notNull(), // e.g., "B-00000001"
  contractId: varchar("contract_id").notNull().references(() => contracts.id),
  startTimestamp: timestamp("start_timestamp").notNull(), // Full start date+time in CT
  endTimestamp: timestamp("end_timestamp").notNull(), // Calculated: startTimestamp + duration
  tractorId: text("tractor_id").notNull(), // e.g., "Tractor_1"
  soloType: text("solo_type").notNull(), // solo1, solo2, team
  duration: integer("duration").notNull(), // hours: 14 for Solo1, 38 for Solo2
  status: text("status").notNull().default("unassigned"), // unassigned, assigned, completed, cancelled
  isCarryover: boolean("is_carryover").notNull().default(false), // True for Fri/Sat from previous week
  onBenchStatus: text("on_bench_status").notNull().default("on_bench"), // on_bench, off_bench
  offBenchReason: text("off_bench_reason"), // non_contract_time, wrong_tractor_for_contract
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one block per (tenant, blockId)
  uniqueBlockId: uniqueIndex("blocks_tenant_block_idx").on(table.tenantId, table.blockId),
  // Index for time range queries
  timeRangeIdx: index("blocks_time_range_idx").on(table.startTimestamp, table.endTimestamp),
}));

export const insertBlockSchema = createInsertSchema(blocks, {
  startTimestamp: z.coerce.date(),
  endTimestamp: z.coerce.date(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateBlockSchema = insertBlockSchema.omit({ tenantId: true }).partial();
export type InsertBlock = z.infer<typeof insertBlockSchema>;
export type UpdateBlock = z.infer<typeof updateBlockSchema>;
export type Block = typeof blocks.$inferSelect;

// Block Assignments (Link blocks to drivers with validation)
export const blockAssignments = pgTable("block_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  blockId: varchar("block_id").notNull().references(() => blocks.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  assignedBy: varchar("assigned_by").references(() => users.id), // User who made the assignment
  notes: text("notes"),
  validationStatus: text("validation_status").notNull().default("valid"), // valid, warning, violation
  validationSummary: text("validation_summary"), // JSONB string with rolling-6 metrics, warnings, reasons
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Unique constraint: one driver per block
  uniqueBlockAssignment: uniqueIndex("block_assignments_tenant_block_idx").on(table.tenantId, table.blockId),
  // Index for driver lookups
  driverIdIdx: index("block_assignments_driver_id_idx").on(table.driverId),
  // Index for tenant+driver+time queries
  driverTimeIdx: index("block_assignments_driver_time_idx").on(table.tenantId, table.driverId, table.assignedAt),
}));

export const insertBlockAssignmentSchema = createInsertSchema(blockAssignments, {
  assignedAt: z.coerce.date().optional(),
}).omit({ id: true, createdAt: true });
export const updateBlockAssignmentSchema = insertBlockAssignmentSchema.omit({ tenantId: true }).partial();
export type InsertBlockAssignment = z.infer<typeof insertBlockAssignmentSchema>;
export type UpdateBlockAssignment = z.infer<typeof updateBlockAssignmentSchema>;
export type BlockAssignment = typeof blockAssignments.$inferSelect;

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

// Special Requests (Time-off, shift swaps, and scheduling requests)
export const specialRequests = pgTable("special_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  driverId: varchar("driver_id").notNull().references(() => drivers.id),
  requestType: text("request_type").notNull(), // time_off, swap
  affectedDate: timestamp("affected_date").notNull(), // The date they need off
  affectedBlockId: varchar("affected_block_id").references(() => blocks.id), // Optional - specific block to swap
  reason: text("reason"), // Why they need time off
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  swapCandidateId: varchar("swap_candidate_id").references(() => drivers.id), // Driver assigned to cover (if approved)
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id), // User who approved/rejected
  notes: text("notes"), // Admin notes about the request
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Index for driver lookups
  driverIdIdx: index("special_requests_driver_id_idx").on(table.driverId),
  // Index for date range queries
  affectedDateIdx: index("special_requests_affected_date_idx").on(table.affectedDate),
  // Index for status filtering
  statusIdx: index("special_requests_status_idx").on(table.status),
  // Check constraint for request_type enum
  requestTypeCheck: check("request_type_check", sql`${table.requestType} IN ('time_off', 'swap')`),
  // Check constraint for status enum
  statusCheck: check("status_check", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
}));

export const insertSpecialRequestSchema = createInsertSchema(specialRequests, {
  affectedDate: z.coerce.date(),
  reviewedAt: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateSpecialRequestSchema = insertSpecialRequestSchema.omit({ tenantId: true }).partial();
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
