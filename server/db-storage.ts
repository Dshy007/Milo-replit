import { db } from "./db";
import { 
  users, tenants, drivers, trucks, routes, contracts, schedules, loads,
  type User, type InsertUser,
  type Tenant, type InsertTenant,
  type Driver, type InsertDriver,
  type Truck, type InsertTruck,
  type Route, type InsertRoute,
  type Contract, type InsertContract,
  type Schedule, type InsertSchedule,
  type Load, type InsertLoad
} from "@shared/schema";
import { eq } from "drizzle-orm";
import type { IStorage } from "./storage";

export class DbStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Tenants
  async getTenant(id: string): Promise<Tenant | undefined> {
    const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return result[0];
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const result = await db.insert(tenants).values(insertTenant).returning();
    return result[0];
  }

  // Drivers
  async getDriver(id: string): Promise<Driver | undefined> {
    const result = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
    return result[0];
  }

  async getDriversByTenant(tenantId: string): Promise<Driver[]> {
    return await db.select().from(drivers).where(eq(drivers.tenantId, tenantId));
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const result = await db.insert(drivers).values(insertDriver).returning();
    return result[0];
  }

  async updateDriver(id: string, updates: Partial<InsertDriver>): Promise<Driver | undefined> {
    const result = await db.update(drivers).set(updates).where(eq(drivers.id, id)).returning();
    return result[0];
  }

  async deleteDriver(id: string): Promise<boolean> {
    const result = await db.delete(drivers).where(eq(drivers.id, id)).returning();
    return result.length > 0;
  }

  // Trucks
  async getTruck(id: string): Promise<Truck | undefined> {
    const result = await db.select().from(trucks).where(eq(trucks.id, id)).limit(1);
    return result[0];
  }

  async getTrucksByTenant(tenantId: string): Promise<Truck[]> {
    return await db.select().from(trucks).where(eq(trucks.tenantId, tenantId));
  }

  async createTruck(insertTruck: InsertTruck): Promise<Truck> {
    const result = await db.insert(trucks).values(insertTruck).returning();
    return result[0];
  }

  async updateTruck(id: string, updates: Partial<InsertTruck>): Promise<Truck | undefined> {
    const result = await db.update(trucks).set(updates).where(eq(trucks.id, id)).returning();
    return result[0];
  }

  async deleteTruck(id: string): Promise<boolean> {
    const result = await db.delete(trucks).where(eq(trucks.id, id)).returning();
    return result.length > 0;
  }

  // Routes
  async getRoute(id: string): Promise<Route | undefined> {
    const result = await db.select().from(routes).where(eq(routes.id, id)).limit(1);
    return result[0];
  }

  async getRoutesByTenant(tenantId: string): Promise<Route[]> {
    return await db.select().from(routes).where(eq(routes.tenantId, tenantId));
  }

  async createRoute(insertRoute: InsertRoute): Promise<Route> {
    const result = await db.insert(routes).values(insertRoute).returning();
    return result[0];
  }

  async updateRoute(id: string, updates: Partial<InsertRoute>): Promise<Route | undefined> {
    const result = await db.update(routes).set(updates).where(eq(routes.id, id)).returning();
    return result[0];
  }

  async deleteRoute(id: string): Promise<boolean> {
    const result = await db.delete(routes).where(eq(routes.id, id)).returning();
    return result.length > 0;
  }

  // Contracts
  async getContract(id: string): Promise<Contract | undefined> {
    const result = await db.select().from(contracts).where(eq(contracts.id, id)).limit(1);
    return result[0];
  }

  async getContractsByTenant(tenantId: string): Promise<Contract[]> {
    return await db.select().from(contracts).where(eq(contracts.tenantId, tenantId));
  }

  async createContract(insertContract: InsertContract): Promise<Contract> {
    const result = await db.insert(contracts).values(insertContract).returning();
    return result[0];
  }

  async updateContract(id: string, updates: Partial<InsertContract>): Promise<Contract | undefined> {
    const result = await db.update(contracts).set(updates).where(eq(contracts.id, id)).returning();
    return result[0];
  }

  async deleteContract(id: string): Promise<boolean> {
    const result = await db.delete(contracts).where(eq(contracts.id, id)).returning();
    return result.length > 0;
  }

  // Schedules
  async getSchedule(id: string): Promise<Schedule | undefined> {
    const result = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    return result[0];
  }

  async getSchedulesByTenant(tenantId: string): Promise<Schedule[]> {
    return await db.select().from(schedules).where(eq(schedules.tenantId, tenantId));
  }

  async getSchedulesByDriver(driverId: string): Promise<Schedule[]> {
    return await db.select().from(schedules).where(eq(schedules.driverId, driverId));
  }

  async createSchedule(insertSchedule: InsertSchedule): Promise<Schedule> {
    const result = await db.insert(schedules).values(insertSchedule).returning();
    return result[0];
  }

  async updateSchedule(id: string, updates: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const result = await db.update(schedules).set(updates).where(eq(schedules.id, id)).returning();
    return result[0];
  }

  async deleteSchedule(id: string): Promise<boolean> {
    const result = await db.delete(schedules).where(eq(schedules.id, id)).returning();
    return result.length > 0;
  }

  // Loads
  async getLoad(id: string): Promise<Load | undefined> {
    const result = await db.select().from(loads).where(eq(loads.id, id)).limit(1);
    return result[0];
  }

  async getLoadsByTenant(tenantId: string): Promise<Load[]> {
    return await db.select().from(loads).where(eq(loads.tenantId, tenantId));
  }

  async createLoad(insertLoad: InsertLoad): Promise<Load> {
    const result = await db.insert(loads).values(insertLoad).returning();
    return result[0];
  }

  async updateLoad(id: string, updates: Partial<InsertLoad>): Promise<Load | undefined> {
    const result = await db.update(loads).set(updates).where(eq(loads.id, id)).returning();
    return result[0];
  }

  async deleteLoad(id: string): Promise<boolean> {
    const result = await db.delete(loads).where(eq(loads.id, id)).returning();
    return result.length > 0;
  }
}

export const dbStorage = new DbStorage();
