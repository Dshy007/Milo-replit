import { db } from "./db";
import { 
  users, tenants, drivers, trucks, routes, contracts, schedules, loads,
  blocks, blockAssignments, protectedDriverRules, specialRequests, driverAvailabilityPreferences,
  shiftOccurrences,
  type User, type InsertUser,
  type Tenant, type InsertTenant,
  type Driver, type InsertDriver,
  type Truck, type InsertTruck,
  type Route, type InsertRoute,
  type Contract, type InsertContract,
  type Schedule, type InsertSchedule,
  type Load, type InsertLoad,
  type Block, type InsertBlock,
  type BlockAssignment, type InsertBlockAssignment,
  type ProtectedDriverRule, type InsertProtectedDriverRule,
  type SpecialRequest, type InsertSpecialRequest,
  type DriverAvailabilityPreference, type InsertDriverAvailabilityPreference,
  type ShiftOccurrence
} from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
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

  // Driver Availability Preferences
  async getDriverAvailabilityPreferences(
    tenantId: string, 
    driverId?: string
  ): Promise<DriverAvailabilityPreference[]> {
    if (driverId) {
      return await db.select()
        .from(driverAvailabilityPreferences)
        .where(
          and(
            eq(driverAvailabilityPreferences.tenantId, tenantId),
            eq(driverAvailabilityPreferences.driverId, driverId)
          )
        );
    }
    return await db.select()
      .from(driverAvailabilityPreferences)
      .where(eq(driverAvailabilityPreferences.tenantId, tenantId));
  }

  async createDriverAvailabilityPreference(
    insertPref: InsertDriverAvailabilityPreference
  ): Promise<DriverAvailabilityPreference> {
    const result = await db.insert(driverAvailabilityPreferences).values(insertPref).returning();
    return result[0];
  }

  async deleteDriverAvailabilityPreferences(driverId: string): Promise<boolean> {
    const result = await db.delete(driverAvailabilityPreferences)
      .where(eq(driverAvailabilityPreferences.driverId, driverId))
      .returning();
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

  async findContractsByTenantStartTimeAndType(
    tenantId: string, 
    startTime: string, 
    type: string
  ): Promise<Contract[]> {
    return await db.select().from(contracts).where(
      and(
        eq(contracts.tenantId, tenantId),
        eq(contracts.startTime, startTime),
        eq(contracts.type, type)
      )
    );
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

  async getSchedulesByDriver(driverId: string, tenantId: string): Promise<Schedule[]> {
    return await db.select().from(schedules)
      .where(and(eq(schedules.driverId, driverId), eq(schedules.tenantId, tenantId)));
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

  // Blocks
  async getBlock(id: string): Promise<Block | undefined> {
    const result = await db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
    return result[0];
  }

  async getBlockByBlockId(blockId: string, tenantId: string): Promise<Block | undefined> {
    const result = await db.select().from(blocks)
      .where(and(eq(blocks.blockId, blockId), eq(blocks.tenantId, tenantId)))
      .limit(1);
    return result[0];
  }

  async getBlocksByTenant(tenantId: string): Promise<Block[]> {
    return await db.select().from(blocks).where(eq(blocks.tenantId, tenantId));
  }

  async getBlocksByContract(contractId: string): Promise<Block[]> {
    return await db.select().from(blocks).where(eq(blocks.contractId, contractId));
  }

  async getBlocksByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<Block[]> {
    return await db.select().from(blocks)
      .where(
        and(
          eq(blocks.tenantId, tenantId),
          gte(blocks.startTimestamp, startDate),
          lte(blocks.startTimestamp, endDate)
        )
      );
  }

  async getBlocksByDateRangeOverlapping(tenantId: string, startDate: Date, endDate: Date): Promise<Block[]> {
    // A block overlaps if: blockStart <= rangeEnd AND blockEnd >= rangeStart
    return await db.select().from(blocks)
      .where(
        and(
          eq(blocks.tenantId, tenantId),
          lte(blocks.startTimestamp, endDate),
          gte(blocks.endTimestamp, startDate)
        )
      );
  }

  async createBlock(insertBlock: InsertBlock): Promise<Block> {
    const result = await db.insert(blocks).values(insertBlock).returning();
    return result[0];
  }

  async updateBlock(id: string, updates: Partial<InsertBlock>): Promise<Block | undefined> {
    const result = await db.update(blocks).set(updates).where(eq(blocks.id, id)).returning();
    return result[0];
  }

  async deleteBlock(id: string): Promise<boolean> {
    const result = await db.delete(blocks).where(eq(blocks.id, id)).returning();
    return result.length > 0;
  }

  // Shift Occurrences
  async getShiftOccurrence(id: string, tenantId: string): Promise<ShiftOccurrence | undefined> {
    const result = await db.select()
      .from(shiftOccurrences)
      .where(and(eq(shiftOccurrences.id, id), eq(shiftOccurrences.tenantId, tenantId)))
      .limit(1);
    return result[0];
  }

  async deleteShiftOccurrence(id: string, tenantId: string): Promise<boolean> {
    // Delete in transaction with tenant scoping for multi-tenant safety
    const result = await db.transaction(async (tx) => {
      // First verify the shift occurrence exists and belongs to this tenant
      const occurrence = await tx.select()
        .from(shiftOccurrences)
        .where(and(eq(shiftOccurrences.id, id), eq(shiftOccurrences.tenantId, tenantId)))
        .limit(1);
      
      if (occurrence.length === 0) {
        return false; // Not found or wrong tenant
      }
      
      // Delete any assignments for this shift occurrence (tenant-scoped)
      await tx.delete(blockAssignments)
        .where(and(
          eq(blockAssignments.shiftOccurrenceId, id),
          eq(blockAssignments.tenantId, tenantId)
        ));
      
      // Delete the shift occurrence (tenant-scoped)
      const deleted = await tx.delete(shiftOccurrences)
        .where(and(eq(shiftOccurrences.id, id), eq(shiftOccurrences.tenantId, tenantId)))
        .returning();
      
      return deleted.length > 0;
    });
    
    return result;
  }

  // Block Assignments
  async getBlockAssignment(id: string): Promise<BlockAssignment | undefined> {
    const result = await db.select().from(blockAssignments).where(eq(blockAssignments.id, id)).limit(1);
    return result[0];
  }

  async getBlockAssignmentByBlock(blockId: string): Promise<BlockAssignment | undefined> {
    const result = await db.select().from(blockAssignments)
      .where(eq(blockAssignments.blockId, blockId))
      .limit(1);
    return result[0];
  }

  async getBlockAssignmentsByDriver(driverId: string): Promise<BlockAssignment[]> {
    return await db.select().from(blockAssignments).where(eq(blockAssignments.driverId, driverId));
  }

  async getBlockAssignmentsByTenant(tenantId: string): Promise<BlockAssignment[]> {
    return await db.select().from(blockAssignments).where(eq(blockAssignments.tenantId, tenantId));
  }

  async getBlockAssignmentsWithBlocksByDriverAndDateRange(
    driverId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<BlockAssignment & { block: Block }>> {
    // CRITICAL: Query must capture ALL blocks that overlap the time window
    // A block overlaps if: blockStart < windowEnd AND blockEnd > windowStart
    // This catches blocks that started before the window but are still running
    // SECURITY: Add explicit tenantId scoping to prevent cross-tenant leakage
    const result = await db
      .select()
      .from(blockAssignments)
      .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
      .where(
        and(
          eq(blockAssignments.driverId, driverId),
          eq(blockAssignments.tenantId, tenantId),
          eq(blocks.tenantId, tenantId),
          lte(blocks.startTimestamp, endDate),   // Block must start before window ends
          gte(blocks.endTimestamp, startDate)     // Block must end after window starts
        )
      );

    return result.map((row) => ({
      ...row.block_assignments,
      block: row.blocks,
    }));
  }

  async createBlockAssignment(assignment: InsertBlockAssignment): Promise<BlockAssignment> {
    const result = await db.insert(blockAssignments).values(assignment).returning();
    return result[0];
  }

  async updateBlockAssignment(id: string, updates: Partial<InsertBlockAssignment>): Promise<BlockAssignment | undefined> {
    const result = await db.update(blockAssignments).set(updates).where(eq(blockAssignments.id, id)).returning();
    return result[0];
  }

  async deleteBlockAssignment(id: string): Promise<boolean> {
    const result = await db.delete(blockAssignments).where(eq(blockAssignments.id, id)).returning();
    return result.length > 0;
  }

  // Protected Driver Rules
  async getProtectedDriverRule(id: string): Promise<ProtectedDriverRule | undefined> {
    const result = await db.select().from(protectedDriverRules).where(eq(protectedDriverRules.id, id)).limit(1);
    return result[0];
  }

  async getProtectedDriverRulesByDriver(driverId: string): Promise<ProtectedDriverRule[]> {
    return await db.select().from(protectedDriverRules).where(eq(protectedDriverRules.driverId, driverId));
  }

  async getProtectedDriverRulesByTenant(tenantId: string): Promise<ProtectedDriverRule[]> {
    return await db.select().from(protectedDriverRules).where(eq(protectedDriverRules.tenantId, tenantId));
  }

  async createProtectedDriverRule(rule: InsertProtectedDriverRule): Promise<ProtectedDriverRule> {
    const result = await db.insert(protectedDriverRules).values(rule).returning();
    return result[0];
  }

  async updateProtectedDriverRule(id: string, updates: Partial<InsertProtectedDriverRule>): Promise<ProtectedDriverRule | undefined> {
    const result = await db.update(protectedDriverRules).set(updates).where(eq(protectedDriverRules.id, id)).returning();
    return result[0];
  }

  async deleteProtectedDriverRule(id: string): Promise<boolean> {
    const result = await db.delete(protectedDriverRules).where(eq(protectedDriverRules.id, id)).returning();
    return result.length > 0;
  }

  // Special Requests
  async getSpecialRequest(id: string): Promise<SpecialRequest | undefined> {
    const result = await db.select().from(specialRequests).where(eq(specialRequests.id, id)).limit(1);
    return result[0];
  }

  async getSpecialRequestsByTenant(tenantId: string): Promise<SpecialRequest[]> {
    return await db.select().from(specialRequests).where(eq(specialRequests.tenantId, tenantId));
  }

  async getSpecialRequestsByDriver(tenantId: string, driverId: string): Promise<SpecialRequest[]> {
    return await db.select().from(specialRequests)
      .where(and(eq(specialRequests.tenantId, tenantId), eq(specialRequests.driverId, driverId)));
  }

  async getSpecialRequestsByStatus(tenantId: string, status: string): Promise<SpecialRequest[]> {
    return await db.select().from(specialRequests)
      .where(and(eq(specialRequests.tenantId, tenantId), eq(specialRequests.status, status)));
  }

  async getSpecialRequestsByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<SpecialRequest[]> {
    return await db.select().from(specialRequests)
      .where(
        and(
          eq(specialRequests.tenantId, tenantId),
          gte(specialRequests.affectedDate, startDate),
          lte(specialRequests.affectedDate, endDate)
        )
      );
  }

  async createSpecialRequest(request: InsertSpecialRequest): Promise<SpecialRequest> {
    const result = await db.insert(specialRequests).values(request).returning();
    return result[0];
  }

  async updateSpecialRequest(id: string, updates: Partial<InsertSpecialRequest>): Promise<SpecialRequest | undefined> {
    const result = await db.update(specialRequests).set(updates).where(eq(specialRequests.id, id)).returning();
    return result[0];
  }

  async deleteSpecialRequest(id: string): Promise<boolean> {
    const result = await db.delete(specialRequests).where(eq(specialRequests.id, id)).returning();
    return result.length > 0;
  }
}

export const dbStorage = new DbStorage();
