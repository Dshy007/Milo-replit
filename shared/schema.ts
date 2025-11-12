import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, decimal } from "drizzle-orm/pg-core";
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
  type: text("type").default(""), // tractor, trailer, van, etc.
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  fuel: text("fuel").default(""), // diesel, gas, electric, hybrid
  vin: text("vin").notNull().unique(),
  licensePlate: text("license_plate").notNull(),
  status: text("status").notNull().default("available"), // available, in_use, maintenance, retired
  lastInspection: timestamp("last_inspection"),
  nextInspection: timestamp("next_inspection"),
  // DOT Compliance Fields
  usdotNumber: text("usdot_number").notNull(), // Required for interstate commerce
  gvwr: integer("gvwr").notNull(), // Gross Vehicle Weight Rating in lbs (triggers DOT if >= 10,001)
  registrationExpiry: timestamp("registration_expiry").notNull(),
  insuranceExpiry: timestamp("insurance_expiry").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Base schema without refinements - for frontend .extend() usage
export const baseInsertTruckSchema = createInsertSchema(trucks, {
  lastInspection: z.coerce.date().optional().nullable(),
  nextInspection: z.coerce.date().optional().nullable(),
  registrationExpiry: z.coerce.date(),
  insuranceExpiry: z.coerce.date(),
}).omit({ id: true, createdAt: true, updatedAt: true });

// Full validated schema with refinements - for backend validation
export const insertTruckSchema = baseInsertTruckSchema
.refine((data) => {
  // Validate both inspection dates are provided or neither
  const hasLast = data.lastInspection !== undefined && data.lastInspection !== null;
  const hasNext = data.nextInspection !== undefined && data.nextInspection !== null;
  
  if (hasLast !== hasNext) {
    return false; // Both must be provided or both omitted
  }
  
  // If both provided, validate chronological order and 12-month requirement
  if (hasLast && hasNext) {
    // Next must be after last
    if (data.nextInspection! <= data.lastInspection!) {
      return false;
    }
    // Next must be within 12 calendar months of last (handles leap years)
    const limit = addYears(data.lastInspection!, 1);
    return !isAfter(data.nextInspection!, limit);
  }
  
  return true;
}, {
  message: "Inspection dates must both be provided, in chronological order, and next inspection within 12 months of last (DOT requirement)",
  path: ["nextInspection"],
})
.refine((data) => {
  // Validate registration is not expired
  return data.registrationExpiry > new Date();
}, {
  message: "Vehicle registration must not be expired",
  path: ["registrationExpiry"],
})
.refine((data) => {
  // Validate insurance is not expired
  return data.insuranceExpiry > new Date();
}, {
  message: "Vehicle insurance must not be expired",
  path: ["insuranceExpiry"],
})
.refine((data) => {
  // Validate GVWR is within DOT threshold (10,001+ lbs requires DOT compliance)
  return data.gvwr >= 10001;
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
  if (data.gvwr !== undefined) {
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
