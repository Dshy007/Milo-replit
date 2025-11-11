import { 
  type User, type InsertUser,
  type Tenant, type InsertTenant,
  type Driver, type InsertDriver,
  type Truck, type InsertTruck,
  type Route, type InsertRoute,
  type Contract, type InsertContract,
  type Schedule, type InsertSchedule,
  type Load, type InsertLoad
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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private tenants: Map<string, Tenant>;
  private drivers: Map<string, Driver>;
  private trucks: Map<string, Truck>;
  private routes: Map<string, Route>;
  private contracts: Map<string, Contract>;
  private schedules: Map<string, Schedule>;
  private loads: Map<string, Load>;

  constructor() {
    this.users = new Map();
    this.tenants = new Map();
    this.drivers = new Map();
    this.trucks = new Map();
    this.routes = new Map();
    this.contracts = new Map();
    this.schedules = new Map();
    this.loads = new Map();
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
}

export const storage = new MemStorage();
