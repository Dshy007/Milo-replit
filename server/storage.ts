import { 
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
  type SpecialRequest, type InsertSpecialRequest
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Tenants
  getTenant(id: string): Promise<Tenant | undefined>;
  createTenant(tenant: InsertTenant): Promise<Tenant>;
  
  // Drivers
  getDriver(id: string): Promise<Driver | undefined>;
  getDriversByTenant(tenantId: string): Promise<Driver[]>;
  createDriver(driver: InsertDriver): Promise<Driver>;
  updateDriver(id: string, driver: Partial<InsertDriver>): Promise<Driver | undefined>;
  deleteDriver(id: string): Promise<boolean>;
  
  // Trucks
  getTruck(id: string): Promise<Truck | undefined>;
  getTrucksByTenant(tenantId: string): Promise<Truck[]>;
  createTruck(truck: InsertTruck): Promise<Truck>;
  updateTruck(id: string, truck: Partial<InsertTruck>): Promise<Truck | undefined>;
  deleteTruck(id: string): Promise<boolean>;
  
  // Routes
  getRoute(id: string): Promise<Route | undefined>;
  getRoutesByTenant(tenantId: string): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined>;
  deleteRoute(id: string): Promise<boolean>;
  
  // Contracts
  getContract(id: string): Promise<Contract | undefined>;
  getContractsByTenant(tenantId: string): Promise<Contract[]>;
  createContract(contract: InsertContract): Promise<Contract>;
  updateContract(id: string, contract: Partial<InsertContract>): Promise<Contract | undefined>;
  deleteContract(id: string): Promise<boolean>;
  
  // Schedules
  getSchedule(id: string): Promise<Schedule | undefined>;
  getSchedulesByTenant(tenantId: string): Promise<Schedule[]>;
  getSchedulesByDriver(driverId: string): Promise<Schedule[]>;
  createSchedule(schedule: InsertSchedule): Promise<Schedule>;
  updateSchedule(id: string, schedule: Partial<InsertSchedule>): Promise<Schedule | undefined>;
  deleteSchedule(id: string): Promise<boolean>;
  
  // Loads
  getLoad(id: string): Promise<Load | undefined>;
  getLoadsByTenant(tenantId: string): Promise<Load[]>;
  createLoad(load: InsertLoad): Promise<Load>;
  updateLoad(id: string, load: Partial<InsertLoad>): Promise<Load | undefined>;
  deleteLoad(id: string): Promise<boolean>;
  
  // Blocks
  getBlock(id: string): Promise<Block | undefined>;
  getBlockByBlockId(blockId: string, tenantId: string): Promise<Block | undefined>;
  getBlocksByTenant(tenantId: string): Promise<Block[]>;
  getBlocksByContract(contractId: string): Promise<Block[]>;
  getBlocksByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<Block[]>;
  createBlock(block: InsertBlock): Promise<Block>;
  updateBlock(id: string, block: Partial<InsertBlock>): Promise<Block | undefined>;
  deleteBlock(id: string): Promise<boolean>;
  
  // Block Assignments
  getBlockAssignment(id: string): Promise<BlockAssignment | undefined>;
  getBlockAssignmentByBlock(blockId: string): Promise<BlockAssignment | undefined>;
  getBlockAssignmentsByDriver(driverId: string): Promise<BlockAssignment[]>;
  getBlockAssignmentsByTenant(tenantId: string): Promise<BlockAssignment[]>;
  getBlockAssignmentsWithBlocksByDriverAndDateRange(
    driverId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<BlockAssignment & { block: Block }>>;
  createBlockAssignment(assignment: InsertBlockAssignment): Promise<BlockAssignment>;
  updateBlockAssignment(id: string, assignment: Partial<InsertBlockAssignment>): Promise<BlockAssignment | undefined>;
  deleteBlockAssignment(id: string): Promise<boolean>;
  
  // Protected Driver Rules
  getProtectedDriverRule(id: string): Promise<ProtectedDriverRule | undefined>;
  getProtectedDriverRulesByDriver(driverId: string): Promise<ProtectedDriverRule[]>;
  getProtectedDriverRulesByTenant(tenantId: string): Promise<ProtectedDriverRule[]>;
  createProtectedDriverRule(rule: InsertProtectedDriverRule): Promise<ProtectedDriverRule>;
  updateProtectedDriverRule(id: string, rule: Partial<InsertProtectedDriverRule>): Promise<ProtectedDriverRule | undefined>;
  deleteProtectedDriverRule(id: string): Promise<boolean>;

  // Special Requests
  getSpecialRequest(id: string): Promise<SpecialRequest | undefined>;
  getSpecialRequestsByTenant(tenantId: string): Promise<SpecialRequest[]>;
  getSpecialRequestsByDriver(driverId: string): Promise<SpecialRequest[]>;
  getSpecialRequestsByStatus(tenantId: string, status: string): Promise<SpecialRequest[]>;
  getSpecialRequestsByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<SpecialRequest[]>;
  createSpecialRequest(request: InsertSpecialRequest): Promise<SpecialRequest>;
  updateSpecialRequest(id: string, request: Partial<InsertSpecialRequest>): Promise<SpecialRequest | undefined>;
  deleteSpecialRequest(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tenants: Map<string, Tenant>;
  private specialRequests: Map<string, SpecialRequest>;
  private drivers: Map<string, Driver>;
  private trucks: Map<string, Truck>;
  private routes: Map<string, Route>;
  private contracts: Map<string, Contract>;
  private schedules: Map<string, Schedule>;
  private loads: Map<string, Load>;
  private blocks: Map<string, Block>;
  private blockAssignments: Map<string, BlockAssignment>;
  private protectedDriverRules: Map<string, ProtectedDriverRule>;

  constructor() {
    this.users = new Map();
    this.tenants = new Map();
    this.drivers = new Map();
    this.trucks = new Map();
    this.routes = new Map();
    this.contracts = new Map();
    this.schedules = new Map();
    this.loads = new Map();
    this.blocks = new Map();
    this.blockAssignments = new Map();
    this.protectedDriverRules = new Map();
    this.specialRequests = new Map();
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { 
      ...insertUser, 
      id,
      role: insertUser.role || "user",
      createdAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  // Tenants
  async getTenant(id: string): Promise<Tenant | undefined> {
    return this.tenants.get(id);
  }

  async createTenant(insertTenant: InsertTenant): Promise<Tenant> {
    const id = randomUUID();
    const tenant: Tenant = { ...insertTenant, id, createdAt: new Date() };
    this.tenants.set(id, tenant);
    return tenant;
  }

  // Drivers
  async getDriver(id: string): Promise<Driver | undefined> {
    return this.drivers.get(id);
  }

  async getDriversByTenant(tenantId: string): Promise<Driver[]> {
    return Array.from(this.drivers.values()).filter(
      (driver) => driver.tenantId === tenantId
    );
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const id = randomUUID();
    const driver: Driver = {
      ...insertDriver,
      id,
      status: insertDriver.status || "active",
      phoneNumber: insertDriver.phoneNumber || null,
      email: insertDriver.email || null,
      certifications: insertDriver.certifications || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.drivers.set(id, driver);
    return driver;
  }

  async updateDriver(id: string, updates: Partial<InsertDriver>): Promise<Driver | undefined> {
    const driver = this.drivers.get(id);
    if (!driver) return undefined;
    
    const updatedDriver = { ...driver, ...updates, updatedAt: new Date() };
    this.drivers.set(id, updatedDriver);
    return updatedDriver;
  }

  async deleteDriver(id: string): Promise<boolean> {
    return this.drivers.delete(id);
  }

  // Trucks
  async getTruck(id: string): Promise<Truck | undefined> {
    return this.trucks.get(id);
  }

  async getTrucksByTenant(tenantId: string): Promise<Truck[]> {
    return Array.from(this.trucks.values()).filter(
      (truck) => truck.tenantId === tenantId
    );
  }

  async createTruck(insertTruck: InsertTruck): Promise<Truck> {
    const id = randomUUID();
    const truck: Truck = {
      ...insertTruck,
      id,
      status: insertTruck.status || "available",
      lastInspection: insertTruck.lastInspection || null,
      nextInspection: insertTruck.nextInspection || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.trucks.set(id, truck);
    return truck;
  }

  async updateTruck(id: string, updates: Partial<InsertTruck>): Promise<Truck | undefined> {
    const truck = this.trucks.get(id);
    if (!truck) return undefined;
    
    const updatedTruck = { ...truck, ...updates, updatedAt: new Date() };
    this.trucks.set(id, updatedTruck);
    return updatedTruck;
  }

  async deleteTruck(id: string): Promise<boolean> {
    return this.trucks.delete(id);
  }

  // Routes
  async getRoute(id: string): Promise<Route | undefined> {
    return this.routes.get(id);
  }

  async getRoutesByTenant(tenantId: string): Promise<Route[]> {
    return Array.from(this.routes.values()).filter(
      (route) => route.tenantId === tenantId
    );
  }

  async createRoute(insertRoute: InsertRoute): Promise<Route> {
    const id = randomUUID();
    const route: Route = {
      ...insertRoute,
      id,
      distance: insertRoute.distance || null,
      estimatedDuration: insertRoute.estimatedDuration || null,
      notes: insertRoute.notes || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.routes.set(id, route);
    return route;
  }

  async updateRoute(id: string, updates: Partial<InsertRoute>): Promise<Route | undefined> {
    const route = this.routes.get(id);
    if (!route) return undefined;
    
    const updatedRoute = { ...route, ...updates, updatedAt: new Date() };
    this.routes.set(id, updatedRoute);
    return updatedRoute;
  }

  async deleteRoute(id: string): Promise<boolean> {
    return this.routes.delete(id);
  }

  // Contracts
  async getContract(id: string): Promise<Contract | undefined> {
    return this.contracts.get(id);
  }

  async getContractsByTenant(tenantId: string): Promise<Contract[]> {
    return Array.from(this.contracts.values()).filter(
      (contract) => contract.tenantId === tenantId
    );
  }

  async createContract(insertContract: InsertContract): Promise<Contract> {
    const id = randomUUID();
    const contract: Contract = {
      ...insertContract,
      id,
      daysPerWeek: insertContract.daysPerWeek || 6,
      protectedDrivers: insertContract.protectedDrivers || false,
      createdAt: new Date()
    };
    this.contracts.set(id, contract);
    return contract;
  }

  async updateContract(id: string, updates: Partial<InsertContract>): Promise<Contract | undefined> {
    const contract = this.contracts.get(id);
    if (!contract) return undefined;
    
    const updatedContract = { ...contract, ...updates };
    this.contracts.set(id, updatedContract);
    return updatedContract;
  }

  async deleteContract(id: string): Promise<boolean> {
    return this.contracts.delete(id);
  }

  // Schedules
  async getSchedule(id: string): Promise<Schedule | undefined> {
    return this.schedules.get(id);
  }

  async getSchedulesByTenant(tenantId: string): Promise<Schedule[]> {
    return Array.from(this.schedules.values()).filter(
      (schedule) => schedule.tenantId === tenantId
    );
  }

  async getSchedulesByDriver(driverId: string): Promise<Schedule[]> {
    return Array.from(this.schedules.values()).filter(
      (schedule) => schedule.driverId === driverId
    );
  }

  async createSchedule(insertSchedule: InsertSchedule): Promise<Schedule> {
    const id = randomUUID();
    const schedule: Schedule = {
      ...insertSchedule,
      id,
      truckId: insertSchedule.truckId || null,
      routeId: insertSchedule.routeId || null,
      contractId: insertSchedule.contractId || null,
      startTime: insertSchedule.startTime || null,
      endTime: insertSchedule.endTime || null,
      status: insertSchedule.status || "scheduled",
      notes: insertSchedule.notes || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.schedules.set(id, schedule);
    return schedule;
  }

  async updateSchedule(id: string, updates: Partial<InsertSchedule>): Promise<Schedule | undefined> {
    const schedule = this.schedules.get(id);
    if (!schedule) return undefined;
    
    const updatedSchedule = { ...schedule, ...updates, updatedAt: new Date() };
    this.schedules.set(id, updatedSchedule);
    return updatedSchedule;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    return this.schedules.delete(id);
  }

  // Loads
  async getLoad(id: string): Promise<Load | undefined> {
    return this.loads.get(id);
  }

  async getLoadsByTenant(tenantId: string): Promise<Load[]> {
    return Array.from(this.loads.values()).filter(
      (load) => load.tenantId === tenantId
    );
  }

  async createLoad(insertLoad: InsertLoad): Promise<Load> {
    const id = randomUUID();
    const load: Load = {
      ...insertLoad,
      id,
      scheduleId: insertLoad.scheduleId || null,
      weight: insertLoad.weight || null,
      description: insertLoad.description || null,
      status: insertLoad.status || "pending",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.loads.set(id, load);
    return load;
  }

  async updateLoad(id: string, updates: Partial<InsertLoad>): Promise<Load | undefined> {
    const load = this.loads.get(id);
    if (!load) return undefined;
    
    const updatedLoad = { ...load, ...updates, updatedAt: new Date() };
    this.loads.set(id, updatedLoad);
    return updatedLoad;
  }

  async deleteLoad(id: string): Promise<boolean> {
    return this.loads.delete(id);
  }

  // Blocks
  async getBlock(id: string): Promise<Block | undefined> {
    return this.blocks.get(id);
  }

  async getBlockByBlockId(blockId: string, tenantId: string): Promise<Block | undefined> {
    return Array.from(this.blocks.values()).find(
      (block) => block.blockId === blockId && block.tenantId === tenantId
    );
  }

  async getBlocksByTenant(tenantId: string): Promise<Block[]> {
    return Array.from(this.blocks.values()).filter(
      (block) => block.tenantId === tenantId
    );
  }

  async getBlocksByContract(contractId: string): Promise<Block[]> {
    return Array.from(this.blocks.values()).filter(
      (block) => block.contractId === contractId
    );
  }

  async getBlocksByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<Block[]> {
    return Array.from(this.blocks.values()).filter(
      (block) => 
        block.tenantId === tenantId &&
        block.startDate >= startDate &&
        block.startDate <= endDate
    );
  }

  async createBlock(insertBlock: InsertBlock): Promise<Block> {
    const id = randomUUID();
    const block: Block = {
      ...insertBlock,
      id,
      validationMetadata: insertBlock.validationMetadata || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.blocks.set(id, block);
    return block;
  }

  async updateBlock(id: string, updates: Partial<InsertBlock>): Promise<Block | undefined> {
    const block = this.blocks.get(id);
    if (!block) return undefined;
    
    const updatedBlock = { ...block, ...updates, updatedAt: new Date() };
    this.blocks.set(id, updatedBlock);
    return updatedBlock;
  }

  async deleteBlock(id: string): Promise<boolean> {
    return this.blocks.delete(id);
  }

  // Block Assignments
  async getBlockAssignment(id: string): Promise<BlockAssignment | undefined> {
    return this.blockAssignments.get(id);
  }

  async getBlockAssignmentByBlock(blockId: string): Promise<BlockAssignment | undefined> {
    return Array.from(this.blockAssignments.values()).find(
      (assignment) => assignment.blockId === blockId
    );
  }

  async getBlockAssignmentsByDriver(driverId: string): Promise<BlockAssignment[]> {
    return Array.from(this.blockAssignments.values()).filter(
      (assignment) => assignment.driverId === driverId
    );
  }

  async getBlockAssignmentsByTenant(tenantId: string): Promise<BlockAssignment[]> {
    return Array.from(this.blockAssignments.values()).filter(
      (assignment) => assignment.tenantId === tenantId
    );
  }

  async getBlockAssignmentsWithBlocksByDriverAndDateRange(
    driverId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<BlockAssignment & { block: Block }>> {
    const assignments = Array.from(this.blockAssignments.values()).filter(
      (assignment) => assignment.driverId === driverId && assignment.tenantId === tenantId
    );

    const result: Array<BlockAssignment & { block: Block }> = [];
    for (const assignment of assignments) {
      const block = this.blocks.get(assignment.blockId);
      // CRITICAL: Check for overlap, not just start time within window
      // A block overlaps if: blockStart < windowEnd AND blockEnd > windowStart
      // Also ensure block belongs to the same tenant
      if (block && block.tenantId === tenantId && block.startTimestamp <= endDate && block.endTimestamp >= startDate) {
        result.push({ ...assignment, block });
      }
    }

    return result;
  }

  async createBlockAssignment(insertAssignment: InsertBlockAssignment): Promise<BlockAssignment> {
    const id = randomUUID();
    const assignment: BlockAssignment = {
      ...insertAssignment,
      id,
      validationMetadata: insertAssignment.validationMetadata || null,
      assignedAt: new Date()
    };
    this.blockAssignments.set(id, assignment);
    return assignment;
  }

  async updateBlockAssignment(id: string, updates: Partial<InsertBlockAssignment>): Promise<BlockAssignment | undefined> {
    const assignment = this.blockAssignments.get(id);
    if (!assignment) return undefined;
    
    const updatedAssignment = { ...assignment, ...updates };
    this.blockAssignments.set(id, updatedAssignment);
    return updatedAssignment;
  }

  async deleteBlockAssignment(id: string): Promise<boolean> {
    return this.blockAssignments.delete(id);
  }

  // Protected Driver Rules
  async getProtectedDriverRule(id: string): Promise<ProtectedDriverRule | undefined> {
    return this.protectedDriverRules.get(id);
  }

  async getProtectedDriverRulesByDriver(driverId: string): Promise<ProtectedDriverRule[]> {
    return Array.from(this.protectedDriverRules.values()).filter(
      (rule) => rule.driverId === driverId
    );
  }

  async getProtectedDriverRulesByTenant(tenantId: string): Promise<ProtectedDriverRule[]> {
    return Array.from(this.protectedDriverRules.values()).filter(
      (rule) => rule.tenantId === tenantId
    );
  }

  async createProtectedDriverRule(insertRule: InsertProtectedDriverRule): Promise<ProtectedDriverRule> {
    const id = randomUUID();
    const rule: ProtectedDriverRule = {
      ...insertRule,
      id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.protectedDriverRules.set(id, rule);
    return rule;
  }

  async updateProtectedDriverRule(id: string, updates: Partial<InsertProtectedDriverRule>): Promise<ProtectedDriverRule | undefined> {
    const rule = this.protectedDriverRules.get(id);
    if (!rule) return undefined;
    
    const updatedRule = { ...rule, ...updates, updatedAt: new Date() };
    this.protectedDriverRules.set(id, updatedRule);
    return updatedRule;
  }

  async deleteProtectedDriverRule(id: string): Promise<boolean> {
    return this.protectedDriverRules.delete(id);
  }

  // Special Requests
  async getSpecialRequest(id: string): Promise<SpecialRequest | undefined> {
    return this.specialRequests.get(id);
  }

  async getSpecialRequestsByTenant(tenantId: string): Promise<SpecialRequest[]> {
    return Array.from(this.specialRequests.values()).filter(
      (req) => req.tenantId === tenantId
    );
  }

  async getSpecialRequestsByDriver(driverId: string): Promise<SpecialRequest[]> {
    return Array.from(this.specialRequests.values()).filter(
      (req) => req.driverId === driverId
    );
  }

  async getSpecialRequestsByStatus(tenantId: string, status: string): Promise<SpecialRequest[]> {
    return Array.from(this.specialRequests.values()).filter(
      (req) => req.tenantId === tenantId && req.status === status
    );
  }

  async getSpecialRequestsByDateRange(tenantId: string, startDate: Date, endDate: Date): Promise<SpecialRequest[]> {
    return Array.from(this.specialRequests.values()).filter(
      (req) => 
        req.tenantId === tenantId &&
        req.affectedDate >= startDate &&
        req.affectedDate <= endDate
    );
  }

  async createSpecialRequest(request: InsertSpecialRequest): Promise<SpecialRequest> {
    const id = randomUUID();
    const now = new Date();
    const newRequest: SpecialRequest = {
      ...request,
      id,
      requestedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      notes: request.notes || null,
      affectedBlockId: request.affectedBlockId || null,
      swapCandidateId: request.swapCandidateId || null,
      reason: request.reason || null,
      createdAt: now,
      updatedAt: now,
    };
    this.specialRequests.set(id, newRequest);
    return newRequest;
  }

  async updateSpecialRequest(id: string, updates: Partial<InsertSpecialRequest>): Promise<SpecialRequest | undefined> {
    const existing = this.specialRequests.get(id);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.specialRequests.set(id, updated);
    return updated;
  }

  async deleteSpecialRequest(id: string): Promise<boolean> {
    return this.specialRequests.delete(id);
  }
}

export const storage = new MemStorage();
