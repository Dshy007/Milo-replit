import type { Express } from "express";
import { createServer, type Server } from "http";
import { dbStorage } from "./db-storage";
import { 
  insertUserSchema, insertTenantSchema, 
  insertDriverSchema, updateDriverSchema,
  insertTruckSchema, updateTruckSchema,
  insertRouteSchema, updateRouteSchema,
  insertScheduleSchema, updateScheduleSchema,
  insertLoadSchema, updateLoadSchema,
  insertContractSchema, updateContractSchema
} from "@shared/schema";
import session from "express-session";
import { fromZodError } from "zod-validation-error";
import bcrypt from "bcryptjs";

// Require SESSION_SECRET
const SESSION_SECRET = process.env.SESSION_SECRET!;
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

// Session type declaration
declare module "express-session" {
  interface SessionData {
    userId: string;
    tenantId: string;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Session middleware
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      },
    })
  );

  // Middleware to check authentication
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Validate entity belongs to tenant
  async function validateTenantOwnership(
    entityGetter: (id: string) => Promise<{ tenantId: string } | undefined>,
    entityId: string,
    sessionTenantId: string
  ): Promise<boolean> {
    const entity = await entityGetter(entityId);
    return entity !== undefined && entity.tenantId === sessionTenantId;
  }

  // ==================== AUTHENTICATION ====================
  
  // Signup
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, password, email, companyName } = req.body;
      
      // Check if user already exists
      const existingUser = await dbStorage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create tenant first
      const tenant = await dbStorage.createTenant({ name: companyName });

      // Create user
      const userData = insertUserSchema.parse({
        username,
        password: hashedPassword,
        email,
        tenantId: tenant.id,
        role: "admin", // First user is admin
      });

      const user = await dbStorage.createUser(userData);

      // Regenerate session to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Signup failed", error: "Session error" });
        }

        // Set session data after regeneration
        req.session.userId = user.id;
        req.session.tenantId = user.tenantId;

        req.session.save((err) => {
          if (err) {
            return res.status(500).json({ message: "Signup failed", error: "Session save error" });
          }

          res.json({ 
            message: "Signup successful", 
            user: { id: user.id, username: user.username, email: user.email, tenantId: user.tenantId } 
          });
        });
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Signup failed", error: error.message });
    }
  });

  // Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      const user = await dbStorage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Compare hashed password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Regenerate session to prevent session fixation attacks
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Login failed", error: "Session error" });
        }

        // Set session data after regeneration
        req.session.userId = user.id;
        req.session.tenantId = user.tenantId;

        req.session.save((err) => {
          if (err) {
            return res.status(500).json({ message: "Login failed", error: "Session save error" });
          }

          res.json({ 
            message: "Login successful", 
            user: { id: user.id, username: user.username, email: user.email, tenantId: user.tenantId } 
          });
        });
      });
    } catch (error: any) {
      res.status(500).json({ message: "Login failed", error: error.message });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  // Get current user
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = await dbStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json({ 
        user: { id: user.id, username: user.username, email: user.email, tenantId: user.tenantId, role: user.role } 
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get user", error: error.message });
    }
  });

  // ==================== DRIVERS ====================
  
  app.get("/api/drivers", requireAuth, async (req, res) => {
    try {
      const drivers = await dbStorage.getDriversByTenant(req.session.tenantId!);
      res.json(drivers);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch drivers", error: error.message });
    }
  });

  app.get("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      const driver = await dbStorage.getDriver(req.params.id);
      if (!driver || driver.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Driver not found" });
      }
      res.json(driver);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch driver", error: error.message });
    }
  });

  app.post("/api/drivers", requireAuth, async (req, res) => {
    try {
      const driverData = insertDriverSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      const driver = await dbStorage.createDriver(driverData);
      res.json(driver);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create driver", error: error.message });
    }
  });

  app.patch("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      // Validate tenant ownership
      if (!await validateTenantOwnership(dbStorage.getDriver.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Driver not found" });
      }
      
      // Validate and strip tenantId from updates
      const updates = updateDriverSchema.parse(req.body);
      const updatedDriver = await dbStorage.updateDriver(req.params.id, updates);
      res.json(updatedDriver);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update driver", error: error.message });
    }
  });

  app.delete("/api/drivers/:id", requireAuth, async (req, res) => {
    try {
      // Validate tenant ownership
      if (!await validateTenantOwnership(dbStorage.getDriver.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Driver not found" });
      }
      
      await dbStorage.deleteDriver(req.params.id);
      res.json({ message: "Driver deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete driver", error: error.message });
    }
  });

  // ==================== TRUCKS ====================
  
  app.get("/api/trucks", requireAuth, async (req, res) => {
    try {
      const trucks = await dbStorage.getTrucksByTenant(req.session.tenantId!);
      res.json(trucks);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch trucks", error: error.message });
    }
  });

  app.get("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      const truck = await dbStorage.getTruck(req.params.id);
      if (!truck || truck.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Truck not found" });
      }
      res.json(truck);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch truck", error: error.message });
    }
  });

  app.post("/api/trucks", requireAuth, async (req, res) => {
    try {
      const truckData = insertTruckSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      const truck = await dbStorage.createTruck(truckData);
      res.json(truck);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create truck", error: error.message });
    }
  });

  app.patch("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getTruck.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Truck not found" });
      }
      const updates = updateTruckSchema.parse(req.body);
      const updatedTruck = await dbStorage.updateTruck(req.params.id, updates);
      res.json(updatedTruck);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update truck", error: error.message });
    }
  });

  app.delete("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getTruck.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Truck not found" });
      }
      await dbStorage.deleteTruck(req.params.id);
      res.json({ message: "Truck deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete truck", error: error.message });
    }
  });

  // ==================== ROUTES ====================
  
  app.get("/api/routes", requireAuth, async (req, res) => {
    try {
      const routes = await dbStorage.getRoutesByTenant(req.session.tenantId!);
      res.json(routes);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch routes", error: error.message });
    }
  });

  app.get("/api/routes/:id", requireAuth, async (req, res) => {
    try {
      const route = await dbStorage.getRoute(req.params.id);
      if (!route || route.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Route not found" });
      }
      res.json(route);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch route", error: error.message });
    }
  });

  app.post("/api/routes", requireAuth, async (req, res) => {
    try {
      const routeData = insertRouteSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      const route = await dbStorage.createRoute(routeData);
      res.json(route);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create route", error: error.message });
    }
  });

  app.patch("/api/routes/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getRoute.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Route not found" });
      }
      const updates = updateRouteSchema.parse(req.body);
      const updatedRoute = await dbStorage.updateRoute(req.params.id, updates);
      res.json(updatedRoute);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update route", error: error.message });
    }
  });

  app.delete("/api/routes/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getRoute.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Route not found" });
      }
      await dbStorage.deleteRoute(req.params.id);
      res.json({ message: "Route deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete route", error: error.message });
    }
  });

  // ==================== SCHEDULES ====================
  
  app.get("/api/schedules", requireAuth, async (req, res) => {
    try {
      const schedules = await dbStorage.getSchedulesByTenant(req.session.tenantId!);
      res.json(schedules);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch schedules", error: error.message });
    }
  });

  app.get("/api/schedules/:id", requireAuth, async (req, res) => {
    try {
      const schedule = await dbStorage.getSchedule(req.params.id);
      if (!schedule || schedule.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      res.json(schedule);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch schedule", error: error.message });
    }
  });

  app.post("/api/schedules", requireAuth, async (req, res) => {
    try {
      const { driverId, truckId, routeId, contractId, ...rest } = req.body;
      
      // Validate related entities belong to tenant
      if (driverId && !await validateTenantOwnership(dbStorage.getDriver.bind(dbStorage), driverId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid driver ID" });
      }
      if (truckId && !await validateTenantOwnership(dbStorage.getTruck.bind(dbStorage), truckId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid truck ID" });
      }
      if (routeId && !await validateTenantOwnership(dbStorage.getRoute.bind(dbStorage), routeId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid route ID" });
      }
      if (contractId && !await validateTenantOwnership(dbStorage.getContract.bind(dbStorage), contractId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid contract ID" });
      }

      const scheduleData = insertScheduleSchema.parse({
        ...rest,
        driverId,
        truckId,
        routeId,
        contractId,
        tenantId: req.session.tenantId,
      });
      const schedule = await dbStorage.createSchedule(scheduleData);
      res.json(schedule);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create schedule", error: error.message });
    }
  });

  app.patch("/api/schedules/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getSchedule.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      
      const updates = updateScheduleSchema.parse(req.body);
      
      // Validate foreign key ownership if being updated
      if (updates.driverId && !await validateTenantOwnership(dbStorage.getDriver.bind(dbStorage), updates.driverId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid driver ID" });
      }
      if (updates.truckId && !await validateTenantOwnership(dbStorage.getTruck.bind(dbStorage), updates.truckId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid truck ID" });
      }
      if (updates.routeId && !await validateTenantOwnership(dbStorage.getRoute.bind(dbStorage), updates.routeId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid route ID" });
      }
      if (updates.contractId && !await validateTenantOwnership(dbStorage.getContract.bind(dbStorage), updates.contractId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid contract ID" });
      }
      
      const updatedSchedule = await dbStorage.updateSchedule(req.params.id, updates);
      res.json(updatedSchedule);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update schedule", error: error.message });
    }
  });

  app.delete("/api/schedules/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getSchedule.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Schedule not found" });
      }
      await dbStorage.deleteSchedule(req.params.id);
      res.json({ message: "Schedule deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete schedule", error: error.message });
    }
  });

  // ==================== CONTRACTS ====================
  
  app.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contracts = await dbStorage.getContractsByTenant(req.session.tenantId!);
      res.json(contracts);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch contracts", error: error.message });
    }
  });

  app.get("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const contract = await dbStorage.getContract(req.params.id);
      if (!contract || contract.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Contract not found" });
      }
      res.json(contract);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch contract", error: error.message });
    }
  });

  app.post("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contractData = insertContractSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      const contract = await dbStorage.createContract(contractData);
      res.json(contract);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create contract", error: error.message });
    }
  });

  app.patch("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getContract.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Contract not found" });
      }
      const updates = updateContractSchema.parse(req.body);
      const updatedContract = await dbStorage.updateContract(req.params.id, updates);
      res.json(updatedContract);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update contract", error: error.message });
    }
  });

  app.delete("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getContract.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Contract not found" });
      }
      await dbStorage.deleteContract(req.params.id);
      res.json({ message: "Contract deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete contract", error: error.message });
    }
  });

  // ==================== LOADS ====================
  
  app.get("/api/loads", requireAuth, async (req, res) => {
    try {
      const loads = await dbStorage.getLoadsByTenant(req.session.tenantId!);
      res.json(loads);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch loads", error: error.message });
    }
  });

  app.get("/api/loads/:id", requireAuth, async (req, res) => {
    try {
      const load = await dbStorage.getLoad(req.params.id);
      if (!load || load.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Load not found" });
      }
      res.json(load);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch load", error: error.message });
    }
  });

  app.post("/api/loads", requireAuth, async (req, res) => {
    try {
      const { scheduleId, ...rest } = req.body;
      
      // Validate schedule belongs to tenant if provided
      if (scheduleId && !await validateTenantOwnership(dbStorage.getSchedule.bind(dbStorage), scheduleId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid schedule ID" });
      }

      const loadData = insertLoadSchema.parse({
        ...rest,
        scheduleId,
        tenantId: req.session.tenantId,
      });
      const load = await dbStorage.createLoad(loadData);
      res.json(load);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create load", error: error.message });
    }
  });

  app.patch("/api/loads/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getLoad.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Load not found" });
      }
      
      const updates = updateLoadSchema.parse(req.body);
      
      // Validate foreign key ownership if being updated
      if (updates.scheduleId && !await validateTenantOwnership(dbStorage.getSchedule.bind(dbStorage), updates.scheduleId, req.session.tenantId!)) {
        return res.status(400).json({ message: "Invalid schedule ID" });
      }
      
      const updatedLoad = await dbStorage.updateLoad(req.params.id, updates);
      res.json(updatedLoad);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update load", error: error.message });
    }
  });

  app.delete("/api/loads/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getLoad.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Load not found" });
      }
      await dbStorage.deleteLoad(req.params.id);
      res.json({ message: "Load deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete load", error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
