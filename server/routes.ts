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
import { benchContracts } from "./seed-data";
import multer from "multer";

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
  // PostgreSQL session store for production-grade session management
  const { default: connectPgSimple } = await import("connect-pg-simple");
  const PgSession = connectPgSimple(session);
  
  app.use(
    session({
      store: new PgSession({
        conObject: {
          connectionString: process.env.DATABASE_URL,
        },
        createTableIfMissing: true,
        pruneSessionInterval: 60 * 15, // Prune expired sessions every 15 minutes
      }),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // Refresh session on every request
      name: 'milo.sid', // Custom session cookie name
      cookie: {
        secure: false, // Allow cookies over HTTP in development
        httpOnly: true,
        sameSite: 'lax', // Allow cookies in same-site requests
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days default
        path: '/', // Cookie available for entire site
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
      const { username, password, rememberMe } = req.body;
      
      // Debug logging
      console.log('Login attempt for username:', JSON.stringify(username), 'Length:', username?.length);

      const user = await dbStorage.getUserByUsername(username);
      if (!user) {
        console.log('User not found for username:', JSON.stringify(username));
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

        // Extend session duration if "Remember Me" is checked
        if (rememberMe) {
          req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
        } else {
          req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7; // 7 days (default)
        }

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

  // Configure multer for file uploads
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
  });

  // Bulk import drivers from CSV/Excel
  app.post("/api/drivers/bulk-import", requireAuth, upload.single('file'), async (req, res) => {
    try {
      const Papa = await import("papaparse");
      const XLSX = await import("xlsx");
      
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      const fileBuffer = req.file.buffer;
      const filename = req.file.originalname;

      // Normalize headers helper
      const normalizeHeader = (header: string): string => {
        const normalized = header.toLowerCase().trim();
        const headerMap: Record<string, string> = {
          'first name': 'firstName',
          'firstname': 'firstName',
          'last name': 'lastName',
          'lastname': 'lastName',
          'phone': 'phoneNumber',
          'phone number': 'phoneNumber',
          'mobile': 'phoneNumber',
          'mobile phone': 'phoneNumber',
          'mobile phone number': 'phoneNumber',
          'email': 'email',
          'domicile': 'domicile',
          'domiciles': 'domicile',
          'license': 'licenseNumber',
          'license number': 'licenseNumber',
          'cdl': 'licenseNumber',
          'eligible': 'loadEligible',
          'load eligible': 'loadEligible',
          'load eligibility': 'loadEligible',
        };
        return headerMap[normalized] || normalized;
      };

      let parsedData: any[] = [];

      // Detect file type and parse accordingly (case-insensitive)
      const filenameLower = filename.toLowerCase();
      const isExcel = filenameLower.endsWith('.xlsx') || filenameLower.endsWith('.xls');
      const isCSV = filenameLower.endsWith('.csv');
      
      // Validate file type
      if (!isExcel && !isCSV) {
        return res.status(400).json({ 
          message: `Unsupported file format. Please upload a CSV (.csv) or Excel (.xlsx, .xls) file. Received: ${filename}` 
        });
      }
      
      if (isExcel) {
        // Parse Excel file
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        
        // Validate workbook has sheets
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          return res.status(400).json({ 
            message: "Excel file contains no sheets. Please upload a valid Excel file with data." 
          });
        }
        
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with header normalization
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        
        // Validate sheet has data
        if (!rawData || rawData.length === 0) {
          return res.status(400).json({ 
            message: "Excel sheet is empty. Please upload a file with driver data." 
          });
        }
        
        // Normalize headers
        parsedData = rawData.map((row: any) => {
          const normalizedRow: any = {};
          for (const [key, value] of Object.entries(row)) {
            const normalizedKey = normalizeHeader(key);
            normalizedRow[normalizedKey] = value;
          }
          return normalizedRow;
        });
      } else {
        // Parse CSV file
        const csvContent = fileBuffer.toString('utf-8');
        const parseResult = Papa.parse(csvContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: normalizeHeader,
        });
        
        // Validate CSV has data
        if (!parseResult.data || parseResult.data.length === 0) {
          return res.status(400).json({ 
            message: "CSV file is empty. Please upload a file with driver data." 
          });
        }
        
        parsedData = parseResult.data;
      }

      const errors: Array<{ row: number; error: string }> = [];
      const imported: any[] = [];

      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i] as any;
        
        try {
          // Convert load eligibility to boolean
          let loadEligible = true;
          if (row.loadEligible !== undefined) {
            const val = String(row.loadEligible).toLowerCase();
            loadEligible = !['no', 'false', 'ineligible', '0', 'n'].includes(val);
          }

          const driverData = insertDriverSchema.parse({
            firstName: row.firstName || row.first_name,
            lastName: row.lastName || row.last_name,
            email: row.email || null,
            phoneNumber: row.phoneNumber || row.phone_number || null,
            domicile: row.domicile || null,
            licenseNumber: row.licenseNumber || row.license_number || null,
            loadEligible,
            profileVerified: false,
            status: 'active',
            tenantId: req.session.tenantId,
          });

          const driver = await dbStorage.createDriver(driverData);
          imported.push(driver);
        } catch (error: any) {
          errors.push({
            row: i + 2, // +2 because CSV is 1-indexed and has header row
            error: error.name === "ZodError" ? fromZodError(error).message : error.message,
          });
        }
      }

      res.json({
        imported: imported.length,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully imported ${imported.length} driver(s)${errors.length > 0 ? `, ${errors.length} error(s)` : ""}`,
      });
    } catch (error: any) {
      console.error('Bulk import error:', error);
      res.status(500).json({ message: "Failed to import drivers", error: error.message });
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

  // Admin endpoint: Seed bench contracts
  app.post("/api/admin/seed-contracts", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const results = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [] as string[],
      };

      // Get existing contracts for this tenant
      const existing = await dbStorage.getContractsByTenant(tenantId);
      const existingMap = new Map(
        existing.map((c) => [`${c.type}-${c.startTime}-${c.tractorId}`, c])
      );

      // Upsert each bench contract
      for (const benchContract of benchContracts) {
        const key = `${benchContract.type}-${benchContract.startTime}-${benchContract.tractorId}`;
        const existingContract = existingMap.get(key);

        try {
          if (existingContract) {
            // Update if duration or baseRoutes changed
            if (
              existingContract.duration !== benchContract.duration ||
              existingContract.baseRoutes !== benchContract.baseRoutes
            ) {
              await dbStorage.updateContract(existingContract.id, {
                duration: benchContract.duration,
                baseRoutes: benchContract.baseRoutes,
              });
              results.updated++;
            } else {
              results.skipped++;
            }
          } else {
            // Create new contract
            const contractData = insertContractSchema.parse({
              tenantId,
              name: `${benchContract.type.toUpperCase()} ${benchContract.startTime} ${benchContract.tractorId}`,
              type: benchContract.type,
              startTime: benchContract.startTime,
              tractorId: benchContract.tractorId,
              duration: benchContract.duration,
              baseRoutes: benchContract.baseRoutes,
              daysPerWeek: 6, // Rolling 6-day pattern
              protectedDrivers: false,
            });
            await dbStorage.createContract(contractData);
            results.created++;
          }
        } catch (error: any) {
          results.errors.push(`${key}: ${error.message}`);
        }
      }

      res.json({
        message: "Contract seeding complete",
        total: benchContracts.length,
        ...results,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to seed contracts", error: error.message });
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

  // ==================== CSV IMPORT ====================

  app.post("/api/import/:entityType", requireAuth, async (req, res) => {
    try {
      const { entityType } = req.params;
      const { rows } = req.body;

      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No data provided" });
      }

      if (rows.length > 5000) {
        return res.status(400).json({ message: "Too many rows. Maximum 5000 allowed." });
      }

      const validRows: any[] = [];
      const errors: { row: number, errors: string[] }[] = [];
      let schema: any;

      // Select appropriate schema based on entity type
      switch (entityType) {
        case "drivers":
          schema = insertDriverSchema;
          break;
        case "routes":
          schema = insertRouteSchema;
          break;
        case "trucks":
          schema = insertTruckSchema;
          break;
        case "loads":
          schema = insertLoadSchema;
          break;
        default:
          return res.status(400).json({ message: "Invalid entity type" });
      }

      // Validate each row individually
      for (let i = 0; i < rows.length; i++) {
        try {
          const rowData = {
            ...rows[i],
            tenantId: req.session.tenantId,
          };

          // Clean up empty strings to undefined for optional fields
          Object.keys(rowData).forEach(key => {
            if (rowData[key] === "" || rowData[key] === null) {
              rowData[key] = undefined;
            }
          });

          const validated = schema.parse(rowData);
          validRows.push(validated);
        } catch (error: any) {
          if (error.name === "ZodError") {
            const errorMessages = error.errors.map((err: any) => 
              `${err.path.join('.')}: ${err.message}`
            );
            errors.push({ row: i + 1, errors: errorMessages });
          } else {
            errors.push({ row: i + 1, errors: [error.message] });
          }
        }
      }

      // Insert valid rows
      let insertedCount = 0;
      if (validRows.length > 0) {
        try {
          switch (entityType) {
            case "drivers":
              for (const row of validRows) {
                await dbStorage.createDriver(row);
                insertedCount++;
              }
              break;
            case "routes":
              for (const row of validRows) {
                await dbStorage.createRoute(row);
                insertedCount++;
              }
              break;
            case "trucks":
              for (const row of validRows) {
                await dbStorage.createTruck(row);
                insertedCount++;
              }
              break;
            case "loads":
              for (const row of validRows) {
                await dbStorage.createLoad(row);
                insertedCount++;
              }
              break;
          }
        } catch (error: any) {
          console.error("Error inserting rows:", error);
          return res.status(500).json({ 
            message: "Failed to insert some rows", 
            count: insertedCount,
            errors: [...errors, { row: -1, errors: [error.message] }]
          });
        }
      }

      res.json({
        count: insertedCount,
        total: rows.length,
        errors: errors,
        message: `Successfully imported ${insertedCount} of ${rows.length} rows`
      });
    } catch (error: any) {
      res.status(500).json({ message: "Import failed", error: error.message });
    }
  });

  // ==================== AI CHAT ====================

  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      // Get user info for context
      const user = await dbStorage.getUser(req.session.userId!);
      const tenant = user?.tenantId ? await dbStorage.getTenant(user.tenantId) : null;

      // Construct system prompt with context about Milo and available data
      const systemPrompt = `You are Milo, an AI assistant for a trucking operations management platform called Milo. You help ${tenant?.name || "the company"} manage their fleet operations.

Your capabilities include:
- Answering questions about drivers, trucks, routes, schedules, loads, and contracts
- Providing insights about fleet operations and logistics
- Helping with scheduling and route planning concepts
- Explaining DOT compliance requirements
- Offering operational recommendations

Current Context:
- Company: ${tenant?.name || "Unknown"}
- User: ${user?.username || "Unknown"}

Be concise, professional, and helpful. Focus on trucking operations management. If asked about data you don't have direct access to, explain what information would be helpful and suggest where they can find it in the application.`;

      // Import OpenAI client
      const { default: OpenAI } = await import("openai");
      
      const openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
      });

      // Build messages array with history
      const messages = [
        { role: "system" as const, content: systemPrompt },
        ...history.map((msg: any) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content
        })),
        { role: "user" as const, content: message }
      ];

      // Set up SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Call OpenAI with streaming enabled
      const stream = await openai.chat.completions.create({
        model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
        messages,
        max_completion_tokens: 2048,
        stream: true,
      });

      // Stream the response
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      // Send done signal
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("AI Chat Error:", error);
      
      // If headers not sent, return JSON error
      if (!res.headersSent) {
        res.status(500).json({ 
          message: "Failed to get AI response", 
          error: error.message 
        });
      } else {
        // Send error in stream format
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
