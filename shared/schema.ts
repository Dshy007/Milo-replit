import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
  licenseNumber: text("license_number").notNull(),
  licenseExpiry: timestamp("license_expiry").notNull(),
  phoneNumber: text("phone_number"),
  email: text("email"),
  status: text("status").notNull().default("active"), // active, inactive, on_leave
  certifications: text("certifications").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDriverSchema = createInsertSchema(drivers, {
  licenseExpiry: z.coerce.date(),
}).omit({ id: true, createdAt: true, updatedAt: true });
export const updateDriverSchema = insertDriverSchema.omit({ tenantId: true }).partial();
export type InsertDriver = z.infer<typeof insertDriverSchema>;
export type UpdateDriver = z.infer<typeof updateDriverSchema>;
export type Driver = typeof drivers.$inferSelect;

// Trucks/Vehicles
export const trucks = pgTable("trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  truckNumber: text("truck_number").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin").notNull().unique(),
  licensePlate: text("license_plate").notNull(),
  status: text("status").notNull().default("available"), // available, in_use, maintenance, retired
  lastInspection: timestamp("last_inspection"),
  nextInspection: timestamp("next_inspection"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTruckSchema = createInsertSchema(trucks).omit({ id: true, createdAt: true, updatedAt: true });
export const updateTruckSchema = insertTruckSchema.omit({ tenantId: true }).partial();
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
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRouteSchema = createInsertSchema(routes).omit({ id: true, createdAt: true, updatedAt: true });
export const updateRouteSchema = insertRouteSchema.omit({ tenantId: true }).partial();
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type UpdateRoute = z.infer<typeof updateRouteSchema>;
export type Route = typeof routes.$inferSelect;

// Contracts
export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), // e.g., "Solo1", "Solo2"
  type: text("type").notNull(), // solo1, solo2, team
  baseRoutes: integer("base_routes").notNull(), // number of base routes (10 for Solo1, 7 for Solo2)
  daysPerWeek: integer("days_per_week").notNull().default(6), // rolling 6-day pattern
  protectedDrivers: boolean("protected_drivers").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  status: text("status").notNull().default("pending"), // pending, picked_up, in_transit, delivered, cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLoadSchema = createInsertSchema(loads).omit({ id: true, createdAt: true, updatedAt: true });
export const updateLoadSchema = insertLoadSchema.omit({ tenantId: true }).partial();
export type InsertLoad = z.infer<typeof insertLoadSchema>;
export type UpdateLoad = z.infer<typeof updateLoadSchema>;
export type Load = typeof loads.$inferSelect;
