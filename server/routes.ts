import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { dbStorage } from "./db-storage";
import { db } from "./db";
import {
  insertUserSchema, insertTenantSchema,
  insertDriverSchema, updateDriverSchema,
  insertTruckSchema, updateTruckSchema,
  insertRouteSchema, updateRouteSchema,
  insertScheduleSchema, updateScheduleSchema,
  insertLoadSchema, updateLoadSchema,
  insertContractSchema, updateContractSchema,
  insertBlockSchema, updateBlockSchema,
  insertBlockAssignmentSchema, updateBlockAssignmentSchema,
  insertProtectedDriverRuleSchema, updateProtectedDriverRuleSchema,
  insertSpecialRequestSchema, updateSpecialRequestSchema,
  insertDriverAvailabilityPreferenceSchema, updateDriverAvailabilityPreferenceSchema,
  blocks, blockAssignments, assignmentHistory, driverContractStats, drivers, protectedDriverRules,
  shiftOccurrences, shiftTemplates, contracts, trucks
} from "@shared/schema";
import { eq, and, inArray, sql, gte, lte, not } from "drizzle-orm";
import session from "express-session";
import { fromZodError } from "zod-validation-error";
import bcrypt from "bcryptjs";
import { benchContracts } from "./seed-data";
import multer from "multer";
import { validateBlockAssignment, normalizeSoloType, blockToAssignmentSubject } from "./rolling6-calculator";
import { subDays, parseISO, format, startOfWeek, addWeeks } from "date-fns";
import { findSwapCandidates, getAllDriverWorkloads } from "./workload-calculator";
import { analyzeCascadeEffect, executeCascadeChange, type CascadeAnalysisRequest } from "./cascade-analyzer";

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
      resave: true, // Save session on every request (better for mobile)
      saveUninitialized: true, // Create session even if not modified
      rolling: true, // Refresh session on every request
      proxy: true, // Trust the reverse proxy
      cookie: {
        secure: process.env.NODE_ENV === 'production', // Secure cookies in production
        httpOnly: true, // Prevent client-side JS access - critical for security
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
        path: '/',
      },
    })
  );

  // Debug middleware to log session info
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/auth')) {
      console.log('Session ID:', req.sessionID);
      console.log('Session:', req.session);
      console.log('Cookies:', req.headers.cookie);
    }
    next();
  });

  // Middleware to check authentication and validate tenant context
  const requireAuth = async (req: any, res: any, next: any) => {
    console.log('Auth check - Session ID:', req.sessionID, 'User ID:', req.session?.userId);
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    // Re-validate tenantId from database to prevent session tampering
    try {
      const user = await dbStorage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Update session tenantId from authoritative database source
      if (req.session.tenantId !== user.tenantId) {
        console.warn(`Session tenantId mismatch detected for user ${user.id}. Correcting from ${req.session.tenantId} to ${user.tenantId}`);
        req.session.tenantId = user.tenantId;
      }
      
      next();
    } catch (error) {
      console.error('Auth validation error:', error);
      return res.status(500).json({ message: "Authentication validation failed" });
    }
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

      // Make username case-insensitive
      const user = await dbStorage.getUserByUsername(username.toLowerCase());
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

  // ==================== COMPLIANCE ====================

  // GET /api/compliance/heatmap/:startDate/:endDate - Get compliance heatmap data
  app.get("/api/compliance/heatmap/:startDate/:endDate", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { startDate, endDate } = req.params;

      // Validate path params
      if (!startDate || !endDate) {
        return res.status(400).json({ 
          message: "startDate and endDate path parameters are required (YYYY-MM-DD format)" 
        });
      }

      // Import and call the heatmap generator
      const { generateComplianceHeatmap } = await import("./compliance-heatmap");
      const heatmapData = await generateComplianceHeatmap(
        tenantId,
        startDate,
        endDate
      );

      res.json(heatmapData);
    } catch (error: any) {
      console.error("Compliance heatmap error:", error);
      res.status(500).json({ 
        message: "Failed to generate compliance heatmap", 
        error: error.message 
      });
    }
  });

  // ==================== DASHBOARD ====================
  
  // GET /api/dashboard/stats - Get dashboard statistics
  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      
      // Fetch all data in parallel for performance
      const [drivers, trucks, blocks, assignments] = await Promise.all([
        dbStorage.getDriversByTenant(tenantId),
        dbStorage.getTrucksByTenant(tenantId),
        dbStorage.getBlocksByTenant(tenantId),
        dbStorage.getBlockAssignmentsByTenant(tenantId)
      ]);
      
      // Count active entities
      const stats = {
        totalDrivers: drivers.length,
        activeDrivers: drivers.filter(d => d.status === 'active').length,
        activeTrucks: trucks.filter(t => t.status === 'active').length,
        totalBlocks: blocks.length,
        totalAssignments: assignments.length,
        unassignedBlocks: blocks.length - assignments.length,
      };
      
      res.json(stats);
    } catch (error: any) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ 
        message: "Failed to fetch dashboard stats", 
        error: error.message 
      });
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

  // Driver Availability Preferences Routes
  app.get("/api/driver-availability-preferences", requireAuth, async (req, res) => {
    try {
      const { driverId } = req.query;
      const preferences = await dbStorage.getDriverAvailabilityPreferences(
        req.session.tenantId!,
        driverId as string | undefined
      );
      res.json(preferences);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch preferences", error: error.message });
    }
  });

  app.post("/api/driver-availability-preferences/bulk", requireAuth, async (req, res) => {
    try {
      const { driverId, preferences } = req.body;
      
      if (!driverId || !Array.isArray(preferences)) {
        return res.status(400).json({ message: "driverId and preferences array required" });
      }
      
      // Validate driver ownership
      const driver = await dbStorage.getDriver(driverId);
      if (!driver || driver.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Driver not found" });
      }
      
      // Delete existing preferences for this driver
      await dbStorage.deleteDriverAvailabilityPreferences(driverId);
      
      // Create new preferences
      const createdPreferences = [];
      for (const pref of preferences) {
        const prefData = insertDriverAvailabilityPreferenceSchema.parse({
          ...pref,
          driverId,
          tenantId: req.session.tenantId,
        });
        const created = await dbStorage.createDriverAvailabilityPreference(prefData);
        createdPreferences.push(created);
      }
      
      res.json({ 
        message: "Preferences updated successfully", 
        preferences: createdPreferences 
      });
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update preferences", error: error.message });
    }
  });

  app.delete("/api/driver-availability-preferences/:driverId", requireAuth, async (req, res) => {
    try {
      // Validate driver ownership
      const driver = await dbStorage.getDriver(req.params.driverId);
      if (!driver || driver.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Driver not found" });
      }
      
      await dbStorage.deleteDriverAvailabilityPreferences(req.params.driverId);
      res.json({ message: "Preferences deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete preferences", error: error.message });
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
      const { default: Papa } = await import("papaparse");
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
          'phonenumber': 'phoneNumber', // Fix: no space
          'mobile': 'phoneNumber',
          'mobile phone': 'phoneNumber',
          'mobile phone number': 'phoneNumber',
          'email': 'email',
          'email address': 'email', // Fix: with space
          'emailaddress': 'email',
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

      // Log the headers we found for debugging
      if (parsedData.length > 0) {
        const sampleRow = parsedData[0];
        console.log('CSV Headers found:', Object.keys(sampleRow));
        console.log('Sample row data:', JSON.stringify(sampleRow, null, 2));
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

  // Delete all trucks for current tenant
  app.delete("/api/trucks", requireAuth, async (req, res) => {
    try {
      const result = await dbStorage.db.delete(trucks).where(eq(trucks.tenantId, req.session.tenantId!)).returning();
      res.json({ message: `Successfully deleted ${result.length} trucks` });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete trucks", error: error.message });
    }
  });

  // Import trucks from CSV/Excel
  app.post("/api/trucks/import", requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { default: Papa } = await import("papaparse");
      const XLSX = await import("xlsx");
      
      const filename = req.file.originalname.toLowerCase();
      const fileBuffer = req.file.buffer;
      
      let rows: any[] = [];
      
      // Parse based on file extension
      if (filename.endsWith('.csv')) {
        const csvText = fileBuffer.toString('utf-8');
        
        // Auto-detect delimiter by trying common delimiters
        const delimiters = [',', '\t', ';', '|'];
        let bestDelimiter = ',';
        let maxColumns = 0;
        
        for (const delimiter of delimiters) {
          const testParse = Papa.parse(csvText, {
            delimiter,
            preview: 1,
            skipEmptyLines: true,
          });
          
          if (testParse.data[0] && Array.isArray(testParse.data[0])) {
            const columnCount = testParse.data[0].length;
            if (columnCount > maxColumns) {
              maxColumns = columnCount;
              bestDelimiter = delimiter;
            }
          }
        }
        
        console.log(`CSV Auto-detected delimiter: "${bestDelimiter === '\t' ? '\\t (tab)' : bestDelimiter}", columns: ${maxColumns}`);
        
        const parsed = Papa.parse(csvText, { 
          header: true, 
          delimiter: bestDelimiter,
          skipEmptyLines: true,
          transformHeader: (header: string) => header.trim(),
        });
        rows = parsed.data;
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        if (workbook.SheetNames.length === 0) {
          return res.status(400).json({ message: "Excel file is empty" });
        }
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ message: "Unsupported file format. Please upload CSV or Excel file." });
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: "File contains no data" });
      }

      // Normalize headers to canonical keys
      const normalizeHeader = (header: string): string => {
        const normalized = header.toLowerCase().trim();
        const headerMap: Record<string, string> = {
          // Truck Number mappings
          'truck number': 'truckNumber',
          'trucknumber': 'truckNumber',
          'truck_number': 'truckNumber',
          'truck #': 'truckNumber',
          'number': 'truckNumber',
          'asset id': 'truckNumber',
          'assetid': 'truckNumber',
          'asset_id': 'truckNumber',
          
          // Type mappings
          'type': 'type',
          'truck type': 'type',
          'trucktype': 'type',
          'truck_type': 'type',
          'vehicle type': 'type',
          
          // Make mappings
          'make': 'make',
          'manufacturer': 'make',
          
          // Model mappings
          'model': 'model',
          
          // Year mappings
          'year': 'year',
          
          // VIN mappings
          'vin': 'vin',
          'vin number': 'vin',
          'vehicle id': 'vin',
          
          // License Plate mappings
          'license plate': 'licensePlate',
          'licenseplate': 'licensePlate',
          'license_plate': 'licensePlate',
          'plate': 'licensePlate',
          'license': 'licensePlate',
          
          // Location mappings
          'last known location': 'lastKnownLocation',
          'lastknownlocation': 'lastKnownLocation',
          'last_known_location': 'lastKnownLocation',
          'location': 'lastKnownLocation',
          
          // Status mappings
          'status': 'status',
          
          // Fuel mappings
          'fuel': 'fuel',
          'fuel type': 'fuel',
          'fueltype': 'fuel',
          'fuel_type': 'fuel',
        };
        return headerMap[normalized] || normalized;
      };

      const normalizedRows = rows.map(row => {
        const normalized: any = {};
        for (const key in row) {
          const canonicalKey = normalizeHeader(key);
          normalized[canonicalKey] = row[key];
        }
        return normalized;
      });

      // Debug: Log headers to help troubleshoot
      if (normalizedRows.length > 0) {
        console.log('Truck Import - Original headers:', Object.keys(rows[0]));
        console.log('Truck Import - Normalized headers:', Object.keys(normalizedRows[0]));
        console.log('Truck Import - Sample row:', JSON.stringify(normalizedRows[0], null, 2));
      }

      // Helper function to clean data (remove hyperlinks, formulas, etc)
      const cleanValue = (value: any): string | null => {
        if (value === null || value === undefined || value === '') return null;
        
        // Convert to string first
        let cleaned = String(value).trim();
        
        // Remove hyperlink formulas like =HYPERLINK("url", "text") or =HYPERLINK("url","text")
        const hyperlinkMatch = cleaned.match(/^=HYPERLINK\s*\(\s*".*?"\s*,\s*"(.+?)"\s*\)/i);
        if (hyperlinkMatch) {
          cleaned = hyperlinkMatch[1].trim();
        }
        
        // Remove any remaining formula markers
        if (cleaned.startsWith('=')) {
          cleaned = cleaned.substring(1).trim();
        }
        
        // Remove quotes if wrapped
        if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
            (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
          cleaned = cleaned.slice(1, -1).trim();
        }
        
        return cleaned || null;
      };

      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < normalizedRows.length; i++) {
        const row = normalizedRows[i];
        const rowNum = i + 2; // Account for header row

        try {
          // Clean all values to remove hyperlinks and formulas
          const cleanedRow: any = {};
          for (const key in row) {
            cleanedRow[key] = cleanValue(row[key]);
          }
          
          // Validate required fields are present
          if (!cleanedRow.truckNumber) {
            throw new Error('Missing required field: Asset ID');
          }
          
          // Map common status values to database-expected values
          const mapStatus = (status: string): string => {
            const statusLower = status.toLowerCase().trim();
            const statusMap: Record<string, string> = {
              'active': 'available',
              'available': 'available',
              'in use': 'in_use',
              'in-use': 'in_use',
              'in_use': 'in_use',
              'maintenance': 'maintenance',
              'repair': 'maintenance',
              'retired': 'retired',
              'inactive': 'retired',
            };
            return statusMap[statusLower] || 'available';
          };
          
          // Extract truck data from row using canonical keys
          // Set complianceStatus to 'pending' for bulk imports
          // Convert all values to strings to handle numeric data
          const truckData = insertTruckSchema.parse({
            tenantId: req.session.tenantId,
            truckNumber: String(cleanedRow.truckNumber || ''),
            type: cleanedRow.type ? String(cleanedRow.type) : null,
            make: cleanedRow.make ? String(cleanedRow.make) : null,
            model: cleanedRow.model ? String(cleanedRow.model) : null,
            year: cleanedRow.year ? parseInt(String(cleanedRow.year), 10) : null,
            vin: cleanedRow.vin ? String(cleanedRow.vin) : null,
            licensePlate: cleanedRow.licensePlate ? String(cleanedRow.licensePlate) : null,
            lastKnownLocation: cleanedRow.lastKnownLocation ? String(cleanedRow.lastKnownLocation) : null,
            status: cleanedRow.status ? mapStatus(String(cleanedRow.status)) : 'available',
            fuel: cleanedRow.fuel ? String(cleanedRow.fuel) : null,
            complianceStatus: 'pending', // Bulk imports default to pending
            usdotNumber: null,
            gvwr: null,
            registrationExpiry: null,
            insuranceExpiry: null,
            lastInspection: null,
            nextInspection: null,
          });

          await dbStorage.createTruck(truckData);
          successCount++;
        } catch (error: any) {
          if (error.name === "ZodError") {
            errors.push(`Row ${rowNum}: ${fromZodError(error).message}`);
          } else {
            errors.push(`Row ${rowNum}: ${error.message}`);
          }
        }
      }

      res.json({
        count: successCount,
        total: normalizedRows.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import trucks", error: error.message });
    }
  });

  // Bulk import trucks from CSV/Excel
  app.post("/api/trucks/bulk-import", requireAuth, upload.single('file'), async (req, res) => {
    try {
      const { default: Papa } = await import("papaparse");
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
          'truck number': 'truckNumber',
          'trucknumber': 'truckNumber',
          'truck #': 'truckNumber',
          'number': 'truckNumber',
          'make': 'make',
          'model': 'model',
          'year': 'year',
          'vin': 'vin',
          'license plate': 'licensePlate',
          'licenseplate': 'licensePlate',
          'plate': 'licensePlate',
          'status': 'status',
        };
        return headerMap[normalized] || normalized;
      };

      let parsedData: any[] = [];

      // Detect file type
      const filenameLower = filename.toLowerCase();
      const isExcel = filenameLower.endsWith('.xlsx') || filenameLower.endsWith('.xls');
      const isCSV = filenameLower.endsWith('.csv');
      
      if (!isExcel && !isCSV) {
        return res.status(400).json({ 
          message: `Unsupported file format. Please upload a CSV (.csv) or Excel (.xlsx, .xls) file.` 
        });
      }
      
      if (isExcel) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          return res.status(400).json({ message: "Excel file contains no sheets." });
        }
        
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        
        if (!rawData || rawData.length === 0) {
          return res.status(400).json({ message: "Excel sheet is empty." });
        }
        
        parsedData = rawData.map((row: any) => {
          const normalizedRow: any = {};
          for (const [key, value] of Object.entries(row)) {
            const normalizedKey = normalizeHeader(key);
            normalizedRow[normalizedKey] = value;
          }
          return normalizedRow;
        });
      } else {
        const csvContent = fileBuffer.toString('utf-8');
        const parseResult = Papa.parse(csvContent, {
          header: true,
          skipEmptyLines: true,
          transformHeader: normalizeHeader,
        });
        
        if (!parseResult.data || parseResult.data.length === 0) {
          return res.status(400).json({ message: "CSV file is empty." });
        }
        
        parsedData = parseResult.data;
      }

      // Log headers for debugging
      if (parsedData.length > 0) {
        console.log('Truck CSV Headers found:', Object.keys(parsedData[0]));
        console.log('Sample row:', JSON.stringify(parsedData[0], null, 2));
      }

      const errors: Array<{ row: number; error: string }> = [];
      const imported: any[] = [];

      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i] as any;
        
        try {
          const truckData = insertTruckSchema.parse({
            truckNumber: row.truckNumber || row.truck_number || `TRUCK-${i + 1}`,
            make: row.make || null,
            model: row.model || null,
            year: row.year ? parseInt(String(row.year)) : new Date().getFullYear(),
            vin: row.vin || null,
            licensePlate: row.licensePlate || row.license_plate || null,
            status: row.status?.toLowerCase() === 'in_service' ? 'in_service' : 
                   row.status?.toLowerCase() === 'maintenance' ? 'maintenance' : 
                   'available',
            tenantId: req.session.tenantId,
          });

          const truck = await dbStorage.createTruck(truckData);
          imported.push(truck);
        } catch (error: any) {
          errors.push({
            row: i + 2, // +2 because: +1 for 1-based indexing, +1 for header row
            error: error.message || "Failed to import truck",
          });
        }
      }

      res.json({
        imported: imported.length,
        errors,
      });
    } catch (error: any) {
      console.error('Bulk import error:', error);
      res.status(500).json({ message: "Failed to import trucks", error: error.message });
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

  // GET /api/schedules/calendar - Combined endpoint for calendar views (must be before :id route)
  app.get("/api/schedules/calendar", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      // Require both date params
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "Both startDate and endDate query parameters are required" });
      }
      
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      
      // Validate date format
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
      }
      
      // Validate date range order
      if (start > end) {
        return res.status(400).json({ message: "Start date must be before or equal to end date" });
      }
      
      // Validate date range limit (31 days)
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 31) {
        return res.status(400).json({ message: "Date range cannot exceed 31 days" });
      }
      
      // QUICK WORKAROUND: Fetch shift occurrences instead of blocks
      // This shows data from shift-based imports (new system)
      const occurrences = await dbStorage.getShiftOccurrencesByDateRange(req.session.tenantId!, start, end);
      
      // Fetch all assignments for tenant
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
      const occurrenceIds = new Set(occurrences.map(o => o.id));
      const relevantAssignments = allAssignments.filter(a => a.shiftOccurrenceId && occurrenceIds.has(a.shiftOccurrenceId));
      
      // Build assignment lookup by occurrence ID
      const assignmentsByOccurrenceId = new Map(relevantAssignments.map(a => [a.shiftOccurrenceId!, a]));
      
      // Fetch templates and contracts
      const templateIds = [...new Set(occurrences.map(o => o.templateId))];
      const driverIds = [...new Set(relevantAssignments.map(a => a.driverId))];
      
      const templates = await db.select().from(shiftTemplates).where(
        and(
          eq(shiftTemplates.tenantId, req.session.tenantId!),
          inArray(shiftTemplates.id, templateIds.length > 0 ? templateIds : [''])
        )
      );
      
      const contractIds = [...new Set(templates.map(t => t.contractId))];
      const [fetchedContracts, fetchedDrivers] = await Promise.all([
        Promise.all(contractIds.map(id => dbStorage.getContract(id))),
        Promise.all(driverIds.map(id => dbStorage.getDriver(id))),
      ]);
      
      // Build lookup maps
      const templatesMap = new Map(templates.map(t => [t.id, t]));
      const contractsMap = new Map(fetchedContracts.filter(c => c).map(c => [c!.id, c!]));
      const driversMap = new Map(fetchedDrivers.filter(d => d).map(d => [d!.id, d!]));
      
      // Transform to simplified occurrence structure for calendar display
      const simplifiedOccurrences = occurrences.map(occ => {
        const template = templatesMap.get(occ.templateId);
        const contract = template ? contractsMap.get(template.contractId) || null : null;
        const assignment = assignmentsByOccurrenceId.get(occ.id) || null;
        const driver = assignment ? driversMap.get(assignment.driverId) || null : null;
        
        // Use template's canonical start time (e.g., "00:30") - falls back to formatted scheduled time if missing
        const startTime = template?.canonicalStartTime || 
          occ.scheduledStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        
        // Calculate bump minutes (difference between actual and canonical start)
        // Handles cross-midnight occurrences correctly
        let bumpMinutes = 0;
        if (template?.canonicalStartTime) {
          const [canonicalHour, canonicalMin] = template.canonicalStartTime.split(':').map(Number);
          const canonicalMinutesOfDay = canonicalHour * 60 + canonicalMin;
          const scheduledMinutesOfDay = occ.scheduledStart.getHours() * 60 + occ.scheduledStart.getMinutes();
          
          // Calculate raw difference
          let diff = scheduledMinutesOfDay - canonicalMinutesOfDay;
          
          // Adjust for cross-midnight: if diff is very negative, assume it's a next-day occurrence
          // Example: canonical=23:30 (1410 min), scheduled=00:06 (6 min) → diff=-1404
          // Should be +36 minutes (crossed midnight)
          if (diff < -720) { // If more than 12 hours negative
            diff += 1440; // Add 24 hours
          } else if (diff > 720) { // If more than 12 hours positive
            diff -= 1440; // Subtract 24 hours
          }
          
          bumpMinutes = diff;
        }
        
        // Provide stable block identifier with fallback
        const blockId = occ.externalBlockId || `SO-${occ.id.slice(0, 8)}`;
        
        return {
          occurrenceId: occ.id,
          serviceDate: occ.serviceDate, // YYYY-MM-DD
          startTime, // HH:mm from template canonical time
          blockId,
          driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
          driverId: driver?.id || null,
          contractType: contract?.type || null,
          status: occ.status,
          tractorId: occ.tractorId || null,
          assignmentId: assignment?.id || null,
          bumpMinutes,
          isCarryover: occ.isCarryover,
        };
      });
      
      // Return simplified calendar data
      res.json({
        range: { start: startDate, end: endDate },
        occurrences: simplifiedOccurrences,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch calendar data", error: error.message });
    }
  });

  // POST /api/schedules/cascade-analysis - Analyze cascade effects of schedule changes
  app.post("/api/schedules/cascade-analysis", requireAuth, async (req, res) => {
    try {
      const request: CascadeAnalysisRequest = req.body;
      
      // Validate request
      if (!request.assignmentId || !request.action) {
        return res.status(400).json({ message: "Missing assignmentId or action" });
      }
      
      if ((request.action === "swap" || request.action === "reassign") && !request.targetDriverId) {
        return res.status(400).json({ message: "targetDriverId required for swap/reassign actions" });
      }
      
      const analysis = await analyzeCascadeEffect(req.session.tenantId!, request);
      res.json(analysis);
    } catch (error: any) {
      console.error("Cascade analysis error:", error);
      res.status(500).json({ message: "Failed to analyze cascade effect", error: error.message });
    }
  });

  // POST /api/schedules/cascade-execute - Execute a cascade effect change
  app.post("/api/schedules/cascade-execute", requireAuth, async (req, res) => {
    try {
      const request: CascadeAnalysisRequest & { expectedTargetAssignmentId?: string } = req.body;
      
      // Validate request
      if (!request.assignmentId || !request.action) {
        return res.status(400).json({ message: "Missing assignmentId or action" });
      }
      
      if ((request.action === "swap" || request.action === "reassign") && !request.targetDriverId) {
        return res.status(400).json({ message: "targetDriverId required for swap/reassign actions" });
      }
      
      const result = await executeCascadeChange(req.session.tenantId!, request);
      res.json(result);
    } catch (error: any) {
      console.error("Cascade execution error:", error);
      res.status(500).json({ message: "Failed to execute cascade change", error: error.message });
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

  // Import contracts from CSV/Excel
  app.post("/api/contracts/import", requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { default: Papa } = await import("papaparse");
      const XLSX = await import("xlsx");
      
      const filename = req.file.originalname.toLowerCase();
      const fileBuffer = req.file.buffer;
      
      let rows: any[] = [];
      
      // Parse based on file extension
      if (filename.endsWith('.csv')) {
        const csvText = fileBuffer.toString('utf-8');
        const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        rows = parsed.data;
      } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        if (workbook.SheetNames.length === 0) {
          return res.status(400).json({ message: "Excel file is empty" });
        }
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        rows = XLSX.utils.sheet_to_json(worksheet);
      } else {
        return res.status(400).json({ message: "Unsupported file format. Please upload CSV or Excel file." });
      }

      if (rows.length === 0) {
        return res.status(400).json({ message: "File contains no data" });
      }

      // Normalize headers to canonical keys
      const normalizeHeader = (header: string): string => {
        const normalized = header.toLowerCase().trim();
        const headerMap: Record<string, string> = {
          // Driver Type mappings
          'driver type': 'type',
          'drivertype': 'type',
          'contract type': 'type',
          'contracttype': 'type',
          'type': 'type',
          'solo type': 'type',
          'solotype': 'type',
          
          // Tractor/Operator ID mappings
          'tractor': 'tractorId',
          'tractor id': 'tractorId',
          'tractorid': 'tractorId',
          'tractor_id': 'tractorId',
          'operator id': 'tractorId',
          'operatorid': 'tractorId',
          'operator_id': 'tractorId',
          'truck': 'tractorId',
          'truck id': 'tractorId',
          
          // Start Time mappings
          'start time': 'startTime',
          'starttime': 'startTime',
          'start_time': 'startTime',
          'time': 'startTime',
          'start': 'startTime',
          
          // Name mappings
          'name': 'name',
          'contract name': 'name',
          'contractname': 'name',
          'contract_name': 'name',
          
          // Status mappings
          'status': 'status',
          
          // Domicile mappings
          'domicile': 'domicile',
          'location': 'domicile',
          'base': 'domicile',
          
          // Duration mappings
          'duration': 'duration',
          'hours': 'duration',
          
          // Routes mappings
          'base routes': 'baseRoutes',
          'baseroutes': 'baseRoutes',
          'base_routes': 'baseRoutes',
          'routes': 'baseRoutes',
          
          // Days per week mappings
          'days per week': 'daysPerWeek',
          'daysperweek': 'daysPerWeek',
          'days_per_week': 'daysPerWeek',
          'days': 'daysPerWeek',
          
          // Protected drivers mappings
          'protected drivers': 'protectedDrivers',
          'protecteddrivers': 'protectedDrivers',
          'protected_drivers': 'protectedDrivers',
          'protected': 'protectedDrivers',
        };
        return headerMap[normalized] || normalized;
      };

      const normalizedRows = rows.map(row => {
        const normalized: any = {};
        for (const key in row) {
          const canonicalKey = normalizeHeader(key);
          normalized[canonicalKey] = row[key];
        }
        return normalized;
      });

      let successCount = 0;
      const errors: string[] = [];

      for (let i = 0; i < normalizedRows.length; i++) {
        const row = normalizedRows[i];
        const rowNum = i + 2; // Account for header row

        try {
          // Validate required fields are present
          if (!row.type) {
            throw new Error('Missing required field: Driver Type (solo1/solo2/team)');
          }
          if (!row.tractorId) {
            throw new Error('Missing required field: Tractor/Operator ID');
          }
          if (!row.startTime) {
            throw new Error('Missing required field: Start Time');
          }
          
          // Extract contract data from row using canonical keys
          const contractData = insertContractSchema.parse({
            tenantId: req.session.tenantId,
            name: row.name || `${row.type} ${row.startTime} ${row.tractorId}`,
            type: row.type.toLowerCase(),
            startTime: row.startTime,
            status: row.status || 'active',
            tractorId: row.tractorId,
            domicile: row.domicile || '',
            duration: parseInt(row.duration || (row.type?.toLowerCase() === 'solo2' ? '38' : '14'), 10),
            baseRoutes: parseInt(row.baseRoutes || (row.type?.toLowerCase() === 'solo2' ? '7' : '10'), 10),
            daysPerWeek: parseInt(row.daysPerWeek || '6', 10),
            protectedDrivers: row.protectedDrivers === 'true' || row.protectedDrivers === '1' || row.protectedDrivers === true || false,
          });

          await dbStorage.createContract(contractData);
          successCount++;
        } catch (error: any) {
          if (error.name === "ZodError") {
            errors.push(`Row ${rowNum}: ${fromZodError(error).message}`);
          } else {
            errors.push(`Row ${rowNum}: ${error.message}`);
          }
        }
      }

      res.json({
        count: successCount,
        total: normalizedRows.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to import contracts", error: error.message });
    }
  });

  // Admin endpoint: Reset contracts - DELETE ALL and re-seed benchmark contracts
  app.post("/api/admin/reset-contracts", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const results = {
        assignmentsDeleted: 0,
        blocksDeleted: 0,
        contractsDeleted: 0,
        contractsCreated: 0,
        errors: [] as string[],
      };

      // Step 1: Delete all block assignments for this tenant (must delete assignments before blocks)
      const existingAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
      for (const assignment of existingAssignments) {
        await dbStorage.deleteBlockAssignment(assignment.id);
        results.assignmentsDeleted++;
      }

      // Step 2: Delete all blocks for this tenant (must delete blocks before contracts due to FK)
      const existingBlocks = await dbStorage.getBlocksByTenant(tenantId);
      for (const block of existingBlocks) {
        await dbStorage.deleteBlock(block.id);
        results.blocksDeleted++;
      }

      // Step 3: Delete all contracts for this tenant
      const existingContracts = await dbStorage.getContractsByTenant(tenantId);
      for (const contract of existingContracts) {
        await dbStorage.deleteContract(contract.id);
        results.contractsDeleted++;
      }

      // Step 4: Create the 17 benchmark contracts
      for (const benchContract of benchContracts) {
        try {
          const contractData = insertContractSchema.parse({
            tenantId,
            name: `${benchContract.type.toUpperCase()} ${benchContract.startTime} ${benchContract.tractorId}`,
            type: benchContract.type,
            startTime: benchContract.startTime,
            tractorId: benchContract.tractorId,
            domicile: benchContract.domicile,
            duration: benchContract.duration,
            baseRoutes: benchContract.baseRoutes,
            daysPerWeek: 6,
            protectedDrivers: false,
          });
          await dbStorage.createContract(contractData);
          results.contractsCreated++;
        } catch (error: any) {
          results.errors.push(`${benchContract.type}-${benchContract.startTime}-${benchContract.tractorId}: ${error.message}`);
        }
      }

      res.json({
        message: "Contracts reset complete - all old contracts deleted and 17 benchmark contracts created",
        ...results,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to reset contracts", error: error.message });
    }
  });

  // Admin endpoint: Seed bench contracts (upsert - updates existing or creates new)
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
            // Update if duration, baseRoutes, or domicile changed
            if (
              existingContract.duration !== benchContract.duration ||
              existingContract.baseRoutes !== benchContract.baseRoutes ||
              existingContract.domicile !== benchContract.domicile
            ) {
              await dbStorage.updateContract(existingContract.id, {
                duration: benchContract.duration,
                baseRoutes: benchContract.baseRoutes,
                domicile: benchContract.domicile,
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
              domicile: benchContract.domicile,
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

  // ==================== BLOCKS ====================
  
  app.get("/api/blocks", requireAuth, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      // If date range provided, filter blocks
      if (startDate && endDate) {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        
        // Validate date format
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
        }
        
        // Validate date range order
        if (start > end) {
          return res.status(400).json({ message: "Start date must be before or equal to end date" });
        }
        
        // Validate date range limit (31 days like compliance heatmap)
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 31) {
          return res.status(400).json({ message: "Date range cannot exceed 31 days" });
        }
        
        const blocks = await dbStorage.getBlocksByDateRange(req.session.tenantId!, start, end);
        return res.json(blocks);
      }
      
      // If only one param provided, require both
      if (startDate || endDate) {
        return res.status(400).json({ message: "Both startDate and endDate are required" });
      }
      
      // Otherwise return all blocks for tenant
      const blocks = await dbStorage.getBlocksByTenant(req.session.tenantId!);
      res.json(blocks);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch blocks", error: error.message });
    }
  });

  app.get("/api/blocks/:id", requireAuth, async (req, res) => {
    try {
      const block = await dbStorage.getBlock(req.params.id);
      if (!block || block.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Block not found" });
      }
      res.json(block);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch block", error: error.message });
    }
  });

  app.post("/api/blocks", requireAuth, async (req, res) => {
    try {
      const blockData = insertBlockSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      
      // Validate tenant ownership of contract
      const contract = await dbStorage.getContract(blockData.contractId);
      if (!contract || contract.tenantId !== req.session.tenantId) {
        return res.status(400).json({ message: "Invalid contract ID" });
      }
      
      const block = await dbStorage.createBlock(blockData);
      res.json(block);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create block", error: error.message });
    }
  });

  app.patch("/api/blocks/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getBlock.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Block not found" });
      }
      
      const updates = updateBlockSchema.parse(req.body);
      
      // Validate tenant ownership of contract if being updated
      if (updates.contractId) {
        const contract = await dbStorage.getContract(updates.contractId);
        if (!contract || contract.tenantId !== req.session.tenantId) {
          return res.status(400).json({ message: "Invalid contract ID" });
        }
      }
      
      const updatedBlock = await dbStorage.updateBlock(req.params.id, updates);
      res.json(updatedBlock);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update block", error: error.message });
    }
  });

  app.delete("/api/blocks/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getBlock.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Block not found" });
      }
      await dbStorage.deleteBlock(req.params.id);
      res.json({ message: "Block deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete block", error: error.message });
    }
  });

  // ==================== SHIFT OCCURRENCES ====================

  app.delete("/api/shift-occurrences/:id", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const occurrenceId = req.params.id;
      
      // Fetch the shift occurrence with tenant validation
      const occurrence = await dbStorage.getShiftOccurrence(occurrenceId, tenantId);
      
      if (!occurrence) {
        return res.status(404).json({ message: "Shift occurrence not found" });
      }
      
      // Validate status: only allow deletion of unassigned or assigned shifts
      if (occurrence.status === "in_progress" || occurrence.status === "completed") {
        return res.status(409).json({ 
          message: `Cannot delete ${occurrence.status} shift. Only unassigned or assigned shifts can be deleted.` 
        });
      }
      
      // Delete the shift occurrence and its assignments (tenant-scoped)
      const deleted = await dbStorage.deleteShiftOccurrence(occurrenceId, tenantId);
      
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete shift occurrence" });
      }
      
      res.json({ message: "Shift occurrence deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete shift occurrence", error: error.message });
    }
  });

  // POST /api/shift-occurrences/clear-week - Clear all shift occurrences for a given week
  app.post("/api/shift-occurrences/clear-week", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, weekEnd } = req.body;

      if (!weekStart || !weekEnd) {
        return res.status(400).json({ message: "Missing required fields: weekStart, weekEnd" });
      }

      // Get deletable shift occurrences (filter in database for performance)
      const deletableOccurrences = await db
        .select()
        .from(shiftOccurrences)
        .where(and(
          eq(shiftOccurrences.tenantId, tenantId),
          gte(shiftOccurrences.serviceDate, weekStart),
          lte(shiftOccurrences.serviceDate, weekEnd),
          // Filter out in_progress and completed shifts in DB query
          not(inArray(shiftOccurrences.status, ["in_progress", "completed"]))
        ));

      let deletedCount = 0;

      if (deletableOccurrences.length > 0) {
        // Bulk delete for performance
        const idsToDelete = deletableOccurrences.map(occ => occ.id);

        // Delete assignments first (assignments are stored in blockAssignments with shiftOccurrenceId)
        await db.delete(blockAssignments)
          .where(and(
            eq(blockAssignments.tenantId, tenantId),
            inArray(blockAssignments.shiftOccurrenceId, idsToDelete)
          ));

        // Then delete occurrences
        await db.delete(shiftOccurrences)
          .where(and(
            eq(shiftOccurrences.tenantId, tenantId),
            inArray(shiftOccurrences.id, idsToDelete)
          ));

        deletedCount = deletableOccurrences.length;
      }

      res.json({
        message: `Deleted ${deletedCount} shift occurrences`,
        count: deletedCount
      });
    } catch (error: any) {
      console.error("Error clearing shifts:", error);
      res.status(500).json({ message: "Failed to clear shifts", error: error.message });
    }
  });

  // PATCH /api/shift-occurrences/:id/assignment - Update driver assignment for a shift occurrence
  app.patch("/api/shift-occurrences/:id/assignment", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const occurrenceId = req.params.id;
      const { driverId } = req.body; // driverId can be null to unassign

      // Verify the shift occurrence exists and belongs to this tenant
      const occurrence = await dbStorage.getShiftOccurrence(occurrenceId, tenantId);
      if (!occurrence) {
        return res.status(404).json({ message: "Shift occurrence not found" });
      }

      // Get existing assignment for this shift occurrence
      const existingAssignment = await dbStorage.getBlockAssignmentByShiftOccurrence(occurrenceId);

      // If driverId is null or empty, remove the assignment
      if (!driverId) {
        if (existingAssignment) {
          await dbStorage.deleteBlockAssignment(existingAssignment.id);
          // Update occurrence status to unassigned
          await dbStorage.updateShiftOccurrence(occurrenceId, { status: "unassigned" });
        }
        return res.json({ message: "Driver unassigned successfully" });
      }

      // Verify the driver exists and belongs to this tenant
      const driver = await dbStorage.getDriver(driverId);
      if (!driver || driver.tenantId !== tenantId) {
        return res.status(400).json({ message: "Invalid driver ID" });
      }

      // Update or create the assignment
      if (existingAssignment) {
        // Update existing assignment
        await dbStorage.updateBlockAssignment(existingAssignment.id, {
          driverId,
          assignedAt: new Date(),
        });
      } else {
        // Create new assignment
        await dbStorage.createBlockAssignment({
          id: randomUUID(),
          tenantId,
          shiftOccurrenceId: occurrenceId,
          driverId,
          assignedAt: new Date(),
          isActive: true,
        });
      }

      // Update occurrence status to assigned
      await dbStorage.updateShiftOccurrence(occurrenceId, { status: "assigned" });

      res.json({ message: "Driver assigned successfully" });
    } catch (error: any) {
      console.error("Error updating assignment:", error);
      res.status(500).json({ message: "Failed to update assignment", error: error.message });
    }
  });

  // ==================== BLOCK ASSIGNMENTS ====================
  
  app.get("/api/block-assignments", requireAuth, async (req, res) => {
    try {
      const assignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
      res.json(assignments);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch block assignments", error: error.message });
    }
  });

  app.get("/api/block-assignments/:id", requireAuth, async (req, res) => {
    try {
      const assignment = await dbStorage.getBlockAssignment(req.params.id);
      if (!assignment || assignment.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Block assignment not found" });
      }
      res.json(assignment);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch block assignment", error: error.message });
    }
  });

  app.post("/api/block-assignments", requireAuth, async (req, res) => {
    try {
      const assignmentData = insertBlockAssignmentSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      
      // Validate tenant ownership of referenced entities
      const block = await dbStorage.getBlock(assignmentData.blockId);
      if (!block || block.tenantId !== req.session.tenantId) {
        return res.status(400).json({ message: "Invalid block ID" });
      }
      
      const driver = await dbStorage.getDriver(assignmentData.driverId);
      if (!driver || driver.tenantId !== req.session.tenantId) {
        return res.status(400).json({ message: "Invalid driver ID" });
      }
      
      // CRITICAL: Run validation guard before assignment
      // Calculate lookback window based on solo type (Solo1=1 day, Solo2=2 days)
      // Use normalized soloType to handle variants like "Solo 1", "SOLO1", etc.
      const normalizedSoloType = normalizeSoloType(block.soloType);
      const lookbackDays = normalizedSoloType === "solo1" ? 1 : 2;
      const lookbackStart = subDays(new Date(block.startTimestamp), lookbackDays);
      const lookbackEnd = new Date(block.startTimestamp);
      
      // Fetch driver's existing assignments within lookback window (with block data for duration calculation)
      const existingAssignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
        driver.id,
        req.session.tenantId!,
        lookbackStart,
        lookbackEnd
      );
      
      // Fetch protected rules for this driver
      const protectedRules = await dbStorage.getProtectedDriverRulesByDriver(driver.id);
      
      // Fetch all assignments to check if block is already assigned
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
      
      // Run comprehensive validation
      const validationResult = await validateBlockAssignment(
        driver,
        blockToAssignmentSubject(block),
        existingAssignments,
        protectedRules,
        allAssignments,
        block.id // For conflict checking
      );
      
      // If validation failed, return detailed error
      if (!validationResult.canAssign) {
        return res.status(400).json({
          message: "Assignment validation failed",
          validationStatus: validationResult.validationResult.validationStatus,
          errors: validationResult.validationResult.messages,
          protectedRuleViolations: validationResult.protectedRuleViolations,
          conflictingAssignments: validationResult.conflictingAssignments,
        });
      }
      
      // Create assignment with validation summary
      const validationSummary = JSON.stringify({
        status: validationResult.validationResult.validationStatus,
        messages: validationResult.validationResult.messages,
        metrics: validationResult.validationResult.metrics,
        validatedAt: new Date().toISOString(),
      });
      
      const assignment = await dbStorage.createBlockAssignment({
        ...assignmentData,
        validationStatus: validationResult.validationResult.validationStatus,
        validationSummary,
      });
      
      res.json(assignment);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create block assignment", error: error.message });
    }
  });

  app.patch("/api/block-assignments/:id", requireAuth, async (req, res) => {
    try {
      // Verify ownership
      const existingAssignment = await dbStorage.getBlockAssignment(req.params.id);
      if (!existingAssignment || existingAssignment.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Block assignment not found" });
      }
      
      const updates = updateBlockAssignmentSchema.parse(req.body);
      
      // If driver or block is being updated, run validation
      if (updates.driverId || updates.blockId) {
        const newDriverId = updates.driverId || existingAssignment.driverId;
        const newBlockId = updates.blockId || existingAssignment.blockId;
        
        // Fetch driver and block
        const driver = await dbStorage.getDriver(newDriverId);
        if (!driver || driver.tenantId !== req.session.tenantId) {
          return res.status(400).json({ message: "Invalid driver ID" });
        }
        
        const block = await dbStorage.getBlock(newBlockId);
        if (!block || block.tenantId !== req.session.tenantId) {
          return res.status(400).json({ message: "Invalid block ID" });
        }
        
        // Run validation guard
        const normalizedSoloType = normalizeSoloType(block.soloType);
        const lookbackDays = normalizedSoloType === "solo1" ? 1 : 2;
        const lookbackStart = subDays(new Date(block.startTimestamp), lookbackDays);
        const lookbackEnd = new Date(block.startTimestamp);
        
        const existingAssignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
          driver.id,
          req.session.tenantId!,
          lookbackStart,
          lookbackEnd
        );
        
        // Filter out the current assignment being updated from all validation datasets
        const filteredAssignments = existingAssignments.filter(a => a.id !== req.params.id);
        
        const protectedRules = await dbStorage.getProtectedDriverRulesByDriver(driver.id);
        const allAssignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
        
        // CRITICAL: Also filter current assignment from allAssignments to avoid self-conflict
        const filteredAllAssignments = allAssignments.filter(a => a.id !== req.params.id);
        
        const validationResult = await validateBlockAssignment(
          driver,
          blockToAssignmentSubject(block),
          filteredAssignments,
          protectedRules,
          filteredAllAssignments,
          block.id // For conflict checking
        );
        
        if (!validationResult.canAssign) {
          return res.status(400).json({
            message: "Assignment validation failed",
            validationStatus: validationResult.validationResult.validationStatus,
            errors: validationResult.validationResult.messages,
            protectedRuleViolations: validationResult.protectedRuleViolations,
            conflictingAssignments: validationResult.conflictingAssignments,
          });
        }
        
        // Add validation summary to updates
        updates.validationStatus = validationResult.validationResult.validationStatus;
        updates.validationSummary = JSON.stringify({
          status: validationResult.validationResult.validationStatus,
          messages: validationResult.validationResult.messages,
          metrics: validationResult.validationResult.metrics,
          validatedAt: new Date().toISOString(),
        });
      }
      
      const updatedAssignment = await dbStorage.updateBlockAssignment(req.params.id, updates);
      res.json(updatedAssignment);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update block assignment", error: error.message });
    }
  });

  app.delete("/api/block-assignments/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getBlockAssignment.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Block assignment not found" });
      }
      await dbStorage.deleteBlockAssignment(req.params.id);
      res.json({ message: "Block assignment deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete block assignment", error: error.message });
    }
  });

  // ==================== PROTECTED DRIVER RULES ====================
  
  app.get("/api/protected-driver-rules", requireAuth, async (req, res) => {
    try {
      const rules = await dbStorage.getProtectedDriverRulesByTenant(req.session.tenantId!);
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch protected driver rules", error: error.message });
    }
  });

  app.get("/api/protected-driver-rules/:id", requireAuth, async (req, res) => {
    try {
      const rule = await dbStorage.getProtectedDriverRule(req.params.id);
      if (!rule || rule.tenantId !== req.session.tenantId) {
        return res.status(404).json({ message: "Protected driver rule not found" });
      }
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch protected driver rule", error: error.message });
    }
  });

  app.post("/api/protected-driver-rules", requireAuth, async (req, res) => {
    try {
      const ruleData = insertProtectedDriverRuleSchema.parse({
        ...req.body,
        tenantId: req.session.tenantId,
      });
      
      // Validate tenant ownership of driver
      const driver = await dbStorage.getDriver(ruleData.driverId);
      if (!driver || driver.tenantId !== req.session.tenantId) {
        return res.status(400).json({ message: "Invalid driver ID" });
      }
      
      const rule = await dbStorage.createProtectedDriverRule(ruleData);
      res.json(rule);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to create protected driver rule", error: error.message });
    }
  });

  app.patch("/api/protected-driver-rules/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getProtectedDriverRule.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Protected driver rule not found" });
      }
      
      const updates = updateProtectedDriverRuleSchema.parse(req.body);
      
      // Validate tenant ownership of driver if being updated
      if (updates.driverId) {
        const driver = await dbStorage.getDriver(updates.driverId);
        if (!driver || driver.tenantId !== req.session.tenantId) {
          return res.status(400).json({ message: "Invalid driver ID" });
        }
      }
      
      const updatedRule = await dbStorage.updateProtectedDriverRule(req.params.id, updates);
      res.json(updatedRule);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      res.status(500).json({ message: "Failed to update protected driver rule", error: error.message });
    }
  });

  app.delete("/api/protected-driver-rules/:id", requireAuth, async (req, res) => {
    try {
      if (!await validateTenantOwnership(dbStorage.getProtectedDriverRule.bind(dbStorage), req.params.id, req.session.tenantId!)) {
        return res.status(404).json({ message: "Protected driver rule not found" });
      }
      await dbStorage.deleteProtectedDriverRule(req.params.id);
      res.json({ message: "Protected driver rule deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to delete protected driver rule", error: error.message });
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

      const validRows: Array<{ data: any, originalRowIndex: number }> = [];
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
        case "blocks":
          schema = insertBlockSchema;
          break;
        case "assignments":
          schema = insertBlockAssignmentSchema;
          break;
        default:
          return res.status(400).json({ message: "Invalid entity type" });
      }

      // Validate each row individually and track original row indices
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
          validRows.push({ data: validated, originalRowIndex: i + 1 });
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
              for (const { data } of validRows) {
                await dbStorage.createDriver(data);
                insertedCount++;
              }
              break;
            case "routes":
              for (const { data } of validRows) {
                await dbStorage.createRoute(data);
                insertedCount++;
              }
              break;
            case "trucks":
              for (const { data } of validRows) {
                await dbStorage.createTruck(data);
                insertedCount++;
              }
              break;
            case "loads":
              for (const { data } of validRows) {
                await dbStorage.createLoad(data);
                insertedCount++;
              }
              break;
            case "blocks":
              for (const { data } of validRows) {
                await dbStorage.createBlock(data);
                insertedCount++;
              }
              break;
            case "assignments":
              for (const { data: row, originalRowIndex } of validRows) {
                // Validate tenant ownership
                const block = await dbStorage.getBlock(row.blockId);
                if (!block || block.tenantId !== req.session.tenantId) {
                  errors.push({ 
                    row: originalRowIndex, 
                    errors: ["Invalid block ID or block belongs to different tenant"] 
                  });
                  continue;
                }
                
                const driver = await dbStorage.getDriver(row.driverId);
                if (!driver || driver.tenantId !== req.session.tenantId) {
                  errors.push({ 
                    row: originalRowIndex, 
                    errors: ["Invalid driver ID or driver belongs to different tenant"] 
                  });
                  continue;
                }
                
                // Run rolling-6 and protected driver validation
                const normalizedSoloType = normalizeSoloType(block.soloType);
                const lookbackDays = normalizedSoloType === "solo1" ? 1 : 2;
                const lookbackStart = subDays(new Date(block.startTimestamp), lookbackDays);
                const lookbackEnd = new Date(block.startTimestamp);
                
                const existingAssignments = await dbStorage.getBlockAssignmentsWithBlocksByDriverAndDateRange(
                  driver.id,
                  req.session.tenantId!,
                  lookbackStart,
                  lookbackEnd
                );
                
                const protectedRules = await dbStorage.getProtectedDriverRulesByDriver(driver.id);
                
                // Get all block assignments for the tenant to check for multi-driver conflicts
                const allBlockAssignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
                
                const validationResult = await validateBlockAssignment(
                  driver,
                  blockToAssignmentSubject(block),
                  existingAssignments,
                  protectedRules,
                  allBlockAssignments,
                  block.id // For conflict checking
                );
                
                if (!validationResult.canAssign) {
                  errors.push({
                    row: originalRowIndex,
                    errors: [
                      ...validationResult.validationResult.messages,
                      ...validationResult.protectedRuleViolations,
                    ]
                  });
                  continue;
                }
                
                // Store assignment with validation summary
                const validationSummary = JSON.stringify({
                  status: validationResult.validationResult.validationStatus,
                  messages: validationResult.validationResult.messages,
                  metrics: validationResult.validationResult.metrics,
                  validatedAt: new Date().toISOString(),
                });
                
                await dbStorage.createBlockAssignment({
                  ...row,
                  validationStatus: validationResult.validationResult.validationStatus,
                  validationSummary,
                });
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

  // Helper function to extract valid driver entities from tool results
  function collectValidDrivers(toolResults: Array<{ name: string; content: string }>) {
    const validIds = new Set<string>();
    const validNames = new Set<string>();
    
    toolResults.forEach(result => {
      try {
        const parsed = JSON.parse(result.content);
        
        // Extract from driver lists (most common format)
        if (parsed.drivers && Array.isArray(parsed.drivers)) {
          parsed.drivers.forEach((driver: any) => {
            if (driver.id) validIds.add(driver.id);
            if (driver.name) validNames.add(driver.name.toLowerCase());
          });
        }
        
        // Extract from single driver responses
        if (parsed.driver) {
          if (parsed.driver.id) validIds.add(parsed.driver.id);
          if (parsed.driver.name) validNames.add(parsed.driver.name.toLowerCase());
        }
        
        // Extract from assignments (may include driver info)
        if (parsed.assignments && Array.isArray(parsed.assignments)) {
          parsed.assignments.forEach((assignment: any) => {
            if (assignment.driver && assignment.driver.id) {
              validIds.add(assignment.driver.id);
            }
            if (assignment.driverId) {
              validIds.add(assignment.driverId);
            }
          });
        }
        
        // Extract from workload summaries
        if (parsed.summary && Array.isArray(parsed.summary)) {
          parsed.summary.forEach((item: any) => {
            if (item.driverId) validIds.add(item.driverId);
            if (item.driver && item.driver.id) validIds.add(item.driver.id);
          });
        }
        
        // Extract direct ID field (some responses just return an ID)
        if (parsed.id && typeof parsed.id === 'string') {
          // Only add if it looks like a UUID
          if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(parsed.id)) {
            validIds.add(parsed.id);
          }
        }
      } catch (err) {
        // Ignore parsing errors - tool result may not be JSON
      }
    });
    
    return { validIds, validNames };
  }

  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      // Get user info for context
      const user = await dbStorage.getUser(req.session.userId!);
      const tenant = user?.tenantId ? await dbStorage.getTenant(user.tenantId) : null;

      // Construct system prompt with enhanced context
      const systemPrompt = `You are Milo, an AI assistant for a trucking operations management platform called Milo. You help ${tenant?.name || "the company"} manage their fleet operations.

You have access to real-time database functions to answer questions about:
- Drivers (solo1, solo2, team types) - their schedules, workloads, and availability
- Schedules and assignments - who's working when, upcoming assignments
- Blocks - assigned and unassigned capacity
- Workload distribution - days worked, load balancing across drivers

CRITICAL INSTRUCTIONS:
- When answering questions about drivers, schedules, or assignments, you MUST use the provided database functions.
- ONLY reference driver IDs, names, and details that are explicitly returned by your function calls.
- NEVER fabricate, invent, or guess driver information - only use exact data from tool responses.
- If you don't have information from a function call, acknowledge that instead of making assumptions.
- When listing drivers, use ONLY the drivers returned in the most recent function call results.

Current Context:
- Company: ${tenant?.name || "Unknown"}
- User: ${user?.username || "Unknown"}

Be concise, professional, and helpful. Use functions to provide accurate, real-time data whenever possible.`;

      // Import OpenAI client and AI functions
      const { default: OpenAI } = await import("openai");
      const { AI_TOOLS, executeTool } = await import("./ai-functions");
      
      const openai = new OpenAI({
        baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
      });

      // Build messages array with history
      const messages: any[] = [
        { role: "system", content: systemPrompt },
        ...history.map((msg: any) => ({
          role: msg.role,
          content: msg.content,
          // Preserve tool_calls and tool info if present in history
          ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
          ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id, name: msg.name })
        })),
        { role: "user", content: message }
      ];

      // PHASE 1: Tool-call exchange (non-streaming)
      // Make initial call with function calling enabled
      let response = await openai.chat.completions.create({
        model: "gpt-5",
        messages,
        max_completion_tokens: 2048,
        tools: AI_TOOLS,
        tool_choice: "auto", // Let model decide when to use tools
        stream: false, // Complete tool exchange before streaming
      });

      let responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      // Handle function calls iteratively (support multiple rounds if needed)
      const MAX_TOOL_ITERATIONS = 5;
      let iteration = 0;
      
      // Store all tool results for validation
      const allToolResults: Array<{ name: string; content: string }> = [];
      console.log('[AI Chat] Initial response has tool_calls?', !!responseMessage.tool_calls);
      
      while (responseMessage.tool_calls && iteration < MAX_TOOL_ITERATIONS) {
        iteration++;
        console.log(`[AI Chat] Processing ${responseMessage.tool_calls.length} tool calls (iteration ${iteration})`);
        
        // Execute all tool calls in parallel
        const toolResults = await Promise.all(
          responseMessage.tool_calls.map(async (toolCall) => {
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);
            
            console.log(`[AI Chat] Executing ${functionName} with args:`, functionArgs);
            
            // Execute tool with tenant context
            const result = await executeTool(
              functionName,
              functionArgs,
              {
                tenantId: req.session.tenantId!,
                userId: req.session.userId!
              }
            );
            
            // Store for validation
            console.log(`[AI Chat] Capturing tool result: ${functionName}, length: ${result.length}`);
            allToolResults.push({ name: functionName, content: result });
            console.log(`[AI Chat] allToolResults now has ${allToolResults.length} items`);
            
            return {
              role: "tool" as const,
              tool_call_id: toolCall.id,
              name: functionName,
              content: result
            };
          })
        );
        
        // Append tool results to messages
        messages.push(...toolResults);
        
        // Make another call to get model's response to tool results
        response = await openai.chat.completions.create({
          model: "gpt-5",
          messages,
          max_completion_tokens: 2048,
          tools: AI_TOOLS,
          tool_choice: "auto",
          stream: false,
        });
        
        responseMessage = response.choices[0].message;
        messages.push(responseMessage);
      }

      // Debug: Log what we captured
      console.log('[AI Chat] Tool execution loop complete. allToolResults length:', allToolResults.length);
      if (allToolResults.length > 0) {
        console.log('[AI Chat] Sample tool result:', {
          name: allToolResults[0].name,
          contentLength: allToolResults[0].content.length,
          contentPreview: allToolResults[0].content.substring(0, 100)
        });
      }

      // PHASE 2: Buffer, validate, then stream final answer
      // Set up SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Get final answer (buffered, not streamed yet)
      const finalStream = await openai.chat.completions.create({
        model: "gpt-5",
        messages,
        max_completion_tokens: 2048,
        stream: true,
      });

      // STEP 1: Buffer the entire response
      let fullResponse = '';
      for await (const chunk of finalStream) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullResponse += content;
      }

      // STEP 2: Validate against tool results (if any tool calls were made)
      let validatedResponse = fullResponse;
      console.log('[AI Validation] Starting validation. Tool results count:', allToolResults.length);
      
      if (allToolResults.length > 0) {
        const { validIds, validNames } = collectValidDrivers(allToolResults);
        console.log('[AI Validation] Valid IDs extracted:', Array.from(validIds));
        console.log('[AI Validation] Response preview:', fullResponse.substring(0, 300));
        
        // Find all UUIDs mentioned in response
        const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
        const mentionedIds = fullResponse.match(uuidRegex) || [];
        console.log('[AI Validation] UUIDs found in response:', mentionedIds);
        
        // Identify fabricated IDs (UUIDs that aren't in our valid set)
        const fabricatedIds = mentionedIds.filter(id => !validIds.has(id));
        console.log('[AI Validation] Fabricated IDs detected:', fabricatedIds);
        
        if (fabricatedIds.length > 0) {
          // Log hallucination event with full details
          console.log('[AI Hallucination Detected]', {
            fabricatedIds,
            toolCallsCount: allToolResults.length,
            validIdsCount: validIds.size,
            validIds: Array.from(validIds),
            fullResponse: fullResponse,
            userQuery: message
          });
          
          // PRODUCTION SAFETY: Block fabricated response entirely
          // Provide safe fallback that references only verified data
          validatedResponse = `I found information in the database, but I'm having trouble formatting it accurately. Here's what I can verify:\n\n`;
          
          // Safely present the raw tool data
          allToolResults.forEach(toolResult => {
            try {
              const parsed = JSON.parse(toolResult.content);
              
              if (parsed.drivers && Array.isArray(parsed.drivers)) {
                validatedResponse += `Found ${parsed.drivers.length} driver(s):\n`;
                parsed.drivers.forEach((driver: any, idx: number) => {
                  validatedResponse += `${idx + 1}. ${driver.name || 'Unknown'} (ID: ${driver.id})\n`;
                  if (driver.status) validatedResponse += `   Status: ${driver.status}\n`;
                  if (driver.domicile) validatedResponse += `   Domicile: ${driver.domicile}\n`;
                });
                validatedResponse += '\n';
              }
              
              if (parsed.count !== undefined) {
                validatedResponse += `Count: ${parsed.count}\n`;
              }
              
              if (parsed.driverType) {
                validatedResponse += `Driver type: ${parsed.driverType}\n`;
              }
            } catch (err) {
              validatedResponse += `${toolResult.name}: ${toolResult.content}\n\n`;
            }
          });
          
          validatedResponse += '\n⚠️ I detected potentially inaccurate information in my initial response, so I\'m showing you the raw database results instead. Please verify any critical information.';
        }
      }

      // STEP 3: Stream the validated response
      // Simulate streaming by chunking the validated text
      const chunkSize = 50;
      for (let i = 0; i < validatedResponse.length; i += chunkSize) {
        const chunk = validatedResponse.substring(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 10));
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

  // ===== Claude AI Chat Endpoint =====

  app.post("/api/chat/claude", requireAuth, async (req, res) => {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      // Get user info for context
      const user = await dbStorage.getUser(req.session.userId!);
      const tenant = user?.tenantId ? await dbStorage.getTenant(user.tenantId) : null;

      // Import Anthropic SDK and Claude tools
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const { executeTool } = await import("./ai-functions");
      const { convertToolsForClaude, getClaudeSystemPrompt } = await import("./claude-tools");
      type ChatHistoryContext = import("./claude-tools").ChatHistoryContext;

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });

      // Fetch lightweight chat history indicator (session count only - actual retrieval is on-demand)
      let chatHistoryContext: ChatHistoryContext | undefined;
      try {
        if (user?.tenantId) {
          const historySummary = await dbStorage.getChatHistorySummary(
            user.tenantId,
            req.session.userId!,
            6 // 6 weeks of history
          );
          if (historySummary.sessions.length > 0) {
            chatHistoryContext = {
              recentTopics: [], // Topics loaded on-demand via recallPastConversation tool
              sessionCount: historySummary.sessions.length,
              lastSessionDate: historySummary.sessions[0]?.lastMessageAt
                ? new Date(historySummary.sessions[0].lastMessageAt).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })
                : undefined
            };
          }
        }
      } catch (error) {
        console.error("Error fetching chat history indicator:", error);
        // Continue without memory context
      }

      const systemPrompt = getClaudeSystemPrompt(
        tenant?.name || "Unknown",
        user?.username || "Unknown",
        chatHistoryContext
      );

      // Convert tools to Claude format
      const claudeTools = convertToolsForClaude();

      // Build messages array - Claude requires user/assistant alternation
      const claudeMessages: any[] = [];

      // Add history (ensuring proper alternation)
      let lastRole: string | null = null;
      history.forEach((msg: any) => {
        if (msg.role === "assistant" || msg.role === "user") {
          // Merge consecutive messages from same role
          if (lastRole === msg.role && claudeMessages.length > 0) {
            claudeMessages[claudeMessages.length - 1].content += "\n\n" + msg.content;
          } else {
            claudeMessages.push({
              role: msg.role,
              content: msg.content
            });
            lastRole = msg.role;
          }
        }
      });

      // Add current message
      if (lastRole === "user" && claudeMessages.length > 0) {
        claudeMessages[claudeMessages.length - 1].content += "\n\n" + message;
      } else {
        claudeMessages.push({
          role: "user",
          content: message
        });
      }

      // Set up SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // PHASE 1: Non-streaming tool use loop
      const MAX_TOOL_ITERATIONS = 5;
      let iteration = 0;
      let continueLoop = true;

      while (continueLoop && iteration < MAX_TOOL_ITERATIONS) {
        iteration++;
        console.log(`[Claude Chat] Iteration ${iteration}`);

        // Make API call
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: claudeMessages,
          tools: claudeTools,
        });

        console.log(`[Claude Chat] Stop reason: ${response.stop_reason}`);

        // Check if Claude wants to use tools
        if (response.stop_reason === "tool_use") {
          // Extract tool uses from content blocks
          const toolUses = response.content.filter((block: any) => block.type === "tool_use");
          console.log(`[Claude Chat] Processing ${toolUses.length} tool calls`);

          // Add assistant's response to messages (including tool_use blocks)
          claudeMessages.push({
            role: "assistant",
            content: response.content
          });

          // Execute all tools in parallel
          const toolResults = await Promise.all(
            toolUses.map(async (toolUse: any) => {
              console.log(`[Claude Chat] Executing ${toolUse.name} with input:`, toolUse.input);

              const result = await executeTool(
                toolUse.name,
                toolUse.input,
                {
                  tenantId: req.session.tenantId!,
                  userId: req.session.userId!
                }
              );

              console.log(`[Claude Chat] Tool ${toolUse.name} result length: ${result.length}`);

              return {
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: result
              };
            })
          );

          // Add tool results as user message
          claudeMessages.push({
            role: "user",
            content: toolResults
          });

        } else {
          // No more tool use, we have the final response
          continueLoop = false;

          // Stream the final response
          const textContent = response.content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("\n\n");

          // Simulate streaming by chunking
          const chunkSize = 50;
          for (let i = 0; i < textContent.length; i += chunkSize) {
            const chunk = textContent.substring(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          // Send done signal
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        }
      }

      // If we hit max iterations, send what we have
      if (iteration >= MAX_TOOL_ITERATIONS) {
        res.write(`data: ${JSON.stringify({
          content: "\n\n[Reached maximum tool iteration limit]",
          done: true
        })}\n\n`);
        res.end();
      }

    } catch (error: any) {
      console.error("Claude Chat Error:", error);

      if (!res.headersSent) {
        res.status(500).json({
          message: "Failed to get Claude response",
          error: error.message
        });
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    }
  });

  // ===== Special Requests Routes =====

  // GET /api/special-requests - List all special requests for tenant
  app.get("/api/special-requests", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ message: "Authentication required - no tenant context" });
      }
      
      const { status, driverId, startDate, endDate } = req.query;

      let requests;
      
      if (status) {
        requests = await dbStorage.getSpecialRequestsByStatus(tenantId, status as string);
      } else if (driverId) {
        // Verify driver belongs to tenant before fetching their requests
        const driver = await dbStorage.getDriver(driverId as string);
        if (!driver || driver.tenantId !== tenantId) {
          return res.status(403).json({ message: "Driver not found or access denied" });
        }
        requests = await dbStorage.getSpecialRequestsByDriver(tenantId, driverId as string);
      } else if (startDate && endDate) {
        requests = await dbStorage.getSpecialRequestsByDateRange(
          tenantId, 
          parseISO(startDate as string), 
          parseISO(endDate as string)
        );
      } else {
        requests = await dbStorage.getSpecialRequestsByTenant(tenantId);
      }
      
      res.json(requests);
    } catch (error: any) {
      console.error("Get special requests error:", error);
      res.status(500).json({ message: "Failed to get special requests", error: error.message });
    }
  });

  // GET /api/special-requests/:id - Get specific special request
  app.get("/api/special-requests/:id", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ message: "Authentication required - no tenant context" });
      }
      
      const { id } = req.params;
      const request = await dbStorage.getSpecialRequest(id);
      
      if (!request) {
        return res.status(404).json({ message: "Special request not found" });
      }
      
      // Verify tenant access
      if (request.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      res.json(request);
    } catch (error: any) {
      console.error("Get special request error:", error);
      res.status(500).json({ message: "Failed to get special request", error: error.message });
    }
  });

  // POST /api/special-requests - Submit new special request
  app.post("/api/special-requests", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      // Add tenantId from session to request body before validation
      const validation = insertSpecialRequestSchema.safeParse({
        ...req.body,
        tenantId,
      });
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data", 
          errors: fromZodError(validation.error).toString() 
        });
      }
      
      const data = validation.data;
      
      // Verify driver belongs to tenant
      const driver = await dbStorage.getDriver(data.driverId);
      if (!driver || driver.tenantId !== tenantId) {
        return res.status(403).json({ message: "Driver not found or access denied" });
      }
      
      // Validate contract-based time selections
      // Note: Schema validation already ensures startTime and blockType are provided together
      if (data.startTime && data.blockType) {
        // Verify this contract time exists in the tenant's contract inventory
        const matchingContracts = await dbStorage.findContractsByTenantStartTimeAndType(
          tenantId,
          data.startTime,
          data.blockType
        );
        
        if (matchingContracts.length === 0) {
          return res.status(400).json({ 
            message: `Contract time ${data.startTime} with block type ${data.blockType} does not exist in your contract inventory` 
          });
        }
        
        // If contractId is also specified, verify it matches the startTime/blockType
        if (data.contractId) {
          const specificContract = await dbStorage.getContract(data.contractId);
          if (!specificContract || specificContract.tenantId !== tenantId) {
            return res.status(403).json({ message: "Contract not found or access denied" });
          }
          
          // Verify the contractId matches the provided startTime and blockType
          if (specificContract.startTime !== data.startTime || 
              specificContract.type !== data.blockType) {
            return res.status(400).json({ 
              message: "Contract ID does not match the selected start time and block type" 
            });
          }
        }
      } else if (data.contractId) {
        // If only contractId is provided (without startTime/blockType), verify it exists
        const contract = await dbStorage.getContract(data.contractId);
        if (!contract || contract.tenantId !== tenantId) {
          return res.status(403).json({ message: "Contract not found or access denied" });
        }
      }
      
      // If affectedBlockId provided, verify it exists and belongs to tenant
      if (data.affectedBlockId) {
        const block = await dbStorage.getBlock(data.affectedBlockId);
        if (!block || block.tenantId !== tenantId) {
          return res.status(403).json({ message: "Block not found or access denied" });
        }
      }
      
      // Create special request with pending status
      const newRequest = await dbStorage.createSpecialRequest({
        ...data,
        tenantId,
        status: "pending",
      });
      
      res.json(newRequest);
    } catch (error: any) {
      console.error("Create special request error:", error);
      res.status(500).json({ message: "Failed to create special request", error: error.message });
    }
  });

  // PATCH /api/special-requests/:id/approve - Approve special request
  app.patch("/api/special-requests/:id/approve", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;
      const tenantId = req.session.tenantId!;
      
      const request = await dbStorage.getSpecialRequest(id);
      if (!request) {
        return res.status(404).json({ message: "Special request not found" });
      }
      
      if (request.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (request.status !== "pending") {
        return res.status(400).json({ message: "Only pending requests can be approved" });
      }
      
      // Update request status
      const updated = await dbStorage.updateSpecialRequest(id, {
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: userId,
        notes: req.body.notes || request.notes,
        swapCandidateId: req.body.swapCandidateId || request.swapCandidateId,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Approve special request error:", error);
      res.status(500).json({ message: "Failed to approve special request", error: error.message });
    }
  });

  // PATCH /api/special-requests/:id/reject - Reject special request
  app.patch("/api/special-requests/:id/reject", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.session.userId!;
      const tenantId = req.session.tenantId!;
      
      const request = await dbStorage.getSpecialRequest(id);
      if (!request) {
        return res.status(404).json({ message: "Special request not found" });
      }
      
      if (request.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      if (request.status !== "pending") {
        return res.status(400).json({ message: "Only pending requests can be rejected" });
      }
      
      // Update request status
      const updated = await dbStorage.updateSpecialRequest(id, {
        status: "rejected",
        reviewedAt: new Date(),
        reviewedBy: userId,
        notes: req.body.notes || request.notes,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Reject special request error:", error);
      res.status(500).json({ message: "Failed to reject special request", error: error.message });
    }
  });

  // DELETE /api/special-requests/:id - Delete/cancel special request
  app.delete("/api/special-requests/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = req.session.tenantId!;
      
      const request = await dbStorage.getSpecialRequest(id);
      if (!request) {
        return res.status(404).json({ message: "Special request not found" });
      }
      
      if (request.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      await dbStorage.deleteSpecialRequest(id);
      
      res.json({ message: "Special request deleted successfully" });
    } catch (error: any) {
      console.error("Delete special request error:", error);
      res.status(500).json({ message: "Failed to delete special request", error: error.message });
    }
  });

  // GET /api/swap-candidates/:blockId - Find eligible swap candidates for a block
  app.get("/api/swap-candidates/:blockId", requireAuth, async (req, res) => {
    try {
      const { blockId } = req.params;
      const tenantId = req.session.tenantId!;
      
      const block = await dbStorage.getBlock(blockId);
      if (!block) {
        return res.status(404).json({ message: "Block not found" });
      }
      
      if (block.tenantId !== tenantId) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get all drivers for tenant
      const drivers = await dbStorage.getDriversByTenant(tenantId);
      
      // Get all assignments with blocks for compliance checking
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
      const assignmentsWithBlocks = await Promise.all(
        allAssignments.map(async (assignment) => {
          const assignmentBlock = await dbStorage.getBlock(assignment.blockId);
          return { ...assignment, block: assignmentBlock! };
        })
      );
      
      // Get protected rules
      const protectedRules = await dbStorage.getProtectedDriverRulesByTenant(tenantId);
      
      // Find swap candidates
      const candidates = await findSwapCandidates(
        block,
        drivers,
        assignmentsWithBlocks,
        protectedRules
      );
      
      res.json(candidates);
    } catch (error: any) {
      console.error("Find swap candidates error:", error);
      res.status(500).json({ message: "Failed to find swap candidates", error: error.message });
    }
  });

  // GET /api/workload-summary - Get workload summary for all drivers for a specific week
  app.get("/api/workload-summary", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekDate } = req.query;
      
      if (!weekDate) {
        return res.status(400).json({ message: "weekDate query parameter is required" });
      }
      
      const parsedDate = parseISO(weekDate as string);
      
      // Get all drivers for tenant
      const drivers = await dbStorage.getDriversByTenant(tenantId);
      
      // Get all assignments with blocks
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
      const assignmentsWithBlocks = await Promise.all(
        allAssignments.map(async (assignment) => {
          const block = await dbStorage.getBlock(assignment.blockId);
          return { ...assignment, block: block! };
        })
      );
      
      // Get workload summaries
      const workloadSummaries = await getAllDriverWorkloads(
        drivers,
        parsedDate,
        assignmentsWithBlocks
      );
      
      res.json(workloadSummaries);
    } catch (error: any) {
      console.error("Get workload summary error:", error);
      res.status(500).json({ message: "Failed to get workload summary", error: error.message });
    }
  });

  // GET /api/workload-summary/range - Get workload summary for date range (returns array of driver+week combinations)
  app.get("/api/workload-summary/range", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { start, end } = req.query;
      
      if (!start || !end) {
        return res.status(400).json({ message: "start and end query parameters are required (ISO date strings)" });
      }
      
      const startDate = parseISO(start as string);
      const endDate = parseISO(end as string);
      
      // Get all drivers for tenant
      const drivers = await dbStorage.getDriversByTenant(tenantId);
      
      // Get all assignments with blocks
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(tenantId);
      const assignmentsWithBlocks = await Promise.all(
        allAssignments.map(async (assignment) => {
          const block = await dbStorage.getBlock(assignment.blockId);
          return { ...assignment, block: block! };
        })
      );
      
      // Calculate weeks in range (start of each week from startDate to endDate)
      const weeks: Date[] = [];
      let currentWeek = startOfWeek(startDate, { weekStartsOn: 0 });
      const rangeEnd = startOfWeek(endDate, { weekStartsOn: 0 });
      
      while (currentWeek <= rangeEnd) {
        weeks.push(currentWeek);
        currentWeek = addWeeks(currentWeek, 1);
      }
      
      // Get workload summaries for all drivers for all weeks
      const results: Array<{
        driverId: string;
        driverName: string;
        weekStartIso: string;
        daysWorked: number;
        workloadLevel: string;
        totalHours: number;
        blockIds: string[];
      }> = [];
      
      for (const weekDate of weeks) {
        const weekSummaries = await getAllDriverWorkloads(
          drivers,
          weekDate,
          assignmentsWithBlocks
        );
        
        for (const summary of weekSummaries) {
          results.push({
            driverId: summary.driverId,
            driverName: summary.driverName,
            weekStartIso: format(weekDate, "yyyy-MM-dd"),
            daysWorked: summary.daysWorked,
            workloadLevel: summary.workloadLevel,
            totalHours: summary.totalHours,
            blockIds: summary.blockIds,
          });
        }
      }
      
      res.json(results);
    } catch (error: any) {
      console.error("Get workload summary range error:", error);
      res.status(500).json({ message: "Failed to get workload summary range", error: error.message });
    }
  });

  // ==================== PATTERN LEARNING & AUTO-BUILD ====================

  // POST /api/patterns/recompute - Recompute assignment patterns for pattern learning
  app.post("/api/patterns/recompute", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { recomputePatterns } = await import("./pattern-engine");
      const result = await recomputePatterns(tenantId);
      
      res.json({
        success: true,
        message: `Pattern recompute completed. Created ${result.patternsCreated} patterns for ${result.totalDrivers} drivers.`,
        stats: result,
      });
    } catch (error: any) {
      console.error("Pattern recompute error:", error);
      res.status(500).json({ message: "Failed to recompute patterns", error: error.message });
    }
  });

  // GET /api/patterns/stats - Get pattern statistics
  app.get("/api/patterns/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { getPatternStats } = await import("./pattern-engine");
      const stats = await getPatternStats(tenantId);
      
      res.json(stats);
    } catch (error: any) {
      console.error("Get pattern stats error:", error);
      res.status(500).json({ message: "Failed to get pattern stats", error: error.message });
    }
  });

  // POST /api/auto-build/preview - Generate auto-build suggestions for next week
  app.post("/api/auto-build/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      const { targetWeekStart } = req.body;
      if (!targetWeekStart) {
        return res.status(400).json({ message: "Missing required field: targetWeekStart" });
      }

      const { generateAutoBuildPreview, saveAutoBuildRun } = await import("./auto-build-engine");
      const preview = await generateAutoBuildPreview(
        tenantId,
        new Date(targetWeekStart),
        userId
      );

      // Save the run to database for review workflow
      const run = await saveAutoBuildRun(tenantId, preview, userId);
      
      res.json({
        success: true,
        runId: run.id,
        preview,
      });
    } catch (error: any) {
      console.error("Auto-build preview error:", error);
      res.status(500).json({ message: "Failed to generate auto-build preview", error: error.message });
    }
  });

  // GET /api/auto-build/runs - Get all auto-build runs for tenant
  app.get("/api/auto-build/runs", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { getAutoBuildRuns } = await import("./auto-build-engine");
      const runs = await getAutoBuildRuns(tenantId);
      
      res.json(runs);
    } catch (error: any) {
      console.error("Get auto-build runs error:", error);
      res.status(500).json({ message: "Failed to get auto-build runs", error: error.message });
    }
  });

  // POST /api/auto-build/commit - Commit approved auto-build suggestions
  app.post("/api/auto-build/commit", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      
      const { runId, approvedBlockIds } = req.body;
      if (!runId || !approvedBlockIds || !Array.isArray(approvedBlockIds)) {
        return res.status(400).json({ message: "Missing required fields: runId, approvedBlockIds" });
      }

      const { commitAutoBuildRun } = await import("./auto-build-engine");
      const result = await commitAutoBuildRun(runId, approvedBlockIds, userId);
      
      res.json({
        success: true,
        message: `Successfully created ${result.created} assignments${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
        ...result,
      });
    } catch (error: any) {
      console.error("Auto-build commit error:", error);
      res.status(500).json({ message: "Failed to commit auto-build", error: error.message });
    }
  });

  // ==================== EXCEL IMPORT ====================

  // POST /api/schedules/excel-import - Import schedule from Excel file
  // Uses existing multer upload configuration
  // Supports importMode parameter: 'block' (legacy) or 'shift' (Contract Slot approach)
  app.post("/api/schedules/excel-import", requireAuth, upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Extract optional startDate filter from query parameters
      const startDateFilter = req.query.startDate ? new Date(req.query.startDate as string) : null;

      // Validate importMode parameter (defaults to 'block' for backward compatibility)
      const importMode = req.body.importMode || 'block';
      if (importMode !== 'block' && importMode !== 'shift') {
        return res.status(400).json({ 
          message: "Invalid importMode. Must be 'block' or 'shift'." 
        });
      }

      // Check if debug mode is enabled
      const debugMode = req.body.debugMode === 'true' || req.body.debugMode === true;

      // Dispatch to appropriate parser based on mode
      const { parseExcelSchedule, parseExcelScheduleShiftBased } = await import("./excel-import");
      const importFn = importMode === 'shift' ? parseExcelScheduleShiftBased : parseExcelSchedule;
      const result = await importFn(tenantId, req.file.buffer, userId, debugMode, startDateFilter);
      
      // Automatically recompute patterns after successful import (async, non-blocking)
      // This ensures Auto-Build has fresh patterns for next week's suggestions
      let patternRecomputeStatus: 'started' | 'skipped' | 'failed' = 'skipped';
      if (result.created > 0) {
        patternRecomputeStatus = 'started';
        // Run async without blocking the response
        (async () => {
          try {
            const { recomputePatterns } = await import("./pattern-engine");
            const patternResult = await recomputePatterns(tenantId);
            console.log(`Pattern recompute after Excel import: ${patternResult.patternsCreated} patterns created for ${patternResult.totalDrivers} drivers`);
          } catch (patternError: any) {
            console.error("Pattern recompute after import failed:", patternError);
          }
        })();
      }
      
      // Build success message with breakdown
      let message = '';
      if (result.totalOccurrences !== undefined) {
        // Shift-based import: show total occurrences and breakdown
        const unassigned = result.totalOccurrences - result.created;
        message = `Successfully imported ${result.totalOccurrences} shift(s): ${result.created} assigned, ${unassigned} unassigned${result.failed > 0 ? `, ${result.failed} failed` : ''}. Pattern recompute ${patternRecomputeStatus}.`;
      } else {
        // Block-based import: traditional message
        message = `Successfully imported ${result.created} assignments${result.failed > 0 ? `, ${result.failed} failed` : ''}. Pattern recompute ${patternRecomputeStatus}.`;
      }

      res.json({
        success: true,
        message,
        patternRecomputeStatus,
        ...result,
      });
    } catch (error: any) {
      console.error("Excel import error:", error);
      res.status(500).json({ message: "Failed to import Excel file", error: error.message });
    }
  });

  // POST /api/schedules/compare-actuals - Compare actuals Excel against existing records
  // Returns a diff showing what changed (no-shows, swaps, time bumps)
  app.post("/api/schedules/compare-actuals", requireAuth, upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = req.session.tenantId!;

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Parse the actuals file to extract rows
      const { parseExcelToRows } = await import("./excel-import");
      const parsedRows = await parseExcelToRows(req.file.buffer);

      if (!parsedRows || parsedRows.length === 0) {
        return res.status(400).json({ message: "No valid rows found in file" });
      }

      // Get the week range from the parsed data
      const dates = parsedRows
        .filter((r: any) => r.serviceDate)
        .map((r: any) => new Date(r.serviceDate));

      if (dates.length === 0) {
        return res.status(400).json({ message: "No valid dates found in file" });
      }

      const minDate = new Date(Math.min(...dates.map((d: Date) => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map((d: Date) => d.getTime())));

      // Fetch existing shift occurrences for this date range
      const existingOccurrences = await db
        .select({
          occurrence: shiftOccurrences,
          assignment: blockAssignments,
          template: shiftTemplates,
          driver: drivers,
        })
        .from(shiftOccurrences)
        .leftJoin(blockAssignments, and(
          eq(blockAssignments.shiftOccurrenceId, shiftOccurrences.id),
          eq(blockAssignments.isActive, true)
        ))
        .leftJoin(shiftTemplates, eq(shiftTemplates.id, shiftOccurrences.templateId))
        .leftJoin(drivers, eq(drivers.id, blockAssignments.driverId))
        .where(and(
          eq(shiftOccurrences.tenantId, tenantId),
          gte(shiftOccurrences.serviceDate, format(minDate, 'yyyy-MM-dd')),
          lte(shiftOccurrences.serviceDate, format(maxDate, 'yyyy-MM-dd'))
        ));

      // Build lookup map by blockId + serviceDate for matching
      const existingByKey = new Map<string, typeof existingOccurrences[0]>();
      for (const record of existingOccurrences) {
        const key = `${record.occurrence.externalBlockId}:${record.occurrence.serviceDate}`;
        existingByKey.set(key, record);
      }

      // Compare changes
      const changes: Array<{
        type: 'no_show' | 'driver_swap' | 'time_change' | 'new_block' | 'missing_block';
        blockId: string;
        serviceDate: string;
        expected?: {
          driverName: string | null;
          startTime: string;
        };
        actual?: {
          driverName: string | null;
          startTime: string;
        };
        description: string;
      }> = [];

      const processedKeys = new Set<string>();

      // Check each row in the actuals file
      for (const row of parsedRows) {
        if (!row.blockId || !row.serviceDate) continue;

        const key = `${row.blockId}:${row.serviceDate}`;
        processedKeys.add(key);

        const existing = existingByKey.get(key);

        if (!existing) {
          // New block in actuals that wasn't in our schedule
          changes.push({
            type: 'new_block',
            blockId: row.blockId,
            serviceDate: row.serviceDate,
            actual: {
              driverName: row.driverName || null,
              startTime: row.startTime || 'Unknown',
            },
            description: `Block ${row.blockId} appeared in actuals but wasn't in the original schedule`,
          });
          continue;
        }

        const expectedDriverName = existing.driver
          ? `${existing.driver.firstName} ${existing.driver.lastName}`.trim()
          : null;
        const actualDriverName = row.driverName?.trim() || null;

        // Check for driver changes
        if (expectedDriverName !== actualDriverName) {
          if (!actualDriverName || actualDriverName.toLowerCase() === 'unassigned') {
            // No-show: we had a driver assigned but actual shows unassigned
            changes.push({
              type: 'no_show',
              blockId: row.blockId,
              serviceDate: row.serviceDate,
              expected: {
                driverName: expectedDriverName,
                startTime: format(new Date(existing.occurrence.scheduledStart), 'HH:mm'),
              },
              actual: {
                driverName: null,
                startTime: row.startTime || 'Unknown',
              },
              description: `${expectedDriverName} was assigned but didn't show. Block ran unassigned.`,
            });
          } else if (!expectedDriverName) {
            // We had it unassigned but someone drove it
            changes.push({
              type: 'driver_swap',
              blockId: row.blockId,
              serviceDate: row.serviceDate,
              expected: {
                driverName: null,
                startTime: format(new Date(existing.occurrence.scheduledStart), 'HH:mm'),
              },
              actual: {
                driverName: actualDriverName,
                startTime: row.startTime || 'Unknown',
              },
              description: `Block was unassigned but ${actualDriverName} drove it.`,
            });
          } else {
            // Different driver
            changes.push({
              type: 'driver_swap',
              blockId: row.blockId,
              serviceDate: row.serviceDate,
              expected: {
                driverName: expectedDriverName,
                startTime: format(new Date(existing.occurrence.scheduledStart), 'HH:mm'),
              },
              actual: {
                driverName: actualDriverName,
                startTime: row.startTime || 'Unknown',
              },
              description: `${expectedDriverName} was replaced by ${actualDriverName}.`,
            });
          }
        }

        // Check for significant time changes (more than 30 min bump)
        if (row.startTime && existing.occurrence.scheduledStart) {
          const expectedTime = format(new Date(existing.occurrence.scheduledStart), 'HH:mm');
          const actualTime = row.startTime;

          // Parse times to compare
          const [expH, expM] = expectedTime.split(':').map(Number);
          const [actH, actM] = actualTime.split(':').map(Number);
          const expMinutes = expH * 60 + expM;
          const actMinutes = actH * 60 + actM;
          const diffMinutes = Math.abs(expMinutes - actMinutes);

          if (diffMinutes > 30) {
            changes.push({
              type: 'time_change',
              blockId: row.blockId,
              serviceDate: row.serviceDate,
              expected: {
                driverName: expectedDriverName,
                startTime: expectedTime,
              },
              actual: {
                driverName: actualDriverName,
                startTime: actualTime,
              },
              description: `Start time changed from ${expectedTime} to ${actualTime} (${diffMinutes > 0 ? '+' : ''}${actMinutes - expMinutes} min).`,
            });
          }
        }
      }

      // Check for missing blocks (we had them scheduled but they're not in actuals)
      for (const [key, existing] of existingByKey) {
        if (!processedKeys.has(key)) {
          const expectedDriverName = existing.driver
            ? `${existing.driver.firstName} ${existing.driver.lastName}`.trim()
            : null;

          changes.push({
            type: 'missing_block',
            blockId: existing.occurrence.externalBlockId || 'Unknown',
            serviceDate: existing.occurrence.serviceDate,
            expected: {
              driverName: expectedDriverName,
              startTime: format(new Date(existing.occurrence.scheduledStart), 'HH:mm'),
            },
            description: `Block ${existing.occurrence.externalBlockId} was scheduled but not in actuals (cancelled?).`,
          });
        }
      }

      // Summary stats
      const summary = {
        totalChanges: changes.length,
        noShows: changes.filter(c => c.type === 'no_show').length,
        driverSwaps: changes.filter(c => c.type === 'driver_swap').length,
        timeChanges: changes.filter(c => c.type === 'time_change').length,
        newBlocks: changes.filter(c => c.type === 'new_block').length,
        missingBlocks: changes.filter(c => c.type === 'missing_block').length,
        dateRange: {
          start: format(minDate, 'yyyy-MM-dd'),
          end: format(maxDate, 'yyyy-MM-dd'),
        },
      };

      res.json({
        success: true,
        summary,
        changes,
      });
    } catch (error: any) {
      console.error("Actuals comparison error:", error);
      res.status(500).json({ message: "Failed to compare actuals", error: error.message });
    }
  });

  // ==================== ON-DEMAND COMPLIANCE ANALYSIS ====================

  // POST /api/schedules/analyze-compliance - Run Rolling-6 compliance analysis on current schedule
  app.post("/api/schedules/analyze-compliance", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart } = req.body; // Optional: analyze specific week

      console.log("[COMPLIANCE-ANALYSIS] Starting on-demand analysis...");

      // Fetch all active assignments with shift occurrences
      const allAssignments = await db
        .select()
        .from(blockAssignments)
        .where(and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.isActive, true)
        ));

      // Fetch all shift occurrences
      const allOccurrences = await db
        .select()
        .from(shiftOccurrences)
        .where(eq(shiftOccurrences.tenantId, tenantId));

      // Fetch all drivers
      const allDrivers = await db
        .select()
        .from(drivers)
        .where(eq(drivers.tenantId, tenantId));

      // Fetch shift templates for duration/soloType info
      const allTemplates = await db
        .select()
        .from(shiftTemplates)
        .where(eq(shiftTemplates.tenantId, tenantId));

      // Fetch protected rules
      const protectedRules = await db
        .select()
        .from(protectedDriverRules)
        .where(eq(protectedDriverRules.tenantId, tenantId));

      // Build lookup maps
      const occurrenceMap = new Map(allOccurrences.map(o => [o.id, o]));
      const driverMap = new Map(allDrivers.map(d => [d.id, d]));
      const templateMap = new Map(allTemplates.map(t => [t.id, t]));

      // Import validation functions
      const { validateRolling6Compliance, shiftOccurrenceToAssignmentSubject, validateProtectedDriverRules } = await import("./rolling6-calculator");

      // Results structure
      const violations: Array<{
        occurrenceId: string;
        driverId: string;
        driverName: string;
        blockId: string;
        serviceDate: string;
        startTime: string;
        type: "violation" | "warning";
        messages: string[];
        metrics?: Record<string, any>;
      }> = [];

      // Bump detection results (time shifts from canonical schedule)
      const bumps: Array<{
        occurrenceId: string;
        driverId: string;
        driverName: string;
        blockId: string;
        serviceDate: string;
        scheduledTime: string;
        canonicalTime: string;
        bumpMinutes: number;
        bumpHours: number;
        severity: "info" | "warning" | "alert"; // info: ≤1h, warning: 1-2h, alert: >2h
      }> = [];

      let analyzed = 0;
      const total = allAssignments.length;

      // Analyze each assignment
      for (const assignment of allAssignments) {
        if (!assignment.shiftOccurrenceId || !assignment.driverId) continue;

        const occurrence = occurrenceMap.get(assignment.shiftOccurrenceId);
        const driver = driverMap.get(assignment.driverId);

        if (!occurrence || !driver) continue;

        const template = templateMap.get(occurrence.templateId);
        if (!template) continue;

        // Filter to this week if specified
        if (weekStart) {
          const occDate = new Date(occurrence.serviceDate);
          const weekStartDate = new Date(weekStart);
          const weekEndDate = new Date(weekStart);
          weekEndDate.setDate(weekEndDate.getDate() + 7);

          if (occDate < weekStartDate || occDate >= weekEndDate) {
            continue;
          }
        }

        analyzed++;

        // Bump detection: compare scheduled time vs canonical time
        if (template.canonicalStartTime && occurrence.scheduledStart) {
          const [canonicalHour, canonicalMin] = template.canonicalStartTime.split(':').map(Number);
          const canonicalMinutesOfDay = canonicalHour * 60 + canonicalMin;

          const scheduledTime = new Date(occurrence.scheduledStart);
          const scheduledMinutesOfDay = scheduledTime.getHours() * 60 + scheduledTime.getMinutes();

          // Calculate bump with cross-midnight handling
          let bumpMinutes = scheduledMinutesOfDay - canonicalMinutesOfDay;
          if (bumpMinutes < -720) bumpMinutes += 1440; // Handle cross-midnight
          if (bumpMinutes > 720) bumpMinutes -= 1440;

          // Only report non-zero bumps
          if (bumpMinutes !== 0) {
            const absBumpMinutes = Math.abs(bumpMinutes);
            const severity = absBumpMinutes <= 60 ? "info" : absBumpMinutes <= 120 ? "warning" : "alert";

            bumps.push({
              occurrenceId: occurrence.id,
              driverId: driver.id,
              driverName: `${driver.firstName} ${driver.lastName}`,
              blockId: occurrence.externalBlockId || occurrence.id,
              serviceDate: occurrence.serviceDate,
              scheduledTime: occurrence.startTime,
              canonicalTime: template.canonicalStartTime,
              bumpMinutes,
              bumpHours: parseFloat((bumpMinutes / 60).toFixed(1)),
              severity,
            });
          }
        }

        // Build assignment subject for validation
        const subject = shiftOccurrenceToAssignmentSubject(occurrence, template);

        // Get driver's other assignments for context
        const driverAssignments = allAssignments
          .filter(a => a.driverId === driver.id && a.id !== assignment.id)
          .map(a => {
            const occ = occurrenceMap.get(a.shiftOccurrenceId!);
            const tmpl = occ ? templateMap.get(occ.templateId) : null;
            if (!occ || !tmpl) return null;
            return {
              ...a,
              block: {
                id: occ.id,
                startTimestamp: `${occ.serviceDate}T${occ.startTime}:00`,
                endTimestamp: `${occ.serviceDate}T${occ.endTime || occ.startTime}:00`,
                duration: tmpl.durationHours,
              }
            };
          })
          .filter(Boolean) as any[];

        // Run Rolling-6 validation
        const validationResult = await validateRolling6Compliance(
          driver,
          subject,
          driverAssignments
        );

        // Check protected driver rules (returns string[] of violation messages)
        const protectedViolations = validateProtectedDriverRules(
          driver,
          subject,
          protectedRules
        );

        // Collect violations/warnings from Rolling-6
        if (validationResult.validationStatus === "violation" || validationResult.validationStatus === "warning") {
          violations.push({
            occurrenceId: occurrence.id,
            driverId: driver.id,
            driverName: `${driver.firstName} ${driver.lastName}`,
            blockId: occurrence.externalBlockId || occurrence.id,
            serviceDate: occurrence.serviceDate,
            startTime: occurrence.startTime,
            type: validationResult.validationStatus,
            messages: validationResult.messages,
            metrics: validationResult.metrics,
          });
        }

        // Collect violations from protected driver rules
        if (protectedViolations && protectedViolations.length > 0) {
          violations.push({
            occurrenceId: occurrence.id,
            driverId: driver.id,
            driverName: `${driver.firstName} ${driver.lastName}`,
            blockId: occurrence.externalBlockId || occurrence.id,
            serviceDate: occurrence.serviceDate,
            startTime: occurrence.startTime,
            type: "violation",
            messages: protectedViolations,
          });
        }
      }

      console.log(`[COMPLIANCE-ANALYSIS] Complete: ${analyzed} assignments analyzed, ${violations.length} HOS issues, ${bumps.length} time bumps found`);

      res.json({
        success: true,
        analyzed,
        total,
        violationCount: violations.filter(v => v.type === "violation").length,
        warningCount: violations.filter(v => v.type === "warning").length,
        violations,
        // Bump analysis results
        bumps,
        bumpCount: bumps.length,
        bumpStats: {
          total: bumps.length,
          info: bumps.filter(b => b.severity === "info").length,
          warning: bumps.filter(b => b.severity === "warning").length,
          alert: bumps.filter(b => b.severity === "alert").length,
        },
      });
    } catch (error: any) {
      console.error("Compliance analysis error:", error);
      res.status(500).json({ message: "Failed to analyze compliance", error: error.message });
    }
  });

  // ==================== PATTERN-AWARE AUTO-ASSIGNMENT ====================

  // GET /api/schedules/assignment-suggestions/:blockId - Get driver suggestions for a block
  app.get("/api/schedules/assignment-suggestions/:blockId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { blockId } = req.params;

      const { getAssignmentSuggestions } = await import("./auto-assignment");
      const suggestions = await getAssignmentSuggestions(tenantId, blockId);

      res.json({ suggestions });
    } catch (error: any) {
      console.error("Assignment suggestions error:", error);
      res.status(500).json({ message: "Failed to get assignment suggestions", error: error.message });
    }
  });

  // POST /api/schedules/assign-driver - Assign a driver to a block with pattern tracking
  app.post("/api/schedules/assign-driver", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const { blockId, driverId, isAutoAssigned = false, confidenceScore } = req.body;

      if (!blockId || !driverId) {
        return res.status(400).json({ message: "Missing required fields: blockId, driverId" });
      }

      // Fetch block and driver
      const block = await db
        .select()
        .from(blocks)
        .where(and(eq(blocks.tenantId, tenantId), eq(blocks.id, blockId)))
        .limit(1);

      if (!block[0]) {
        return res.status(404).json({ message: "Block not found" });
      }

      const driver = await db
        .select()
        .from(drivers)
        .where(and(eq(drivers.tenantId, tenantId), eq(drivers.id, driverId)))
        .limit(1);

      if (!driver[0]) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const targetBlock = block[0];
      const targetDriver = driver[0];

      // Check if block already assigned
      const existingAssignment = await db
        .select()
        .from(blockAssignments)
        .where(and(eq(blockAssignments.tenantId, tenantId), eq(blockAssignments.blockId, blockId)))
        .limit(1);

      if (existingAssignment.length > 0) {
        return res.status(400).json({ message: "Block is already assigned to another driver" });
      }

      // Validate assignment using existing validation logic
      const driverExistingAssignments = await db
        .select()
        .from(blockAssignments)
        .where(and(eq(blockAssignments.tenantId, tenantId), eq(blockAssignments.driverId, driverId)));

      const assignmentBlockIds = driverExistingAssignments
        .map((a) => a.blockId)
        .filter((id): id is string => id !== null);
      const assignmentBlocks = assignmentBlockIds.length > 0
        ? await db.select().from(blocks).where(inArray(blocks.id, assignmentBlockIds))
        : [];

      const blockMap = new Map(assignmentBlocks.map((b) => [b.id, b]));

      const driverAssignmentsWithBlocks = driverExistingAssignments.map((assignment) => ({
        ...assignment,
        block: blockMap.get(assignment.blockId) || targetBlock,
      }));

      const protectedRules = await db
        .select()
        .from(protectedDriverRules)
        .where(eq(protectedDriverRules.tenantId, tenantId));

      const allExistingAssignments = await db
        .select()
        .from(blockAssignments)
        .where(eq(blockAssignments.tenantId, tenantId));

      const validation = await validateBlockAssignment(
        targetDriver,
        blockToAssignmentSubject(targetBlock),
        driverAssignmentsWithBlocks,
        protectedRules,
        allExistingAssignments,
        targetBlock.id // For conflict checking
      );

      if (!validation.canAssign) {
        return res.status(400).json({
          message: "Assignment violates protected driver rules or conflicts",
          violations: validation.protectedRuleViolations,
          conflicts: validation.conflictingAssignments,
        });
      }

      if (validation.validationResult.validationStatus === "violation") {
        return res.status(400).json({
          message: "Assignment violates DOT compliance",
          validationMessages: validation.validationResult.messages,
        });
      }

      // Calculate bump minutes for history tracking
      const { calculateBumpMinutes } = await import("./bump-validation");
      const bumpMinutes = targetBlock.canonicalStart
        ? calculateBumpMinutes(new Date(targetBlock.startTimestamp), new Date(targetBlock.canonicalStart))
        : 0;

      // Create block assignment
      await db.insert(blockAssignments).values({
        tenantId,
        blockId,
        driverId,
        assignedBy: userId,
        validationStatus: validation.validationResult.validationStatus,
        validationSummary: validation.validationResult.metrics
          ? JSON.stringify(validation.validationResult.metrics)
          : null,
        notes: isAutoAssigned ? `Auto-assigned (confidence: ${confidenceScore}%)` : "Manual assignment",
      });

      // Update block status
      await db.update(blocks).set({ status: "assigned" }).where(eq(blocks.id, blockId));

      // Create assignment history record (if pattern metadata exists)
      if (targetBlock.patternGroup && targetBlock.canonicalStart && targetBlock.cycleId) {
        await db.insert(assignmentHistory).values({
          tenantId,
          blockId,
          driverId,
          contractId: targetBlock.contractId,
          startTimestamp: targetBlock.startTimestamp,
          canonicalStart: targetBlock.canonicalStart,
          patternGroup: targetBlock.patternGroup,
          cycleId: targetBlock.cycleId,
          bumpMinutes,
          isAutoAssigned,
          confidenceScore: confidenceScore || null,
          assignmentSource: isAutoAssigned ? "auto" : "manual",
          assignedBy: userId,
        });

        // Update driver contract stats (upsert logic)
        const existingStats = await db
          .select()
          .from(driverContractStats)
          .where(
            and(
              eq(driverContractStats.tenantId, tenantId),
              eq(driverContractStats.driverId, driverId),
              eq(driverContractStats.contractId, targetBlock.contractId),
              eq(driverContractStats.patternGroup, targetBlock.patternGroup)
            )
          )
          .limit(1);

        if (existingStats.length > 0) {
          // Update existing stats
          const stats = existingStats[0];
          const newTotalAssignments = stats.totalAssignments + 1;
          const newAvgBumpMinutes = Math.round(
            (stats.avgBumpMinutes * stats.totalAssignments + bumpMinutes) / newTotalAssignments
          );

          await db
            .update(driverContractStats)
            .set({
              totalAssignments: newTotalAssignments,
              streakCount: stats.lastCycleId === targetBlock.cycleId ? stats.streakCount : stats.streakCount + 1,
              avgBumpMinutes: newAvgBumpMinutes,
              lastWorked: targetBlock.startTimestamp,
              lastCycleId: targetBlock.cycleId,
            })
            .where(eq(driverContractStats.id, stats.id));
        } else {
          // Create new stats record
          await db.insert(driverContractStats).values({
            tenantId,
            driverId,
            contractId: targetBlock.contractId,
            patternGroup: targetBlock.patternGroup,
            totalAssignments: 1,
            streakCount: 1,
            avgBumpMinutes: bumpMinutes,
            lastWorked: targetBlock.startTimestamp,
            lastCycleId: targetBlock.cycleId,
          });
        }
      }

      res.json({
        success: true,
        message: `Successfully assigned ${targetDriver.firstName} ${targetDriver.lastName} to block ${targetBlock.blockId}`,
        validationStatus: validation.validationResult.validationStatus,
        validationMessages: validation.validationResult.messages,
      });
    } catch (error: any) {
      console.error("Driver assignment error:", error);
      res.status(500).json({ message: "Failed to assign driver", error: error.message });
    }
  });

  // ==================== CSV IMPORT ====================

  // POST /api/schedules/import-validate - Validate CSV import without committing
  app.post("/api/schedules/import-validate", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { csvRows } = req.body;
      if (!csvRows || !Array.isArray(csvRows)) {
        return res.status(400).json({ message: "Missing required field: csvRows (array)" });
      }

      const { validateCSVImport } = await import("./csv-import");
      const validationResults = await validateCSVImport(tenantId, csvRows);
      
      res.json(validationResults);
    } catch (error: any) {
      console.error("CSV validation error:", error);
      res.status(500).json({ message: "Failed to validate CSV import", error: error.message });
    }
  });

  // POST /api/schedules/import-commit - Commit validated CSV rows
  app.post("/api/schedules/import-commit", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      const { validatedRows } = req.body;
      if (!validatedRows || !Array.isArray(validatedRows)) {
        return res.status(400).json({ message: "Missing required field: validatedRows (array)" });
      }

      const { commitCSVImport } = await import("./csv-import");
      const result = await commitCSVImport(tenantId, validatedRows, userId);
      
      res.json({
        success: true,
        message: `Successfully created ${result.created} assignments${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
        ...result,
      });
    } catch (error: any) {
      console.error("CSV commit error:", error);
      res.status(500).json({ message: "Failed to commit CSV import", error: error.message });
    }
  });

  // ==================== PYTHON-POWERED ANALYSIS ====================

  // POST /api/analysis/excel-parse - Analyze Excel file using Python pandas
  app.post("/api/analysis/excel-parse", requireAuth, upload.single('file'), async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      if (!req.file) {
        return res.status(400).json({ message: "No file provided" });
      }

      // Save temp file for Python to read
      const fs = await import("fs");
      const path = await import("path");
      const os = await import("os");
      
      const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}.xlsx`);
      fs.writeFileSync(tempFilePath, req.file.buffer);

      const startTime = Date.now();
      const { parseExcelFile } = await import("./python-bridge");
      const pythonResult = await parseExcelFile(tempFilePath);
      const executionTime = Date.now() - startTime;

      // Clean up temp file
      fs.unlinkSync(tempFilePath);

      if (!pythonResult.success || !pythonResult.data) {
        return res.status(400).json({ 
          message: "Failed to parse Excel file", 
          error: pythonResult.error 
        });
      }

      // Store analysis result
      const { analysisResults } = await import("@shared/schema");
      await db.insert(analysisResults).values({
        tenantId,
        analysisType: 'excel_parse',
        inputData: { filename: req.file.originalname },
        result: pythonResult.data as any,
        success: true,
        executionTimeMs: executionTime,
        createdBy: userId,
      });

      res.json({
        success: true,
        analysis: pythonResult.data,
        executionTimeMs: executionTime,
      });
    } catch (error: any) {
      console.error("Python Excel parse error:", error);
      res.status(500).json({ message: "Failed to analyze Excel file", error: error.message });
    }
  });

  // POST /api/analysis/predict-assignments - Get AI-powered driver assignment recommendations
  app.post("/api/analysis/predict-assignments", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      const { blocks, constraints } = req.body;
      
      if (!blocks || !Array.isArray(blocks)) {
        return res.status(400).json({ message: "Missing required field: blocks (array)" });
      }

      // Get all drivers for matching
      const allDrivers = await db
        .select()
        .from(drivers)
        .where(eq(drivers.tenantId, tenantId));

      // Get historical assignments for better predictions
      const historicalAssignments = await db
        .select({
          driverId: shiftOccurrences.driverId,
          blockId: shiftOccurrences.blockId,
          completed: sql<boolean>`true`, // Assuming past assignments were completed
        })
        .from(shiftOccurrences)
        .where(and(
          eq(shiftOccurrences.tenantId, tenantId),
          sql`${shiftOccurrences.driver_id} IS NOT NULL`
        ))
        .limit(1000);

      const startTime = Date.now();
      const { predictAssignments } = await import("./python-bridge");
      const pythonResult = await predictAssignments({
        action: 'predict',
        blocks,
        drivers: allDrivers,
        constraints: constraints || {},
        historical: historicalAssignments,
      });
      const executionTime = Date.now() - startTime;

      if (!pythonResult.success || !pythonResult.data) {
        return res.status(400).json({ 
          message: "Failed to generate predictions", 
          error: pythonResult.error 
        });
      }

      // Store analysis result
      const { analysisResults } = await import("@shared/schema");
      await db.insert(analysisResults).values({
        tenantId,
        analysisType: 'assignment_prediction',
        inputData: { blocksCount: blocks.length, driversCount: allDrivers.length },
        result: pythonResult.data as any,
        success: true,
        executionTimeMs: executionTime,
        createdBy: userId,
      });

      res.json({
        success: true,
        recommendations: pythonResult.data.recommendations,
        executionTimeMs: executionTime,
      });
    } catch (error: any) {
      console.error("Python prediction error:", error);
      res.status(500).json({ message: "Failed to generate predictions", error: error.message });
    }
  });

  // POST /api/analysis/coverage - Analyze schedule coverage and gaps
  app.post("/api/analysis/coverage", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      const { weekStart, weekEnd } = req.body;
      
      if (!weekStart || !weekEnd) {
        return res.status(400).json({ message: "Missing required fields: weekStart, weekEnd" });
      }

      // Get schedule for the week
      const schedule = await db
        .select({
          id: shiftOccurrences.id,
          blockId: shiftOccurrences.blockId,
          driverId: shiftOccurrences.driverId,
          date: shiftOccurrences.shiftDate,
          contractType: shiftOccurrences.contractType,
        })
        .from(shiftOccurrences)
        .where(and(
          eq(shiftOccurrences.tenantId, tenantId),
          sql`${shiftOccurrences.shift_date} >= ${weekStart}`,
          sql`${shiftOccurrences.shift_date} <= ${weekEnd}`
        ));

      const startTime = Date.now();
      const { analyzeCoverage } = await import("./python-bridge");
      const pythonResult = await analyzeCoverage({
        action: 'analyze_coverage',
        schedule: schedule.map(s => ({
          blockId: s.blockId,
          driverId: s.driverId,
          date: s.date?.toISOString(),
          contractType: s.contractType,
        })),
        date_range: { start: weekStart, end: weekEnd },
      });
      const executionTime = Date.now() - startTime;

      if (!pythonResult.success || !pythonResult.data) {
        return res.status(400).json({ 
          message: "Failed to analyze coverage", 
          error: pythonResult.error 
        });
      }

      // Store analysis result
      const { analysisResults } = await import("@shared/schema");
      await db.insert(analysisResults).values({
        tenantId,
        analysisType: 'coverage_analysis',
        inputData: { weekStart, weekEnd, scheduleCount: schedule.length },
        result: pythonResult.data as any,
        success: true,
        executionTimeMs: executionTime,
        createdBy: userId,
      });

      res.json({
        success: true,
        analysis: pythonResult.data.analysis,
        executionTimeMs: executionTime,
      });
    } catch (error: any) {
      console.error("Python coverage analysis error:", error);
      res.status(500).json({ message: "Failed to analyze coverage", error: error.message });
    }
  });

  // ==================== AI ASSISTANT ====================

  // POST /api/ai/query - Ask AI assistant about schedules and data
  app.post("/api/ai/query", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;

      const { query, context } = req.body;

      if (!query) {
        return res.status(400).json({ message: "Missing required field: query" });
      }

      // Check if OpenAI key is available
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({
          message: "AI assistant not configured. Please add OPENAI_API_KEY to environment variables."
        });
      }

      // TODO: Implement OpenAI integration
      // For now, return a placeholder response
      res.json({
        success: false,
        message: "AI assistant feature coming soon. OpenAI integration in progress.",
        query,
      });
    } catch (error: any) {
      console.error("AI query error:", error);
      res.status(500).json({ message: "Failed to process AI query", error: error.message });
    }
  });

  // ===== Chat Session Management =====

  // Get all chat sessions for the current user (last 6 weeks)
  app.get("/api/chat/sessions", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const weeksBack = parseInt(req.query.weeksBack as string) || 6;

      const sessions = await dbStorage.getRecentChatSessions(tenantId, userId, weeksBack);
      res.json(sessions);
    } catch (error: any) {
      console.error("Error fetching chat sessions:", error);
      res.status(500).json({ message: "Failed to fetch chat sessions", error: error.message });
    }
  });

  // Get a specific chat session with its messages
  app.get("/api/chat/sessions/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const tenantId = req.session.tenantId!;

      const session = await dbStorage.getChatSession(sessionId);
      if (!session || session.tenantId !== tenantId) {
        return res.status(404).json({ message: "Session not found" });
      }

      const messages = await dbStorage.getChatMessages(sessionId);
      res.json({ session, messages });
    } catch (error: any) {
      console.error("Error fetching chat session:", error);
      res.status(500).json({ message: "Failed to fetch chat session", error: error.message });
    }
  });

  // Create a new chat session
  app.post("/api/chat/sessions", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const { title } = req.body;

      const session = await dbStorage.createChatSession({
        tenantId,
        userId,
        title: title || null,
        messageCount: 0,
        isActive: true,
      });

      res.json(session);
    } catch (error: any) {
      console.error("Error creating chat session:", error);
      res.status(500).json({ message: "Failed to create chat session", error: error.message });
    }
  });

  // Add a message to a chat session
  app.post("/api/chat/sessions/:sessionId/messages", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const tenantId = req.session.tenantId!;
      const { role, content, tokensUsed, toolCalls } = req.body;

      // Verify session belongs to this tenant
      const session = await dbStorage.getChatSession(sessionId);
      if (!session || session.tenantId !== tenantId) {
        return res.status(404).json({ message: "Session not found" });
      }

      const message = await dbStorage.createChatMessage({
        sessionId,
        role,
        content,
        tokensUsed: tokensUsed || null,
        toolCalls: toolCalls || null,
      });

      // Auto-generate title from first user message if session has no title
      if (!session.title && role === "user" && session.messageCount === 0) {
        const title = content.length > 50 ? content.substring(0, 50) + "..." : content;
        await dbStorage.updateChatSession(sessionId, { title });
      }

      res.json(message);
    } catch (error: any) {
      console.error("Error adding chat message:", error);
      res.status(500).json({ message: "Failed to add message", error: error.message });
    }
  });

  // Archive a chat session
  app.delete("/api/chat/sessions/:sessionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const tenantId = req.session.tenantId!;

      // Verify session belongs to this tenant
      const session = await dbStorage.getChatSession(sessionId);
      if (!session || session.tenantId !== tenantId) {
        return res.status(404).json({ message: "Session not found" });
      }

      await dbStorage.archiveChatSession(sessionId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error archiving chat session:", error);
      res.status(500).json({ message: "Failed to archive session", error: error.message });
    }
  });

  // Get chat history summary for Milo's memory context
  app.get("/api/chat/history-summary", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const weeksBack = parseInt(req.query.weeksBack as string) || 6;

      const summary = await dbStorage.getChatHistorySummary(tenantId, userId, weeksBack);
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching chat history summary:", error);
      res.status(500).json({ message: "Failed to fetch history summary", error: error.message });
    }
  });

  // ==================== NEURAL INTELLIGENCE SYSTEM ====================

  // Lazy-load the neural system to avoid circular dependencies
  let orchestratorPromise: Promise<any> | null = null;
  const getNeuralOrchestrator = async () => {
    if (!orchestratorPromise) {
      const { getOrchestrator } = await import("./ai");
      orchestratorPromise = getOrchestrator();
    }
    return orchestratorPromise;
  };

  // POST /api/gemini/reconstruct - Reconstruct blocks from trip-level CSV using Gemini
  app.post("/api/gemini/reconstruct", requireAuth, async (req: Request, res: Response) => {
    try {
      const { csvData } = req.body;

      if (!csvData) {
        return res.status(400).json({ message: "Missing required field: csvData" });
      }

      const { reconstructBlocksWithGemini } = await import("./gemini-reconstruct");
      const result = await reconstructBlocksWithGemini(csvData);

      if (result.success) {
        res.json({
          success: true,
          blocks: result.blocks,
          blockCount: result.blocks?.length || 0,
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error,
          rawResponse: result.rawResponse,
        });
      }
    } catch (error: any) {
      console.error("Gemini reconstruct error:", error);
      res.status(500).json({
        success: false,
        message: "Block reconstruction failed",
        error: error.message,
      });
    }
  });

  // POST /api/schedules/import-reconstructed - Import reconstructed blocks to calendar
  app.post("/api/schedules/import-reconstructed", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const { blocks: reconstructedBlocks } = req.body;

      if (!reconstructedBlocks || !Array.isArray(reconstructedBlocks) || reconstructedBlocks.length === 0) {
        return res.status(400).json({ message: "Missing required field: blocks (non-empty array)" });
      }

      console.log(`[IMPORT] Starting import of ${reconstructedBlocks.length} reconstructed blocks for tenant ${tenantId}`);

      // Fetch all contracts for this tenant to match against
      const tenantContracts = await db
        .select()
        .from(contracts)
        .where(eq(contracts.tenantId, tenantId));

      // Fetch all drivers for this tenant to match against
      const tenantDrivers = await db
        .select()
        .from(drivers)
        .where(eq(drivers.tenantId, tenantId));

      // Build lookup maps
      const contractMap = new Map<string, typeof tenantContracts[0]>();
      for (const contract of tenantContracts) {
        // Create lookup keys like "Solo2_Tractor_6" -> contract
        const key = `${contract.type.charAt(0).toUpperCase() + contract.type.slice(1)}_${contract.tractorId}`;
        contractMap.set(key, contract);
        // Also support lowercase key
        contractMap.set(key.toLowerCase(), contract);
      }

      // Build driver lookup by name (normalized)
      const driverMap = new Map<string, typeof tenantDrivers[0]>();
      for (const driver of tenantDrivers) {
        const fullName = `${driver.firstName} ${driver.lastName}`.toLowerCase().trim();
        driverMap.set(fullName, driver);
        // Also add initial + last name format: "M. FREEMAN" -> "m. freeman"
        if (driver.firstName && driver.lastName) {
          const initialFormat = `${driver.firstName.charAt(0).toLowerCase()}. ${driver.lastName.toLowerCase()}`;
          driverMap.set(initialFormat, driver);
        }
      }

      const results = {
        created: 0,
        skipped: 0,
        errors: [] as string[],
        assignments: 0,
      };

      const importBatchId = `recon_${Date.now()}`;

      for (const block of reconstructedBlocks) {
        try {
          // Parse contract from block.contract (e.g., "Solo2_Tractor_6")
          const contractKey = block.contract;
          const contract = contractMap.get(contractKey) || contractMap.get(contractKey?.toLowerCase());

          if (!contract) {
            results.errors.push(`Contract not found: ${contractKey} for block ${block.blockId}`);
            results.skipped++;
            continue;
          }

          // Parse duration (e.g., "38h" -> 38)
          const durationMatch = block.duration?.match(/(\d+)/);
          const duration = durationMatch ? parseInt(durationMatch[1]) : contract.duration;

          // Parse solo type from contract key
          const soloMatch = contractKey?.match(/(solo[12])/i);
          const soloType = soloMatch ? soloMatch[1].toLowerCase() : contract.type;

          // Parse tractor from contract key (e.g., "Solo2_Tractor_6" -> "Tractor_6")
          const tractorMatch = contractKey?.match(/tractor_(\d+)/i);
          const tractorId = tractorMatch ? `Tractor_${tractorMatch[1]}` : contract.tractorId;

          // Parse start date and time
          const startDate = new Date(block.startDate + 'T00:00:00');
          const [hours, minutes] = (block.canonicalStartTime || contract.startTime).split(':').map(Number);
          const startTimestamp = new Date(startDate);
          startTimestamp.setHours(hours, minutes, 0, 0);

          // Calculate end timestamp
          const endTimestamp = new Date(startTimestamp);
          endTimestamp.setHours(endTimestamp.getHours() + duration);

          // Check if this block already exists
          const existingBlock = await db
            .select()
            .from(blocks)
            .where(and(
              eq(blocks.tenantId, tenantId),
              eq(blocks.blockId, block.blockId),
              eq(blocks.serviceDate, startDate)
            ))
            .limit(1);

          let blockRecord;
          if (existingBlock.length > 0) {
            // Update existing block
            const updated = await db
              .update(blocks)
              .set({
                contractId: contract.id,
                startTimestamp,
                endTimestamp,
                tractorId,
                soloType,
                duration,
                status: 'assigned',
                updatedAt: new Date(),
              })
              .where(eq(blocks.id, existingBlock[0].id))
              .returning();
            blockRecord = updated[0];
            console.log(`[IMPORT] Updated existing block: ${block.blockId}`);
          } else {
            // Create new block
            const inserted = await db
              .insert(blocks)
              .values({
                tenantId,
                blockId: block.blockId,
                serviceDate: startDate,
                contractId: contract.id,
                startTimestamp,
                endTimestamp,
                tractorId,
                soloType,
                duration,
                status: 'assigned',
              })
              .returning();
            blockRecord = inserted[0];
            results.created++;
            console.log(`[IMPORT] Created block: ${block.blockId}`);
          }

          // Try to create driver assignment if we have a primary driver
          if (block.primaryDriver && blockRecord) {
            const driverName = block.primaryDriver.toLowerCase().trim();
            const driver = driverMap.get(driverName);

            if (driver) {
              // Check if assignment already exists
              const existingAssignment = await db
                .select()
                .from(blockAssignments)
                .where(and(
                  eq(blockAssignments.tenantId, tenantId),
                  eq(blockAssignments.blockId, blockRecord.id),
                  eq(blockAssignments.isActive, true)
                ))
                .limit(1);

              if (existingAssignment.length === 0) {
                await db.insert(blockAssignments).values({
                  tenantId,
                  blockId: blockRecord.id,
                  driverId: driver.id,
                  assignedBy: userId,
                  importBatchId,
                  amazonBlockId: block.blockId,
                  notes: `Imported from trip-level CSV reconstruction`,
                });
                results.assignments++;
                console.log(`[IMPORT] Assigned driver ${driver.firstName} ${driver.lastName} to block ${block.blockId}`);
              }
            } else {
              console.log(`[IMPORT] Driver not found: "${block.primaryDriver}" for block ${block.blockId}`);
            }
          }
        } catch (blockError: any) {
          results.errors.push(`Error processing block ${block.blockId}: ${blockError.message}`);
          results.skipped++;
        }
      }

      console.log(`[IMPORT] Complete: ${results.created} created, ${results.assignments} assignments, ${results.skipped} skipped, ${results.errors.length} errors`);

      res.json({
        success: true,
        message: `Imported ${results.created} blocks with ${results.assignments} driver assignments`,
        ...results,
        importBatchId,
      });
    } catch (error: any) {
      console.error("Import reconstructed blocks error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to import reconstructed blocks",
        error: error.message,
      });
    }
  });

  // POST /api/neural/process - Process a query through the neural intelligence system
  app.post("/api/neural/process", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const { input, sessionId, conversationHistory, forceAgent } = req.body;

      if (!input) {
        return res.status(400).json({ message: "Missing required field: input" });
      }

      // Check for required API keys
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({
          message: "Neural system not configured. Missing ANTHROPIC_API_KEY."
        });
      }

      const orchestrator = await getNeuralOrchestrator();

      const response = await orchestrator.process({
        input,
        tenantId,
        sessionId,
        userId,
        conversationHistory,
        forceAgent
      });

      res.json({
        success: true,
        ...response
      });
    } catch (error: any) {
      console.error("Neural process error:", error);
      res.status(500).json({
        success: false,
        message: "Neural processing failed",
        error: error.message
      });
    }
  });

  // GET /api/neural/status - Get neural system status and agent health
  app.get("/api/neural/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const orchestrator = await getNeuralOrchestrator();
      const agentStatus = orchestrator.getAgentStatus();

      res.json({
        status: "online",
        agents: agentStatus,
        config: {
          convergenceThreshold: 85,
          maxBranchDepth: 5,
          maxBranchesPerParent: 4,
          memoryRetentionWeeks: 6
        }
      });
    } catch (error: any) {
      console.error("Neural status error:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to get neural status",
        error: error.message
      });
    }
  });

  // GET /api/neural/patterns - Get learned patterns for the tenant
  app.get("/api/neural/patterns", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { type, status, minConfidence } = req.query;

      const { getPatternTracker } = await import("./ai");
      const patternTracker = getPatternTracker();

      // Get patterns with optional filters
      const patterns = await patternTracker.getPatterns(tenantId, {
        type: type as string,
        status: status as string,
        minConfidence: minConfidence ? parseInt(minConfidence as string) : undefined
      });

      res.json({ patterns });
    } catch (error: any) {
      console.error("Neural patterns error:", error);
      res.status(500).json({ message: "Failed to get patterns", error: error.message });
    }
  });

  // GET /api/neural/profiles/:entityType/:entityId - Get entity profile
  app.get("/api/neural/profiles/:entityType/:entityId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { entityType, entityId } = req.params;

      const { getProfileBuilder } = await import("./ai");
      const profileBuilder = getProfileBuilder();

      let profile;
      switch (entityType) {
        case "driver":
          profile = await profileBuilder.getDriverProfile(tenantId, entityId);
          break;
        case "block":
          profile = await profileBuilder.getBlockProfile(tenantId, entityId);
          break;
        case "user":
          profile = await profileBuilder.getUserProfile(tenantId, entityId);
          break;
        default:
          return res.status(400).json({ message: "Invalid entity type. Must be: driver, block, or user" });
      }

      if (!profile) {
        return res.status(404).json({ message: `${entityType} profile not found` });
      }

      res.json({ profile });
    } catch (error: any) {
      console.error("Neural profile error:", error);
      res.status(500).json({ message: "Failed to get profile", error: error.message });
    }
  });

  // GET /api/neural/thought-tree/:rootId - Get a thought tree by root ID
  app.get("/api/neural/thought-tree/:rootId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { rootId } = req.params;

      const { getBranchManager } = await import("./ai");
      const branchManager = getBranchManager();

      const tree = await branchManager.getTree(rootId);

      if (!tree) {
        return res.status(404).json({ message: "Thought tree not found" });
      }

      // Convert Map to array for JSON serialization
      const branches = Array.from(tree.branches.values());

      res.json({
        rootId: tree.rootId,
        tenantId: tree.tenantId,
        sessionId: tree.sessionId,
        maxDepth: tree.maxDepth,
        totalBranches: tree.totalBranches,
        convergencePath: tree.convergencePath,
        branches
      });
    } catch (error: any) {
      console.error("Neural thought tree error:", error);
      res.status(500).json({ message: "Failed to get thought tree", error: error.message });
    }
  });

  // POST /api/neural/memory/cleanup - Trigger memory cleanup (admin only)
  app.post("/api/neural/memory/cleanup", requireAuth, async (req: Request, res: Response) => {
    try {
      const { dryRun } = req.body;

      const { runCleanupOnce } = await import("./ai");
      const result = await runCleanupOnce({ dryRun: dryRun === true });

      res.json({
        success: true,
        result
      });
    } catch (error: any) {
      console.error("Neural cleanup error:", error);
      res.status(500).json({ message: "Failed to run cleanup", error: error.message });
    }
  });

  // POST /api/neural/analyze-confidence - Analyze confidence for a decision context
  app.post("/api/neural/analyze-confidence", requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        dotStatus,
        protectedRules,
        hasDriverData,
        hasBlockData,
        hasHistoricalData,
        patternMatches,
        agentOpinions
      } = req.body;

      const { getConfidenceCalculator } = await import("./ai");
      const calculator = getConfidenceCalculator();

      const score = calculator.calculate({
        dotStatus,
        protectedRules,
        hasDriverData: hasDriverData ?? true,
        hasBlockData: hasBlockData ?? true,
        hasHistoricalData: hasHistoricalData ?? false,
        patternMatches: patternMatches ?? 0,
        agentOpinions: agentOpinions ?? []
      });

      res.json({ score });
    } catch (error: any) {
      console.error("Confidence analysis error:", error);
      res.status(500).json({ message: "Failed to analyze confidence", error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
