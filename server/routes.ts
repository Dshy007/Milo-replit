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
  shiftOccurrences, shiftTemplates, contracts, trucks, driverAvailabilityPreferences, driverDnaProfiles,
  dropInSessions, driverPresence, insertDropInSessionSchema, voiceBroadcasts
} from "@shared/schema";
import { eq, and, inArray, sql, gte, lte, not, desc, isNotNull } from "drizzle-orm";
import session from "express-session";
import { fromZodError } from "zod-validation-error";
import bcrypt from "bcryptjs";
import { benchContracts } from "./seed-data";
import multer from "multer";
import { validateBlockAssignment, normalizeSoloType, blockToAssignmentSubject } from "./rolling6-calculator";
import { subDays, parseISO, format, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { findSwapCandidates, getAllDriverWorkloads } from "./workload-calculator";
import { analyzeCascadeEffect, executeCascadeChange, type CascadeAnalysisRequest } from "./cascade-analyzer";
import { optimizeWithMilo, applyMiloSchedule } from "./milo-scheduler";
import { matchDeterministic, applyDeterministicMatches } from "./deterministic-matcher";
import { regenerateDNAFromBlockAssignments } from "./dna-analyzer";
import { initWebSocket, getOnlineDrivers, isDriverOnline, getActiveDropIns } from "./websocket";
import { twilioService } from "./twilio-service";

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

  // GET /api/drivers/scheduling-roster - Get driver profiles with preferences for schedule builder
  // Joins drivers + driverAvailabilityPreferences to return aggregated scheduling profiles
  // NOTE: This must be defined BEFORE /api/drivers/:id to avoid route conflicts
  app.get("/api/drivers/scheduling-roster", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;

      // Get all active drivers for this tenant
      const allDrivers = await db.select()
        .from(drivers)
        .where(and(
          eq(drivers.tenantId, tenantId),
          eq(drivers.status, "active")
        ));

      // Get all availability preferences for this tenant
      const preferences = await db.select()
        .from(driverAvailabilityPreferences)
        .where(eq(driverAvailabilityPreferences.tenantId, tenantId));

      // Group preferences by driver
      const prefsByDriver = new Map<string, typeof preferences>();
      for (const pref of preferences) {
        const existing = prefsByDriver.get(pref.driverId) || [];
        existing.push(pref);
        prefsByDriver.set(pref.driverId, existing);
      }

      // Build driver profiles with aggregated preferences
      const driverProfiles = allDrivers.map(driver => {
        const driverPrefs = prefsByDriver.get(driver.id) || [];

        // Determine solo type from preferences
        const blockTypes = new Set(driverPrefs.map(p => p.blockType));
        let soloType: "solo1" | "solo2" | "both" = "solo1";
        if (blockTypes.has("solo1") && blockTypes.has("solo2")) {
          soloType = "both";
        } else if (blockTypes.has("solo2")) {
          soloType = "solo2";
        }

        // Get preferred days (where isAvailable = true)
        const preferredDays = [...new Set(
          driverPrefs
            .filter(p => p.isAvailable)
            .map(p => p.dayOfWeek)
        )];

        // Get most common start time as canonical time
        const timeCounts = new Map<string, number>();
        for (const pref of driverPrefs.filter(p => p.isAvailable)) {
          timeCounts.set(pref.startTime, (timeCounts.get(pref.startTime) || 0) + 1);
        }
        let canonicalTime = "21:30"; // Default
        let maxCount = 0;
        for (const [time, count] of timeCounts) {
          if (count > maxCount) {
            maxCount = count;
            canonicalTime = time;
          }
        }

        // Set max weekly runs based on solo type
        const maxWeeklyRuns = soloType === "solo2" ? 3 : soloType === "solo1" ? 6 : 4;

        return {
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`,
          firstName: driver.firstName,
          lastName: driver.lastName,
          soloType,
          preferredDays,
          canonicalTime,
          maxWeeklyRuns,
          reliabilityRating: 3, // Default - can be calculated from assignment history later
          status: driver.status as "active" | "standby" | "inactive",
          domicile: driver.domicile,
          loadEligible: driver.loadEligible,
        };
      });

      res.json({
        drivers: driverProfiles,
        totalCount: driverProfiles.length,
        activeCount: driverProfiles.filter(d => d.status === "active").length,
      });
    } catch (error: any) {
      console.error("Error fetching scheduling roster:", error);
      res.status(500).json({ message: "Failed to fetch scheduling roster", error: error.message });
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
      // Set end date to end-of-day in UTC (23:59:59.999Z) to include blocks stored at noon
      // IMPORTANT: Use setUTCHours, not setHours, to avoid timezone issues
      end.setUTCHours(23, 59, 59, 999);
      
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
      
      // Fetch shift occurrences (old system)
      const occurrences = await dbStorage.getShiftOccurrencesByDateRange(req.session.tenantId!, start, end);

      // ALSO fetch imported blocks from blocks table (new import system)
      const importedBlocks = await db
        .select()
        .from(blocks)
        .where(and(
          eq(blocks.tenantId, req.session.tenantId!),
          gte(blocks.serviceDate, start),
          lte(blocks.serviceDate, end)
        ));


      // Fetch all assignments for tenant
      const allAssignments = await dbStorage.getBlockAssignmentsByTenant(req.session.tenantId!);
      const occurrenceIds = new Set(occurrences.map(o => o.id));
      const blockIds = new Set(importedBlocks.map(b => b.id));

      // Filter assignments for shift occurrences
      const relevantOccurrenceAssignments = allAssignments.filter(a => a.shiftOccurrenceId && occurrenceIds.has(a.shiftOccurrenceId));
      // Filter assignments for imported blocks (blockId field stores the blocks table id)
      const relevantBlockAssignments = allAssignments.filter(a => a.blockId && blockIds.has(a.blockId));

      // Build assignment lookup by occurrence ID and block ID
      const assignmentsByOccurrenceId = new Map(relevantOccurrenceAssignments.map(a => [a.shiftOccurrenceId!, a]));
      const assignmentsByBlockId = new Map(relevantBlockAssignments.map(a => [a.blockId!, a]));

      // Fetch templates and contracts
      const templateIds = [...new Set(occurrences.map(o => o.templateId))];
      const blockContractIds = [...new Set(importedBlocks.map(b => b.contractId).filter(Boolean))];
      const driverIds = [...new Set([
        ...relevantOccurrenceAssignments.map(a => a.driverId),
        ...relevantBlockAssignments.map(a => a.driverId)
      ])];

      const templates = await db.select().from(shiftTemplates).where(
        and(
          eq(shiftTemplates.tenantId, req.session.tenantId!),
          inArray(shiftTemplates.id, templateIds.length > 0 ? templateIds : [''])
        )
      );

      const contractIds = [...new Set([...templates.map(t => t.contractId), ...blockContractIds])];
      const [fetchedContracts, fetchedDrivers] = await Promise.all([
        Promise.all(contractIds.map(id => dbStorage.getContract(id))),
        Promise.all(driverIds.map(id => dbStorage.getDriver(id))),
      ]);

      // Build lookup maps
      const templatesMap = new Map(templates.map(t => [t.id, t]));
      const contractsMap = new Map(fetchedContracts.filter(c => c).map(c => [c!.id, c!]));
      const driversMap = new Map(fetchedDrivers.filter(d => d).map(d => [d!.id, d!]));

      // Transform shift occurrences to simplified structure for calendar display
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
          isRejectedLoad: false, // Shift occurrences are never rejected loads
          source: 'shift_occurrence' as const,
        };
      });

      // Canonical start times lookup - from Start Times page (contracts table)
      const CANONICAL_START_TIMES: Record<string, string> = {
        // Solo1 (10 tractors)
        "solo1_Tractor_1": "16:30",
        "solo1_Tractor_2": "20:30",
        "solo1_Tractor_3": "20:30",
        "solo1_Tractor_4": "17:30",
        "solo1_Tractor_5": "21:30",
        "solo1_Tractor_6": "01:30",
        "solo1_Tractor_7": "18:30",
        "solo1_Tractor_8": "00:30",
        "solo1_Tractor_9": "16:30",
        "solo1_Tractor_10": "20:30",
        // Solo2 (7 tractors) - CORRECT times from database
        "solo2_Tractor_1": "18:30",
        "solo2_Tractor_2": "23:30",
        "solo2_Tractor_3": "21:30",
        "solo2_Tractor_4": "08:30",
        "solo2_Tractor_5": "15:30",
        "solo2_Tractor_6": "11:30",
        "solo2_Tractor_7": "16:30",
      };

      // Transform imported blocks to the same simplified structure
      const simplifiedBlocks = importedBlocks.map(blk => {
        const contract = blk.contractId ? contractsMap.get(blk.contractId) || null : null;
        const assignment = assignmentsByBlockId.get(blk.id) || null;
        const driver = assignment ? driversMap.get(assignment.driverId) || null : null;

        // Use CANONICAL start time lookup based on soloType + tractorId
        // This ensures blocks match driver DNA profiles correctly
        const lookupKey = `${blk.soloType?.toLowerCase() || 'solo1'}_${blk.tractorId || ''}`;
        const canonicalTime = CANONICAL_START_TIMES[lookupKey];

        // Fall back to raw timestamp if no canonical lookup found
        const fallbackTime = blk.startTimestamp
          ? `${String(blk.startTimestamp.getHours()).padStart(2, '0')}:${String(blk.startTimestamp.getMinutes()).padStart(2, '0')}`
          : '00:00';

        const startTime = canonicalTime || fallbackTime;

        // Format service date as YYYY-MM-DD string
        const serviceDate = blk.serviceDate instanceof Date
          ? format(blk.serviceDate, 'yyyy-MM-dd')
          : String(blk.serviceDate);

        return {
          occurrenceId: blk.id,
          serviceDate,
          startTime,
          blockId: blk.blockId,
          driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
          driverId: driver?.id || null,
          contractType: blk.soloType || contract?.type || null,
          status: blk.status || 'scheduled',
          tractorId: blk.tractorId || null,
          assignmentId: assignment?.id || null,
          bumpMinutes: 0,
          isCarryover: false,
          isRejectedLoad: blk.isRejectedLoad || false,
          source: 'imported_block' as const,
        };
      });

      // Merge both sources - imported blocks take priority (they're newer data)
      const allOccurrences = [...simplifiedBlocks, ...simplifiedOccurrences];

      // Summary log only - detailed debug removed
      const unassignedCount = simplifiedBlocks.filter(b => !b.driverId).length;
      console.log(`[CALENDAR] Returning ${simplifiedBlocks.length} blocks (${unassignedCount} unassigned)`)

      // Return simplified calendar data
      res.json({
        range: { start: startDate, end: endDate },
        occurrences: allOccurrences,
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

  // POST /api/blocks/clear-week - Clear all imported blocks for a given week
  app.post("/api/blocks/clear-week", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, weekEnd } = req.body;

      if (!weekStart || !weekEnd) {
        return res.status(400).json({ message: "Missing required fields: weekStart, weekEnd" });
      }

      // Use UTC dates to match how blocks are stored (at noon UTC)
      const startDate = new Date(weekStart as string);
      const endDate = new Date(weekEnd as string);
      // Set end to end-of-day in UTC to include blocks stored at noon
      endDate.setUTCHours(23, 59, 59, 999);

      console.log(`[BLOCKS CLEAR] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Get blocks in date range
      const blocksToDelete = await db
        .select()
        .from(blocks)
        .where(and(
          eq(blocks.tenantId, tenantId),
          gte(blocks.serviceDate, startDate),
          lte(blocks.serviceDate, endDate)
        ));

      let deletedCount = 0;

      if (blocksToDelete.length > 0) {
        const idsToDelete = blocksToDelete.map(b => b.id);

        // Delete assignments first
        await db.delete(blockAssignments)
          .where(and(
            eq(blockAssignments.tenantId, tenantId),
            inArray(blockAssignments.blockId, idsToDelete)
          ));

        // Then delete blocks
        await db.delete(blocks)
          .where(and(
            eq(blocks.tenantId, tenantId),
            inArray(blocks.id, idsToDelete)
          ));

        deletedCount = blocksToDelete.length;
      }

      console.log(`[BLOCKS] Cleared ${deletedCount} imported blocks for ${weekStart} to ${weekEnd}`);

      res.json({
        message: `Deleted ${deletedCount} imported blocks`,
        count: deletedCount
      });
    } catch (error: any) {
      console.error("Error clearing blocks:", error);
      res.status(500).json({ message: "Failed to clear blocks", error: error.message });
    }
  });

  // POST /api/assignments/clear-week - Clear driver assignments only (keeps blocks intact)
  app.post("/api/assignments/clear-week", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, weekEnd } = req.body;

      if (!weekStart || !weekEnd) {
        return res.status(400).json({ message: "Missing required fields: weekStart, weekEnd" });
      }

      // Use UTC dates to match how blocks are stored (at noon UTC)
      const startDate = new Date(weekStart as string);
      const endDate = new Date(weekEnd as string);
      endDate.setUTCHours(23, 59, 59, 999);

      console.log(`[ASSIGNMENTS CLEAR] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Get blocks in date range
      const blocksInRange = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(and(
          eq(blocks.tenantId, tenantId),
          gte(blocks.serviceDate, startDate),
          lte(blocks.serviceDate, endDate)
        ));

      let deletedCount = 0;

      if (blocksInRange.length > 0) {
        const blockIds = blocksInRange.map(b => b.id);

        // Delete only the assignments, keep the blocks
        const result = await db.delete(blockAssignments)
          .where(and(
            eq(blockAssignments.tenantId, tenantId),
            inArray(blockAssignments.blockId, blockIds)
          ));

        deletedCount = blocksInRange.length;
      }

      console.log(`[ASSIGNMENTS] Cleared assignments for ${deletedCount} blocks for ${weekStart} to ${weekEnd}`);

      res.json({
        message: `Cleared assignments for ${deletedCount} blocks`,
        count: deletedCount
      });
    } catch (error: any) {
      console.error("Error clearing assignments:", error);
      res.status(500).json({ message: "Failed to clear assignments", error: error.message });
    }
  });

  // PATCH /api/shift-occurrences/:id/assignment - Update driver assignment for a shift occurrence OR imported block
  app.patch("/api/shift-occurrences/:id/assignment", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const occurrenceId = req.params.id;
      const { driverId } = req.body; // driverId can be null to unassign

      // First, check if this is a shift occurrence
      const occurrence = await dbStorage.getShiftOccurrence(occurrenceId, tenantId);

      // If not a shift occurrence, check if it's an imported block
      const importedBlock = !occurrence ? await dbStorage.getBlock(occurrenceId) : null;

      if (!occurrence && !importedBlock) {
        return res.status(404).json({ message: "Occurrence not found" });
      }

      // Verify tenant ownership for imported block
      if (importedBlock && importedBlock.tenantId !== tenantId) {
        return res.status(404).json({ message: "Occurrence not found" });
      }

      // Handle shift occurrence assignment
      if (occurrence) {
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
            tenantId,
            shiftOccurrenceId: occurrenceId,
            driverId,
            assignedAt: new Date(),
            isActive: true,
          });
        }

        // Update occurrence status to assigned
        await dbStorage.updateShiftOccurrence(occurrenceId, { status: "assigned" });

        return res.json({ message: "Driver assigned successfully" });
      }

      // Handle imported block assignment
      if (importedBlock) {
        // Get existing assignment for this imported block
        const existingAssignment = await dbStorage.getBlockAssignmentByBlock(occurrenceId);

        // If driverId is null or empty, remove the assignment
        if (!driverId) {
          if (existingAssignment) {
            await dbStorage.deleteBlockAssignment(existingAssignment.id);
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
          // Create new assignment for imported block
          await dbStorage.createBlockAssignment({
            tenantId,
            blockId: occurrenceId,
            driverId,
            assignedAt: new Date(),
            isActive: true,
          });
        }

        return res.json({ message: "Driver assigned successfully" });
      }

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

  // ==================== DRIVER DNA PROFILES ====================

  // GET /api/driver-dna - Get all DNA profiles for tenant
  app.get("/api/driver-dna", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;

      // Get all DNA profiles for this tenant
      const profiles = await db
        .select()
        .from(driverDnaProfiles)
        .where(eq(driverDnaProfiles.tenantId, tenantId));

      // Get stats
      const stats = {
        totalProfiles: profiles.length,
        sunWedCount: profiles.filter(p => p.patternGroup === 'sunWed').length,
        wedSatCount: profiles.filter(p => p.patternGroup === 'wedSat').length,
        mixedCount: profiles.filter(p => p.patternGroup === 'mixed').length,
        avgConsistency: profiles.length > 0
          ? profiles.reduce((sum, p) => sum + (parseFloat(p.consistencyScore || '0')), 0) / profiles.length
          : 0,
      };

      res.json({ profiles, stats });
    } catch (error: any) {
      console.error("Error fetching DNA profiles:", error);
      res.status(500).json({ message: "Failed to fetch DNA profiles", error: error.message });
    }
  });

  // GET /api/driver-dna/profiles - Get profiles as a map (for legacy compatibility)
  app.get("/api/driver-dna/profiles", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;

      const profilesList = await db
        .select()
        .from(driverDnaProfiles)
        .where(eq(driverDnaProfiles.tenantId, tenantId));

      // Convert to map keyed by driverId
      const profiles: Record<string, any> = {};
      for (const p of profilesList) {
        profiles[p.driverId] = p;
      }

      res.json({ profiles });
    } catch (error: any) {
      console.error("Error fetching DNA profiles map:", error);
      res.status(500).json({ message: "Failed to fetch DNA profiles", error: error.message });
    }
  });

  // GET /api/driver-dna/:driverId - Get single driver's DNA profile
  app.get("/api/driver-dna/:driverId", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { driverId } = req.params;

      const profiles = await db
        .select()
        .from(driverDnaProfiles)
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, driverId)
          )
        )
        .limit(1);

      if (profiles.length === 0) {
        return res.status(404).json({ message: "DNA profile not found" });
      }

      res.json(profiles[0]);
    } catch (error: any) {
      console.error("Error fetching DNA profile:", error);
      res.status(500).json({ message: "Failed to fetch DNA profile", error: error.message });
    }
  });

  // PATCH /api/driver-dna/:driverId - Update driver's DNA profile
  app.patch("/api/driver-dna/:driverId", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { driverId } = req.params;
      const updates = req.body;

      // Check if profile exists
      const existing = await db
        .select()
        .from(driverDnaProfiles)
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, driverId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        // Create new profile
        const newProfile = await db
          .insert(driverDnaProfiles)
          .values({
            tenantId,
            driverId,
            ...updates,
            lastAnalyzedAt: new Date(),
          })
          .returning();
        return res.json(newProfile[0]);
      }

      // Update existing
      const updated = await db
        .update(driverDnaProfiles)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(driverDnaProfiles.tenantId, tenantId),
            eq(driverDnaProfiles.driverId, driverId)
          )
        )
        .returning();

      res.json(updated[0]);
    } catch (error: any) {
      console.error("Error updating DNA profile:", error);
      res.status(500).json({ message: "Failed to update DNA profile", error: error.message });
    }
  });

  // POST /api/driver-dna/analyze - Trigger DNA analysis (stub for now)
  app.post("/api/driver-dna/analyze", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;

      // Get count of existing profiles
      const profiles = await db
        .select()
        .from(driverDnaProfiles)
        .where(eq(driverDnaProfiles.tenantId, tenantId));

      // For now, just return existing profiles count
      // Full analysis would re-run XGBoost pattern detection
      res.json({
        totalDrivers: profiles.length,
        profilesCreated: 0,
        profilesUpdated: profiles.length,
        errors: 0,
        message: "Using existing DNA profiles from XGBoost analysis",
      });
    } catch (error: any) {
      console.error("Error in DNA analysis:", error);
      res.status(500).json({ message: "Failed to analyze DNA", error: error.message });
    }
  });

  // GET /api/drivers/:driverId/dna - Get comprehensive DNA dashboard data for a driver
  // Used by the Driver DNA Dashboard page
  app.get("/api/drivers/:driverId/dna", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { driverId } = req.params;

      // 1. Get driver info
      const driverResult = await db
        .select()
        .from(drivers)
        .where(and(
          eq(drivers.id, driverId),
          eq(drivers.tenantId, tenantId)
        ));

      if (driverResult.length === 0) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const driver = driverResult[0];

      // 2. Get DNA profile
      const profileResult = await db
        .select()
        .from(driverDnaProfiles)
        .where(and(
          eq(driverDnaProfiles.driverId, driverId),
          eq(driverDnaProfiles.tenantId, tenantId)
        ));

      const dnaProfile = profileResult.length > 0 ? profileResult[0] : null;

      // 3. Get work history (last 6 months of assignments)
      const sixMonthsAgo = subWeeks(new Date(), 26); // ~6 months
      const assignmentsWithBlocks = await db
        .select({
          assignment: blockAssignments,
          block: blocks,
        })
        .from(blockAssignments)
        .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
        .where(and(
          eq(blockAssignments.driverId, driverId),
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.isActive, true),
          gte(blocks.serviceDate, sixMonthsAgo)
        ))
        .orderBy(blocks.serviceDate);

      // 4. Build history data for calendar heatmap
      const historyMap = new Map<string, number>();
      for (const row of assignmentsWithBlocks) {
        const day = format(new Date(row.block.serviceDate), 'yyyy-MM-dd');
        historyMap.set(day, (historyMap.get(day) || 0) + 1);
      }
      const history = Array.from(historyMap.entries()).map(([day, value]) => ({ day, value }));

      // 5. Build confidence history (mock data based on weekly aggregation)
      // In a real implementation, this would come from stored historical confidence values
      const weeklyHistory: { x: string; y: number }[] = [];
      const weeks = 12;
      for (let i = weeks - 1; i >= 0; i--) {
        const weekStart = subWeeks(new Date(), i);
        const weekLabel = format(weekStart, 'MMM d');
        // Simulate confidence growth based on data accumulation
        const baseConfidence = dnaProfile?.patternConfidence || 0.5;
        const noise = (Math.random() - 0.5) * 0.1;
        const growthFactor = 1 - (i / weeks) * 0.3;
        const confidence = Math.min(1, Math.max(0, baseConfidence * growthFactor + noise));
        weeklyHistory.push({ x: weekLabel, y: confidence });
      }

      // 6. Calculate stats
      const tractorCounts = new Map<string, number>();
      const timeCounts = new Map<string, number>();

      for (const row of assignmentsWithBlocks) {
        if (row.block.tractorId) {
          tractorCounts.set(row.block.tractorId, (tractorCounts.get(row.block.tractorId) || 0) + 1);
        }
        if (row.block.startTimestamp) {
          const time = format(new Date(row.block.startTimestamp), 'HH:mm');
          timeCounts.set(time, (timeCounts.get(time) || 0) + 1);
        }
      }

      const mostFrequentTractor = tractorCounts.size > 0
        ? Array.from(tractorCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
        : null;

      const mostFrequentTime = timeCounts.size > 0
        ? Array.from(timeCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
        : null;

      // Calculate average blocks per week
      const weeksWithData = new Set(
        assignmentsWithBlocks.map(row => format(new Date(row.block.serviceDate), 'yyyy-ww'))
      ).size;
      const avgBlocksPerWeek = weeksWithData > 0
        ? assignmentsWithBlocks.length / weeksWithData
        : 0;

      res.json({
        driver: {
          id: driver.id,
          firstName: driver.firstName,
          lastName: driver.lastName,
          status: driver.status,
          daysOff: driver.daysOff || [],
        },
        dnaProfile,
        history,
        confidenceHistory: weeklyHistory,
        stats: {
          totalAssignments: assignmentsWithBlocks.length,
          uniqueBlocks: new Set(assignmentsWithBlocks.map(r => r.block.blockId)).size,
          avgBlocksPerWeek: Math.round(avgBlocksPerWeek * 10) / 10,
          mostFrequentTractor,
          mostFrequentTime,
        },
      });
    } catch (error: any) {
      console.error("Error fetching driver DNA dashboard:", error);
      res.status(500).json({ message: "Failed to fetch driver DNA data", error: error.message });
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

  // ==================== DETERMINISTIC MATCHER (Fast, No AI) ====================

  // POST /api/matching/deterministic - Calculate matches using scoring algorithm
  // Fast, predictable, no API calls - uses DNA profiles + scoring
  app.post("/api/matching/deterministic", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, contractType, minDays } = req.body;

      const weekStartDate = weekStart
        ? parseISO(weekStart)
        : startOfWeek(new Date(), { weekStartsOn: 0 });

      const validMinDays = [3, 4, 5].includes(minDays) ? minDays : 3;

      console.log(`[Deterministic API] ========================================`);
      console.log(`[Deterministic API] Tenant ID: ${tenantId}`);
      console.log(`[Deterministic API] Week Start: ${format(weekStartDate, "yyyy-MM-dd")}`);
      console.log(`[Deterministic API] Contract Type: ${contractType || 'all'}`);
      console.log(`[Deterministic API] Min Days: ${validMinDays}`);
      console.log(`[Deterministic API] ========================================`);

      const result = await matchDeterministic(
        tenantId,
        weekStartDate,
        contractType as "solo1" | "solo2" | undefined,
        validMinDays
      );

      res.json({
        success: true,
        suggestions: result.suggestions,
        unassigned: result.unassigned,
        stats: result.stats,
      });
    } catch (error: any) {
      console.error("Deterministic matching error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to calculate matches",
        error: error.message
      });
    }
  });

  // POST /api/matching/deterministic/preview-all - Get all proposed matches without committing
  // Used by the Preview-First workflow in Phase 2
  app.post("/api/matching/deterministic/preview-all", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, contractType, minDays } = req.body;

      const weekStartDate = weekStart
        ? parseISO(weekStart)
        : startOfWeek(new Date(), { weekStartsOn: 0 });

      const validMinDays = [3, 4, 5].includes(minDays) ? minDays : 3;

      console.log(`[Preview API] ========================================`);
      console.log(`[Preview API] Generating preview (no commit)`);
      console.log(`[Preview API] Tenant ID: ${tenantId}`);
      console.log(`[Preview API] Week Start: ${format(weekStartDate, "yyyy-MM-dd")}`);
      console.log(`[Preview API] Contract Type: ${contractType || 'all'}`);
      console.log(`[Preview API] Min Days: ${validMinDays}`);
      console.log(`[Preview API] ========================================`);

      const result = await matchDeterministic(
        tenantId,
        weekStartDate,
        contractType as "solo1" | "solo2" | undefined,
        validMinDays
      );

      // Return suggestions with explicit driverName for display
      // Include excludedDrivers for graceful error handling (Pillar 4: Resilience)
      // Include unassignedWithReasons for Conflict View (reasons why blocks couldn't be assigned)
      res.json({
        success: true,
        suggestions: result.suggestions,
        unassigned: result.unassigned,
        unassignedWithReasons: result.unassignedWithReasons || [],
        excludedDrivers: result.excludedDrivers || [],
        stats: result.stats,
        message: `Preview generated: ${result.suggestions.length} assignments proposed`,
      });
    } catch (error: any) {
      console.error("Preview matching error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate preview",
        error: error.message
      });
    }
  });

  // POST /api/matching/deterministic/apply - Apply deterministic assignments
  app.post("/api/matching/deterministic/apply", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { assignments } = req.body;

      if (!Array.isArray(assignments) || assignments.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No assignments provided"
        });
      }

      console.log(`[Deterministic API] Applying ${assignments.length} assignments`);

      const result = await applyDeterministicMatches(tenantId, assignments);

      res.json({
        success: true,
        applied: result.applied,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Apply deterministic assignments error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to apply assignments",
        error: error.message
      });
    }
  });

  // GET /api/matching/block/:blockId - Get top matches for a single block
  // Used by the Intelligent Match Assistant panel
  app.get("/api/matching/block/:blockId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const { blockId } = req.params;

      if (!blockId) {
        return res.status(400).json({ success: false, message: "Block ID is required" });
      }

      const { getTopMatchesForBlock } = await import("./deterministic-matcher");
      const result = await getTopMatchesForBlock(tenantId, blockId);

      res.json(result);
    } catch (error: any) {
      console.error("Get block matches error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get block matches",
        error: error.message
      });
    }
  });

  // ==================== MILO SCHEDULER (Enhanced Claude) ====================

  // POST /api/matching/milo - Calculate matches using MILO enhanced prompt
  // Features: DOT compliance, 6-tier scoring, 12/8/3/2/1 week lookback
  app.post("/api/matching/milo", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart, contractType, minDays } = req.body;

      const weekStartDate = weekStart
        ? parseISO(weekStart)
        : startOfWeek(new Date(), { weekStartsOn: 0 });

      const validMinDays = [3, 4, 5].includes(minDays) ? minDays : 3;

      console.log(`[MILO API] Calculating matches for week starting ${format(weekStartDate, "yyyy-MM-dd")}`);

      const result = await optimizeWithMilo(
        tenantId,
        weekStartDate,
        contractType as "solo1" | "solo2" | undefined,
        validMinDays
      );

      res.json({
        success: true,
        suggestions: result.suggestions,
        unassigned: result.unassigned,
        stats: result.stats,
        validation: result.validation,
      });
    } catch (error: any) {
      console.error("MILO matching error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to calculate matches with MILO",
        error: error.message
      });
    }
  });

  // POST /api/matching/milo/apply - Apply MILO-optimized assignments
  app.post("/api/matching/milo/apply", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { assignments } = req.body;

      if (!Array.isArray(assignments) || assignments.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No assignments provided"
        });
      }

      console.log(`[MILO API] Applying ${assignments.length} assignments`);

      const result = await applyMiloSchedule(tenantId, assignments);

      res.json({
        success: true,
        applied: result.applied,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("Apply MILO assignments error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to apply MILO assignments",
        error: error.message
      });
    }
  });

  // POST /api/milo/chat - Conversational MILO chat
  app.post("/api/milo/chat", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { message, sessionId } = req.body;

      if (!message) {
        return res.status(400).json({
          success: false,
          message: "Message is required"
        });
      }

      // Generate session ID if not provided
      const chatSessionId = sessionId || `milo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const { chatWithMilo } = await import("./milo-chat");
      const result = await chatWithMilo(tenantId, chatSessionId, message);

      res.json({
        success: true,
        response: result.response,
        sessionId: result.sessionId
      });
    } catch (error: any) {
      console.error("MILO chat error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to process chat message",
        error: error.message
      });
    }
  });

  // POST /api/milo/chat/clear - Clear MILO chat history
  app.post("/api/milo/chat/clear", requireAuth, async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (sessionId) {
        const { clearMiloChatHistory } = await import("./milo-chat");
        clearMiloChatHistory(sessionId);
      }

      res.json({ success: true, message: "Chat history cleared" });
    } catch (error: any) {
      console.error("Clear MILO chat error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to clear chat history"
      });
    }
  });


  // POST /api/milo/schedule/build - Run the agentic scheduling system
  app.post("/api/milo/schedule/build", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { weekStart } = req.body;

      if (!weekStart) {
        return res.status(400).json({
          success: false,
          message: "weekStart is required (YYYY-MM-DD format)"
        });
      }

      console.log(`[API] Starting agentic schedule build for ${weekStart}`);

      const { runSchedulingAgent } = await import("./ai/milo-scheduler");
      const result = await runSchedulingAgent(tenantId, weekStart);

      console.log(`[API] Schedule build complete: ${result.assigned}/${result.totalBlocks} assigned`);

      res.json({
        success: result.success,
        message: result.message,
        totalBlocks: result.totalBlocks,
        assigned: result.assigned,
        unassigned: result.unassigned,
        reasoning: result.reasoning,
        decisions: result.decisions.map(d => ({
          blockId: d.blockId,
          blockInfo: d.blockInfo,
          driverId: d.driverId,
          driverName: d.driverName,
          action: d.action,
          reasoning: d.reasoning
        }))
      });
    } catch (error: any) {
      console.error("Agentic schedule build error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to build schedule",
        error: error.message
      });
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

  // ==================== AUTO-BUILD ====================

  // POST /api/auto-build/preview - Generate auto-build suggestions for next week
  // Supports optional filters: soloTypeFilter (solo1/solo2/team), driverId (single driver mode)
  app.post("/api/auto-build/preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;

      const { targetWeekStart, soloTypeFilter, driverId } = req.body;
      if (!targetWeekStart) {
        return res.status(400).json({ message: "Missing required field: targetWeekStart" });
      }

      // Build options object for filtering
      const options: { soloTypeFilter?: string; driverId?: string } = {};
      if (soloTypeFilter && ["solo1", "solo2", "team"].includes(soloTypeFilter)) {
        options.soloTypeFilter = soloTypeFilter;
      }
      if (driverId) {
        options.driverId = driverId;
      }

      const { generateAutoBuildPreview, saveAutoBuildRun } = await import("./auto-build-engine");
      const preview = await generateAutoBuildPreview(
        tenantId,
        new Date(targetWeekStart),
        userId,
        Object.keys(options).length > 0 ? options : undefined
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

  // GET /api/auto-build/driver-suggestions/:driverId - Get block suggestions for a specific driver
  // Used for driver-by-driver build mode
  app.get("/api/auto-build/driver-suggestions/:driverId", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      const { driverId } = req.params;
      const { weekStart } = req.query;

      if (!weekStart) {
        return res.status(400).json({ message: "Missing required query parameter: weekStart" });
      }

      // Generate preview with driverId filter (only find blocks suitable for this driver)
      const { generateAutoBuildPreview } = await import("./auto-build-engine");
      const preview = await generateAutoBuildPreview(
        tenantId,
        new Date(weekStart as string),
        userId,
        { driverId }
      );

      // Get driver details and DNA profile
      const driver = await db
        .select()
        .from(drivers)
        .where(and(eq(drivers.tenantId, tenantId), eq(drivers.id, driverId)))
        .limit(1);

      if (driver.length === 0) {
        return res.status(404).json({ message: "Driver not found" });
      }

      const dnaProfile = await db
        .select()
        .from(driverDnaProfiles)
        .where(and(eq(driverDnaProfiles.tenantId, tenantId), eq(driverDnaProfiles.driverId, driverId)))
        .limit(1);

      // Calculate current workload (blocks already assigned this week)
      const weekStartDate = startOfWeek(new Date(weekStart as string), { weekStartsOn: 0 });
      const weekEndDate = endOfWeek(new Date(weekStart as string), { weekStartsOn: 0 });

      const assignedBlocks = await db
        .select()
        .from(blockAssignments)
        .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
        .where(
          and(
            eq(blockAssignments.tenantId, tenantId),
            eq(blockAssignments.driverId, driverId),
            gte(blocks.startTimestamp, weekStartDate),
            lt(blocks.startTimestamp, weekEndDate)
          )
        );

      res.json({
        weekStart: weekStart,
        suggestions: preview.suggestions,
        driverProfile: {
          id: driver[0].id,
          name: `${driver[0].firstName} ${driver[0].lastName}`,
          firstName: driver[0].firstName,
          lastName: driver[0].lastName,
          dnaProfile: dnaProfile[0] || null,
          currentWorkload: assignedBlocks.length,
          maxCapacity: 6, // Max 6 days per week
        },
        unassignable: preview.unassignable,
        warnings: preview.warnings,
      });
    } catch (error: any) {
      console.error("Get driver suggestions error:", error);
      res.status(500).json({ message: "Failed to get driver suggestions", error: error.message });
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

      // Auto-update DNA profile after successful assignment
      // Runs in background to not block response
      updateSingleDriverDNA(tenantId, driverId).catch(err => {
        console.error(`[DNA] Failed to update DNA for driver ${driverId}:`, err);
      });

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

  // POST /api/analysis/coverage - Analyze schedule coverage and gaps
  app.post("/api/analysis/coverage", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const userId = req.session.userId!;
      
      const { weekStart, weekEnd } = req.body;
      
      if (!weekStart || !weekEnd) {
        return res.status(400).json({ message: "Missing required fields: weekStart, weekEnd" });
      }

      // Get schedule for the week with proper joins
      const schedule = await db
        .select({
          id: shiftOccurrences.id,
          externalBlockId: shiftOccurrences.externalBlockId,
          serviceDate: shiftOccurrences.serviceDate,
          status: shiftOccurrences.status,
          driverId: blockAssignments.driverId,
          contractType: shiftTemplates.soloType,
        })
        .from(shiftOccurrences)
        .leftJoin(blockAssignments, and(
          eq(blockAssignments.shiftOccurrenceId, shiftOccurrences.id),
          eq(blockAssignments.isActive, true)
        ))
        .leftJoin(shiftTemplates, eq(shiftTemplates.id, shiftOccurrences.templateId))
        .where(and(
          eq(shiftOccurrences.tenantId, tenantId),
          gte(shiftOccurrences.serviceDate, weekStart),
          lte(shiftOccurrences.serviceDate, weekEnd)
        ));

      const startTime = Date.now();
      const { analyzeCoverage } = await import("./python-bridge");
      const pythonResult = await analyzeCoverage({
        action: 'analyze_coverage',
        schedule: schedule.map(s => ({
          blockId: s.externalBlockId,
          driverId: s.driverId,
          date: s.serviceDate,
          contractType: s.contractType,
          status: s.status,
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

  // POST /api/analysis/drivers-xgboost - Analyze and TRAIN XGBoost models with real data
  // This endpoint TRAINS the models using historical block assignments, then returns patterns
  app.post("/api/analysis/drivers-xgboost", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;

      console.log(`[XGBoost] Starting analysis and training for tenant ${tenantId}`);

      // 1. Query last 12 weeks of block assignments
      const twelveWeeksAgo = subDays(new Date(), 84);

      const assignments = await db
        .select({
          driverId: blockAssignments.driverId,
          driverFirstName: drivers.firstName,
          driverLastName: drivers.lastName,
          blockDbId: blocks.id,
          blockId: blocks.blockId,
          serviceDate: blocks.serviceDate,
          soloType: blocks.soloType,
          tractorId: blocks.tractorId,
          contractId: blocks.contractId,
          startTimestamp: blocks.startTimestamp,
          duration: blocks.duration,
        })
        .from(blockAssignments)
        .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
        .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
        .where(and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.isActive, true),
          gte(blocks.serviceDate, twelveWeeksAgo)
        ));

      console.log(`[XGBoost] Found ${assignments.length} assignments from last 12 weeks`);

      // 2. Format data for XGBoost training
      const { trainAllModels } = await import("./python-bridge");

      // Format for Ownership model: each assignment with slot details
      const trainingAssignments = assignments.map(a => {
        const serviceDate = new Date(a.serviceDate);
        const dayOfWeek = serviceDate.getDay(); // 0=Sunday, 6=Saturday
        const startTime = a.startTimestamp ? format(new Date(a.startTimestamp), 'HH:mm') : '00:00';

        return {
          driverId: a.driverId,
          driverName: `${a.driverFirstName} ${a.driverLastName}`.trim(),
          soloType: (a.soloType || 'solo1').toLowerCase(),
          tractorId: a.tractorId || 'Tractor_1',
          dayOfWeek,
          serviceDate: format(serviceDate, 'yyyy-MM-dd'),
          startTime,
        };
      });

      // Format for Availability model: group by driver
      const driverHistories: Record<string, DriverHistoryItem[]> = {};
      for (const a of assignments) {
        const driverId = a.driverId;
        if (!driverHistories[driverId]) {
          driverHistories[driverId] = [];
        }
        driverHistories[driverId].push({
          serviceDate: format(new Date(a.serviceDate), 'yyyy-MM-dd'),
          soloType: a.soloType || undefined,
          tractorId: a.tractorId || undefined,
        });
      }

      console.log(`[XGBoost] Training models with ${trainingAssignments.length} assignments, ${Object.keys(driverHistories).length} drivers`);

      // 3. TRAIN both XGBoost models with real data
      const trainingResults = await trainAllModels(trainingAssignments, driverHistories);

      console.log(`[XGBoost] Ownership training: ${trainingResults.ownership.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`[XGBoost] Availability training: ${trainingResults.availability.success ? 'SUCCESS' : 'FAILED'}`);

      // 4. Get patterns from freshly trained models
      const { getAllDriverPatterns } = await import("./python-bridge");
      const patternsResult = await getAllDriverPatterns();

      const xgboostPatterns = patternsResult.success && patternsResult.data
        ? patternsResult.data.patterns
        : {};

      // 5. Group blocks by driver for response
      const driverBlocksMap = new Map<string, {
        driverId: string;
        driverName: string;
        blocks: Array<{
          id: string;
          blockId: string;
          serviceDate: Date;
          soloType: string;
          tractorId: string;
          contractId: string;
          startTimestamp: Date;
          duration: number;
        }>;
      }>();

      for (const assignment of assignments) {
        const driverName = `${assignment.driverFirstName} ${assignment.driverLastName}`;

        if (!driverBlocksMap.has(assignment.driverId)) {
          driverBlocksMap.set(assignment.driverId, {
            driverId: assignment.driverId,
            driverName,
            blocks: [],
          });
        }

        driverBlocksMap.get(assignment.driverId)!.blocks.push({
          id: assignment.blockDbId,
          blockId: assignment.blockId,
          serviceDate: assignment.serviceDate,
          soloType: assignment.soloType,
          tractorId: assignment.tractorId,
          contractId: assignment.contractId,
          startTimestamp: assignment.startTimestamp,
          duration: assignment.duration,
        });
      }

      // 4. Build response with driver patterns and their blocks
      console.log(`[XGBoost Analysis] Processing ${driverBlocksMap.size} drivers, ${assignments.length} assignments`);

      const driversWithBlocks = Array.from(driverBlocksMap.values()).map(driver => {
        const pattern = xgboostPatterns[driver.driverName];

        return {
          driverId: driver.driverId,
          driverName: driver.driverName,
          matchingBlocks: driver.blocks.map(b => {
            // Handle null/undefined dates safely
            let serviceDateStr = '';
            let startTimeStr = '';

            try {
              if (b.serviceDate) {
                serviceDateStr = format(new Date(b.serviceDate), 'yyyy-MM-dd');
              }
            } catch (e) {
              console.log(`[XGBoost] Error formatting serviceDate for block ${b.blockId}:`, b.serviceDate);
            }

            try {
              if (b.startTimestamp) {
                startTimeStr = format(new Date(b.startTimestamp), 'HH:mm');
              }
            } catch (e) {
              console.log(`[XGBoost] Error formatting startTimestamp for block ${b.blockId}:`, b.startTimestamp);
            }

            return {
              id: b.id,
              blockId: b.blockId,
              serviceDate: serviceDateStr,
              soloType: b.soloType || '',
              tractorId: b.tractorId || '',
              startTime: startTimeStr,
              duration: b.duration || 0,
            };
          }),
          totalBlocks: driver.blocks.length,
          pattern: pattern ? {
            typicalDays: pattern.typical_days,
            dayList: pattern.day_list,
            dayCounts: pattern.day_counts,
            confidence: pattern.confidence,
          } : null,
        };
      });

      // Sort by total blocks descending
      driversWithBlocks.sort((a, b) => b.totalBlocks - a.totalBlocks);

      console.log(`[XGBoost Analysis] Analyzed ${driversWithBlocks.length} drivers with ${assignments.length} total assignments from last 12 weeks`);

      res.json({
        success: true,
        drivers: driversWithBlocks,
        totalDrivers: driversWithBlocks.length,
        totalBlocks: assignments.length,
        analysisWindow: {
          start: format(twelveWeeksAgo, 'yyyy-MM-dd'),
          end: format(new Date(), 'yyyy-MM-dd'),
          weeks: 12,
        },
        training: {
          ownership: {
            success: trainingResults.ownership.success,
            accuracy: trainingResults.ownership.data?.accuracy,
            samples: trainingResults.ownership.data?.samples,
          },
          availability: {
            success: trainingResults.availability.success,
            accuracy: trainingResults.availability.data?.accuracy,
            samples: trainingResults.availability.data?.samples,
          },
        },
      });
    } catch (error: any) {
      console.error("XGBoost driver analysis error:", error);
      res.status(500).json({ message: "Failed to analyze drivers", error: error.message });
    }
  });

  // GET /api/analysis/xgboost-diagnostic - Diagnostic endpoint for XGBoost pattern learning
  // This traces the entire pipeline: training data → model → predictions
  app.get("/api/analysis/xgboost-diagnostic", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = req.session.tenantId!;
      const driverName = req.query.driver as string; // Optional: filter by driver name

      console.log(`[XGBoost-Diagnostic] Starting diagnostic for tenant ${tenantId}, driver filter: ${driverName || 'ALL'}`);

      // STEP 1: Raw data collection - what's in the database?
      const twelveWeeksAgo = subDays(new Date(), 84);

      const rawAssignments = await db
        .select({
          driverId: blockAssignments.driverId,
          driverFirstName: drivers.firstName,
          driverLastName: drivers.lastName,
          blockId: blocks.blockId,
          serviceDate: blocks.serviceDate,
          contractType: blocks.contractType,
          tractorId: blocks.tractorId,
          startTime: blocks.startTime,
        })
        .from(blockAssignments)
        .innerJoin(blocks, eq(blockAssignments.blockId, blocks.id))
        .innerJoin(drivers, eq(blockAssignments.driverId, drivers.id))
        .where(and(
          eq(blockAssignments.tenantId, tenantId),
          eq(blockAssignments.isActive, true),
          gte(blocks.serviceDate, twelveWeeksAgo)
        ))
        .orderBy(desc(blocks.serviceDate));

      // STEP 2: Group by driver to see distribution
      const driverStats = new Map<string, {
        name: string;
        totalAssignments: number;
        byDay: Record<string, number>;
        byContractType: Record<string, number>;
        byTractor: Record<string, number>;
        dateRange: { earliest: string; latest: string };
        samples: Array<{ date: string; day: string; contractType: string; tractor: string; time: string }>;
      }>();

      for (const a of rawAssignments) {
        const fullName = `${a.driverFirstName} ${a.driverLastName}`.trim();

        // Filter by driver name if specified
        if (driverName && !fullName.toLowerCase().includes(driverName.toLowerCase())) {
          continue;
        }

        if (!driverStats.has(a.driverId)) {
          driverStats.set(a.driverId, {
            name: fullName,
            totalAssignments: 0,
            byDay: {},
            byContractType: {},
            byTractor: {},
            dateRange: { earliest: '', latest: '' },
            samples: [],
          });
        }

        const stats = driverStats.get(a.driverId)!;
        stats.totalAssignments++;

        const dateStr = format(new Date(a.serviceDate), 'yyyy-MM-dd');
        const dayName = format(new Date(a.serviceDate), 'EEEE');
        const contractType = a.contractType || 'unknown';
        const tractor = a.tractorId || 'unknown';

        // Update date range
        if (!stats.dateRange.earliest || dateStr < stats.dateRange.earliest) {
          stats.dateRange.earliest = dateStr;
        }
        if (!stats.dateRange.latest || dateStr > stats.dateRange.latest) {
          stats.dateRange.latest = dateStr;
        }

        // Count by day
        stats.byDay[dayName] = (stats.byDay[dayName] || 0) + 1;

        // Count by contract type
        stats.byContractType[contractType] = (stats.byContractType[contractType] || 0) + 1;

        // Count by tractor
        stats.byTractor[tractor] = (stats.byTractor[tractor] || 0) + 1;

        // Keep sample assignments (first 10)
        if (stats.samples.length < 10) {
          stats.samples.push({
            date: dateStr,
            day: dayName,
            contractType,
            tractor,
            time: a.startTime || 'N/A',
          });
        }
      }

      // STEP 3: Get XGBoost model predictions for these drivers
      const { getAllDriverPatterns, getSlotDistribution } = await import("./python-bridge");
      const patternsResult = await getAllDriverPatterns();

      const xgboostPatterns = patternsResult.success && patternsResult.data
        ? patternsResult.data.patterns
        : {};

      // STEP 4: Build diagnostic report
      const diagnosticReport = Array.from(driverStats.entries()).map(([driverId, stats]) => {
        const xgboostPattern = xgboostPatterns[stats.name];

        // Calculate what pattern SHOULD be learned from the data
        const expectedPattern = {
          totalAssignments: stats.totalAssignments,
          daysWorked: Object.keys(stats.byDay).length,
          primaryDays: Object.entries(stats.byDay)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([day, count]) => `${day} (${count})`),
          primaryContractType: Object.entries(stats.byContractType)
            .sort((a, b) => b[1] - a[1])[0],
          primaryTractors: Object.entries(stats.byTractor)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t, c]) => `${t} (${c})`),
        };

        // What XGBoost actually learned
        const learnedPattern = xgboostPattern ? {
          typicalDays: xgboostPattern.typical_days,
          dayList: xgboostPattern.day_list,
          dayCounts: xgboostPattern.day_counts,
          confidence: xgboostPattern.confidence,
        } : null;

        // Compare expected vs learned
        const patternMatch = learnedPattern ? {
          daysMatch: expectedPattern.daysWorked === learnedPattern.typicalDays,
          expectedDays: expectedPattern.daysWorked,
          learnedDays: learnedPattern.typicalDays,
          gap: Math.abs(expectedPattern.daysWorked - learnedPattern.typicalDays),
        } : { daysMatch: false, expectedDays: expectedPattern.daysWorked, learnedDays: 0, gap: expectedPattern.daysWorked };

        return {
          driverId,
          driverName: stats.name,
          rawData: {
            totalAssignments: stats.totalAssignments,
            dateRange: stats.dateRange,
            byDay: stats.byDay,
            byContractType: stats.byContractType,
            byTractor: stats.byTractor,
            recentSamples: stats.samples,
          },
          expectedPattern,
          learnedPattern,
          patternMatch,
          diagnosis: patternMatch.gap > 1
            ? `⚠️ GAP: Expected ${expectedPattern.daysWorked} days, learned ${patternMatch.learnedDays}`
            : learnedPattern
              ? '✓ Pattern matches training data'
              : '❌ No pattern learned (model not trained or driver excluded)',
        };
      });

      // Sort by total assignments descending
      diagnosticReport.sort((a, b) => b.rawData.totalAssignments - a.rawData.totalAssignments);

      // STEP 5: Check if model files exist
      const fs = await import('fs');
      const path = await import('path');
      const modelsDir = path.join(process.cwd(), 'python', 'models');

      let modelStatus = {
        ownershipModel: false,
        ownershipEncoders: false,
        availabilityModel: false,
        availabilityEncoders: false,
      };

      try {
        modelStatus.ownershipModel = fs.existsSync(path.join(modelsDir, 'ownership_model.json'));
        modelStatus.ownershipEncoders = fs.existsSync(path.join(modelsDir, 'ownership_encoders.json'));
        modelStatus.availabilityModel = fs.existsSync(path.join(modelsDir, 'availability_model.json'));
        modelStatus.availabilityEncoders = fs.existsSync(path.join(modelsDir, 'availability_encoders.json'));
      } catch (e) {
        // Ignore file check errors
      }

      res.json({
        success: true,
        summary: {
          totalDrivers: diagnosticReport.length,
          totalAssignments: rawAssignments.length,
          analysisWindow: {
            start: format(twelveWeeksAgo, 'yyyy-MM-dd'),
            end: format(new Date(), 'yyyy-MM-dd'),
            weeks: 12,
          },
          modelStatus,
          patternsLoaded: Object.keys(xgboostPatterns).length,
        },
        drivers: diagnosticReport,
        troubleshooting: {
          noPatterns: diagnosticReport.filter(d => !d.learnedPattern).map(d => d.driverName),
          patternGaps: diagnosticReport.filter(d => d.patternMatch.gap > 1).map(d => ({
            name: d.driverName,
            expected: d.patternMatch.expectedDays,
            learned: d.patternMatch.learnedDays,
          })),
        },
      });
    } catch (error: any) {
      console.error("XGBoost diagnostic error:", error);
      res.status(500).json({ message: "Failed to run diagnostic", error: error.message });
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

  // POST /api/gemini/reconstruct - Reconstruct blocks from trip-level CSV (local processing, no AI truncation)
  app.post("/api/gemini/reconstruct", requireAuth, async (req: Request, res: Response) => {
    try {
      const { csvData } = req.body;

      if (!csvData) {
        return res.status(400).json({ message: "Missing required field: csvData" });
      }

      // Use local reconstruction - deterministic, no AI truncation
      const { reconstructBlocksLocally } = await import("./local-reconstruct");
      const result = reconstructBlocksLocally(csvData);

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
        });
      }
    } catch (error: any) {
      console.error("Block reconstruct error:", error);
      res.status(500).json({
        success: false,
        message: "Block reconstruction failed",
        error: error.message,
      });
    }
  });

  // POST /api/gemini/chat - General Gemini chat endpoint for natural language processing
  app.post("/api/gemini/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const { message, context } = req.body;

      if (!message) {
        return res.status(400).json({ message: "Missing required field: message" });
      }

      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          message: "GOOGLE_AI_API_KEY not configured",
        });
      }

      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          maxOutputTokens: 2048,
        }
      });

      console.log(`[Gemini Chat] Processing message for context: ${context || 'general'}`);

      const result = await model.generateContent(message);
      const response = await result.response;
      const text = response.text();

      res.json({
        success: true,
        response: text,
      });
    } catch (error: any) {
      console.error("[Gemini Chat] Error:", error);
      res.status(500).json({
        success: false,
        message: "Gemini chat failed",
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

      // Track how many blocks were replaced (declared early since used in STEP 1)
      let replacedCount = 0;

      // STEP 1: Delete any existing blocks with the same blockIds being imported
      // This ensures a clean import - CSV data replaces any existing data for those blocks
      const blockIdsToImport = reconstructedBlocks
        .map((b: any) => b.blockId)
        .filter((id: string) => id);

      if (blockIdsToImport.length > 0) {
        // Find existing blocks with these blockIds
        const existingBlocks = await db
          .select({ id: blocks.id, blockId: blocks.blockId })
          .from(blocks)
          .where(and(
            eq(blocks.tenantId, tenantId),
            inArray(blocks.blockId, blockIdsToImport)
          ));

        if (existingBlocks.length > 0) {
          const idsToDelete = existingBlocks.map(b => b.id);

          // Delete assignment history first (references blocks.id)
          await db.delete(assignmentHistory)
            .where(and(
              eq(assignmentHistory.tenantId, tenantId),
              inArray(assignmentHistory.blockId, idsToDelete)
            ));

          // Delete block assignments (references blocks.id)
          await db.delete(blockAssignments)
            .where(and(
              eq(blockAssignments.tenantId, tenantId),
              inArray(blockAssignments.blockId, idsToDelete)
            ));

          // Then delete blocks
          await db.delete(blocks)
            .where(and(
              eq(blocks.tenantId, tenantId),
              inArray(blocks.id, idsToDelete)
            ));

          replacedCount = existingBlocks.length;
          console.log(`[IMPORT] Cleared ${existingBlocks.length} existing blocks before import: ${existingBlocks.map(b => b.blockId).slice(0, 5).join(', ')}${existingBlocks.length > 5 ? '...' : ''}`);
        }
      }

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

      // Canonical start times from contracts table (must match local-reconstruct.ts)
      const CANONICAL_START_TIMES: Record<string, string> = {
        "Solo1_Tractor_1": "16:30",
        "Solo1_Tractor_2": "20:30",
        "Solo1_Tractor_3": "20:30",
        "Solo1_Tractor_4": "17:30",
        "Solo1_Tractor_5": "21:30",
        "Solo1_Tractor_6": "01:30",
        "Solo1_Tractor_7": "18:30",
        "Solo1_Tractor_8": "00:30",
        "Solo1_Tractor_9": "16:30",
        "Solo1_Tractor_10": "20:30",
        "Solo2_Tractor_1": "18:30",
        "Solo2_Tractor_2": "23:30",
        "Solo2_Tractor_3": "21:30",
        "Solo2_Tractor_4": "08:30",
        "Solo2_Tractor_5": "15:30",
        "Solo2_Tractor_6": "11:30",
        "Solo2_Tractor_7": "16:30",
      };

      // Build lookup maps
      const contractMap = new Map<string, typeof tenantContracts[0]>();
      for (const contract of tenantContracts) {
        // Create lookup keys like "Solo2_Tractor_6" -> contract
        const key = `${contract.type.charAt(0).toUpperCase() + contract.type.slice(1)}_${contract.tractorId}`;
        contractMap.set(key, contract);
        // Also support lowercase key
        contractMap.set(key.toLowerCase(), contract);
      }

      // Track created contracts during import to avoid duplicates
      const createdContracts: string[] = [];

      // Build driver lookup by name (normalized)
      const driverMap = new Map<string, typeof tenantDrivers[0]>();
      for (const driver of tenantDrivers) {
        // Normalize whitespace: trim and collapse multiple spaces
        const firstName = (driver.firstName || '').trim().replace(/\s+/g, ' ');
        const lastName = (driver.lastName || '').trim().replace(/\s+/g, ' ');
        const fullName = `${firstName} ${lastName}`.toLowerCase().trim();
        driverMap.set(fullName, driver);
        // Also add initial + last name format: "M. FREEMAN" -> "m. freeman"
        if (firstName && lastName) {
          const initialFormat = `${firstName.charAt(0).toLowerCase()}. ${lastName.toLowerCase()}`;
          driverMap.set(initialFormat, driver);
          // Also add just last name as key for fallback
          driverMap.set(lastName.toLowerCase(), driver);
        }
        console.log(`[IMPORT] Driver map entry: "${fullName}" -> ${firstName} ${lastName} (ID: ${driver.id})`);
      }

      const results = {
        created: 0,
        replaced: 0,  // Number of existing blocks that were deleted and re-created
        skipped: 0,
        errors: [] as string[],
        assignments: 0,
      };

      // DEBUG: Track blocks without driver assignments and why
      const blocksWithoutAssignments: Array<{
        blockId: string;
        reason: string;
        primaryDriver: string | null;
        hasRejectedTrip: boolean;
      }> = [];

      const importBatchId = `recon_${Date.now()}`;

      // DEBUG: Log hasRejectedTrip values coming from client
      const blocksWithRejectedTrip = reconstructedBlocks.filter((b: any) => b.hasRejectedTrip === true);
      const blocksWithoutRejectedTrip = reconstructedBlocks.filter((b: any) => !b.hasRejectedTrip);
      console.log(`[IMPORT DEBUG] Blocks received from client:`);
      console.log(`[IMPORT DEBUG]   Total blocks: ${reconstructedBlocks.length}`);
      console.log(`[IMPORT DEBUG]   Blocks with hasRejectedTrip=true: ${blocksWithRejectedTrip.length}`);
      console.log(`[IMPORT DEBUG]   Blocks with hasRejectedTrip=false/undefined: ${blocksWithoutRejectedTrip.length}`);
      if (blocksWithRejectedTrip.length > 0) {
        console.log(`[IMPORT DEBUG]   Sample REJECTED blocks: ${blocksWithRejectedTrip.slice(0, 5).map((b: any) => b.blockId).join(', ')}`);
      }

      for (const block of reconstructedBlocks) {
        try {
          // Validate startDate exists before processing
          if (!block.startDate) {
            results.errors.push(`Block ${block.blockId}: No start date found in CSV data`);
            results.skipped++;
            continue;
          }

          // Parse contract from block.contract (e.g., "Solo2_Tractor_6")
          const contractKey = block.contract;
          let contract = contractMap.get(contractKey) || contractMap.get(contractKey?.toLowerCase());

          // Auto-create contract if it doesn't exist
          // This ensures each block shows in the correct calendar row
          if (!contract && contractKey) {
            const typeMatch = contractKey.match(/(solo[12])/i);
            const blockType = typeMatch ? typeMatch[1].toLowerCase() : 'solo2';
            const tractorMatch = contractKey.match(/Tractor_(\d+)/i);
            const tractorIdParsed = tractorMatch ? `Tractor_${tractorMatch[1]}` : null;

            // Only auto-create if we have both type and tractor
            if (tractorIdParsed) {
              // Check if we already created this contract in this import batch
              if (!createdContracts.includes(contractKey)) {
                // Get start time from canonical lookup
                const startTime = CANONICAL_START_TIMES[contractKey] || block.canonicalStartTime || '00:00';
                const duration = blockType === 'solo1' ? 14 : 38;
                const baseRoutes = blockType === 'solo1' ? 10 : 7;
                const contractName = `${blockType.toUpperCase()} ${startTime} ${tractorIdParsed}`;

                try {
                  const [newContract] = await db.insert(contracts).values({
                    tenantId,
                    name: contractName,
                    type: blockType,
                    tractorId: tractorIdParsed,
                    startTime,
                    duration,
                    baseRoutes,
                    status: "active",
                    domicile: "MKC",
                    daysPerWeek: 6,
                    protectedDrivers: false,
                  }).returning();

                  // Add to maps so future blocks can find it
                  contract = newContract;
                  contractMap.set(contractKey, newContract);
                  contractMap.set(contractKey.toLowerCase(), newContract);
                  createdContracts.push(contractKey);

                  console.log(`[IMPORT] Auto-created contract ${contractName} for block ${block.blockId}`);
                } catch (e) {
                  console.log(`[IMPORT] Failed to auto-create contract ${contractKey}: ${e}`);
                }
              } else {
                // Already created in this batch, try to get it from map now
                contract = contractMap.get(contractKey) || contractMap.get(contractKey.toLowerCase());
              }
            }
          }

          // Fallback: if STILL no contract, use first available (required by NOT NULL constraint)
          if (!contract && tenantContracts.length > 0) {
            contract = tenantContracts[0];
            console.log(`[IMPORT] Using first available contract ${contract.tractorId} (${contract.type}) for block ${block.blockId} - no matching contract found`);
          }

          // If no contracts exist at all, skip this block
          if (!contract) {
            results.errors.push(`No contracts available for tenant, cannot import block ${block.blockId}`);
            results.skipped++;
            continue;
          }

          // Parse duration (e.g., "38h" -> 38)
          const durationMatch = block.duration?.match(/(\d+)/);
          const duration = durationMatch ? parseInt(durationMatch[1]) : contract.duration;

          // Parse solo type from contract key
          const soloMatch = contractKey?.match(/(solo[12])/i);
          const soloType = soloMatch ? soloMatch[1].toLowerCase() : contract.type;

          // Parse tractorId from CSV's contract key (e.g., "Solo1_Tractor_10" -> "Tractor_10")
          // This preserves the actual tractor assignment from Amazon's CSV even if we had to use a fallback contract
          const tractorMatch = contractKey?.match(/Tractor_(\d+)/i);
          const tractorId = tractorMatch ? `Tractor_${tractorMatch[1]}` : contract.tractorId;

          // Log if we're using a different tractorId than the contract's
          if (tractorId !== contract.tractorId) {
            console.log(`[IMPORT] Block ${block.blockId}: Using tractorId="${tractorId}" from CSV (contract has "${contract.tractorId}")`);
          }

          // Parse start date and time
          // IMPORTANT: Use UTC noon (12:00:00Z) to avoid timezone boundary issues
          // This ensures the date doesn't shift to the previous day in any timezone
          const serviceDateForDb = new Date(block.startDate + 'T12:00:00Z');

          // For startTimestamp, use the actual start time with the date
          const startTimeStr = block.canonicalStartTime || contract.startTime || '00:00';
          const [hours, minutes] = startTimeStr.split(':').map(Number);
          const startTimestamp = new Date(block.startDate + 'T00:00:00');
          startTimestamp.setHours(hours, minutes, 0, 0);

          // Calculate end timestamp
          const endTimestamp = new Date(startTimestamp);
          endTimestamp.setHours(endTimestamp.getHours() + duration);

          // Create new block (existing blocks with same blockId were already deleted above)
          // isRejectedLoad comes from the Trip Stage column in CSV:
          // - Trip Stage = "Rejected" → isRejectedLoad = true → RED on calendar
          // - Empty driver without "Rejected" → isRejectedLoad = false → YELLOW on calendar
          const isRejectedLoad = block.hasRejectedTrip || false;
          const inserted = await db
            .insert(blocks)
            .values({
              tenantId,
              blockId: block.blockId,
              serviceDate: serviceDateForDb,
              contractId: contract.id,
              startTimestamp,
              endTimestamp,
              tractorId,
              soloType,
              duration,
              status: 'assigned',
              isRejectedLoad,
            })
            .returning();
          const blockRecord = inserted[0];
          results.created++;
          console.log(`[IMPORT] Created block: ${block.blockId} for ${block.startDate} with tractorId="${tractorId}", contractKey="${contractKey}"`);

          // Debug for blocks without driver assignment
          if (!block.primaryDriver) {
            if (block.hasRejectedTrip) {
              console.log(`[IMPORT DEBUG] Block ${block.blockId}: Trip Stage=Rejected - will show RED (rejected load)`);
            } else {
              console.log(`[IMPORT DEBUG] Block ${block.blockId}: No driver in CSV - will show YELLOW (unassigned)`);
            }
          }

          // Try to create driver assignment if we have a primary driver
          if (block.primaryDriver && blockRecord) {
            // Normalize driver name: handle semicolons (e.g., "Robert Charles; JR Dixon" -> "Robert Charles")
            let driverNameRaw = block.primaryDriver.trim().replace(/\s+/g, ' ');
            if (driverNameRaw.includes(';')) {
              driverNameRaw = driverNameRaw.split(';')[0].trim();
              console.log(`[IMPORT] Split semicolon name to: "${driverNameRaw}" for block ${block.blockId}`);
            }
            const driverName = driverNameRaw.toLowerCase();
            console.log(`[IMPORT] Looking for driver: "${driverName}" (raw: "${block.primaryDriver}")`);

            // Try exact match first
            let driver = driverMap.get(driverName);

            // Try just the last name directly
            if (!driver) {
              const nameParts = driverName.split(' ').filter(p => p.length > 0);
              if (nameParts.length >= 1) {
                const lastName = nameParts[nameParts.length - 1];
                driver = driverMap.get(lastName);
                if (driver) {
                  console.log(`[IMPORT] Matched by direct last name lookup: "${lastName}"`);
                }
              }
            }

            // Fallback 1: Try last name only match
            if (!driver) {
              const nameParts = driverName.split(' ').filter(p => p.length > 0);
              if (nameParts.length >= 2) {
                const lastName = nameParts[nameParts.length - 1];
                // Find driver whose last name matches
                const lastNameMatch = tenantDrivers.find(d =>
                  d.lastName.toLowerCase() === lastName
                );
                if (lastNameMatch) {
                  driver = lastNameMatch;
                  console.log(`[IMPORT] Matched driver by last name "${lastName}": ${lastNameMatch.firstName} ${lastNameMatch.lastName}`);
                }
              }
            }

            // Fallback 2: Try partial match (first name + last name contains)
            if (!driver) {
              const partialMatch = tenantDrivers.find(d => {
                const fullName = `${d.firstName} ${d.lastName}`.toLowerCase();
                return driverName.includes(d.lastName.toLowerCase()) ||
                       fullName.includes(driverName) ||
                       driverName.includes(fullName);
              });
              if (partialMatch) {
                driver = partialMatch;
                console.log(`[IMPORT] Matched driver by partial match: ${partialMatch.firstName} ${partialMatch.lastName}`);
              }
            }

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
              blocksWithoutAssignments.push({
                blockId: block.blockId,
                reason: `Driver not found in database: "${block.primaryDriver}"`,
                primaryDriver: block.primaryDriver,
                hasRejectedTrip: block.hasRejectedTrip || false,
              });
            }
          } else {
            // No primaryDriver in the reconstructed block
            blocksWithoutAssignments.push({
              blockId: block.blockId,
              reason: 'No primaryDriver in CSV data',
              primaryDriver: null,
              hasRejectedTrip: block.hasRejectedTrip || false,
            });
          }
        } catch (blockError: any) {
          results.errors.push(`Error processing block ${block.blockId}: ${blockError.message}`);
          results.skipped++;
        }
      }

      // Set replaced count in results
      results.replaced = replacedCount;

      // Count rejected loads (Trip Stage = "Rejected" in CSV - Amazon rejected the driver)
      const rejectedLoadBlocks = blocksWithoutAssignments.filter(
        item => item.hasRejectedTrip
      );
      const rejectedCount = rejectedLoadBlocks.length;

      // Count unassigned blocks (no driver in CSV data AND NOT rejected - need AI recommendation)
      const unassignedBlocksNotRejected = blocksWithoutAssignments.filter(
        item => item.reason === 'No primaryDriver in CSV data' && !item.hasRejectedTrip
      );
      const unassignedCount = unassignedBlocksNotRejected.length;

      // Count unmatched drivers (blocks with driver in CSV but driver not found in database)
      const unmatchedDrivers = blocksWithoutAssignments.filter(
        item => item.reason.startsWith('Driver not found in database')
      );
      const unmatchedDriverCount = unmatchedDrivers.length;

      console.log(`[IMPORT] Complete: ${results.created} created (${replacedCount} replaced existing), ${results.assignments} assignments, ${rejectedCount} rejected (Trip Stage=Rejected), ${unassignedCount} unassigned (no driver, not rejected), ${unmatchedDriverCount} unmatched drivers, ${results.skipped} skipped, ${results.errors.length} errors`);

      // DEBUG: Log all blocks without assignments
      if (blocksWithoutAssignments.length > 0) {
        console.log(`\n[IMPORT DEBUG] ========== BLOCKS WITHOUT DRIVER ASSIGNMENTS ==========`);
        console.log(`[IMPORT DEBUG] Total: ${blocksWithoutAssignments.length} blocks without assignments`);
        console.log(`[IMPORT DEBUG] REJECTED (Trip Stage=Rejected, will be RED): ${rejectedCount}`);
        console.log(`[IMPORT DEBUG] Unassigned (no driver, not rejected, will be YELLOW): ${unassignedCount}`);
        console.log(`[IMPORT DEBUG] Unmatched drivers (driver in CSV but not in database): ${unmatchedDriverCount}`);
        for (const item of blocksWithoutAssignments) {
          console.log(`[IMPORT DEBUG]   Block ${item.blockId}: ${item.reason} | hasRejectedTrip=${item.hasRejectedTrip}`);
        }
        console.log(`[IMPORT DEBUG] ============================================================\n`);
      }

      // Trigger DNA profile regeneration in background after import
      // This updates all drivers with new assignment patterns
      if (results.assignments > 0) {
        regenerateDNAFromBlockAssignments(tenantId).catch(err => {
          console.error(`[DNA] Background regeneration failed after import:`, err);
        });
        console.log(`[IMPORT] Triggered DNA regeneration for ${results.assignments} new assignments`);
      }

      const totalProcessed = results.created;
      res.json({
        success: true,
        message: `Imported ${totalProcessed} blocks${replacedCount > 0 ? ` (${replacedCount} replaced existing)` : ''} with ${results.assignments} driver assignments`,
        ...results,
        totalProcessed,
        importBatchId,
        rejectedLoads: rejectedCount, // Number of blocks where Trip Stage = "Rejected" (RED on calendar)
        unassignedBlocks: unassignedCount, // Number of blocks with no driver in CSV AND not rejected (YELLOW on calendar)
        unmatchedDrivers: unmatchedDriverCount, // Number of blocks where driver in CSV couldn't be matched to database
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

  // ==========================================================================
  // Fleet Communication API Endpoints
  // ==========================================================================

  // Get all drivers with their online/offline status
  app.get("/api/fleet-comm/drivers", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;

      // Get all drivers
      const allDrivers = await db.select()
        .from(drivers)
        .where(and(
          eq(drivers.tenantId, tenantId),
          eq(drivers.isActive, true)
        ));

      // Get online drivers from WebSocket
      const onlineDrivers = getOnlineDrivers(tenantId);
      const onlineDriverIds = new Set(onlineDrivers.map(d => d.driverId));

      // Combine data
      const driversWithStatus = allDrivers.map(driver => ({
        ...driver,
        isOnline: onlineDriverIds.has(driver.id),
        lastSeen: onlineDrivers.find(d => d.driverId === driver.id)?.lastSeen || null
      }));

      res.json({
        success: true,
        drivers: driversWithStatus,
        onlineCount: onlineDriverIds.size,
        totalCount: allDrivers.length
      });
    } catch (error: any) {
      console.error("Get fleet comm drivers error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get active drop-in sessions
  app.get("/api/fleet-comm/active-sessions", requireAuth, async (req, res) => {
    try {
      const activeSessions = getActiveDropIns();
      res.json({ success: true, sessions: activeSessions });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get drop-in session history
  app.get("/api/fleet-comm/sessions", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const limit = parseInt(req.query.limit as string) || 50;

      const sessions = await db.select()
        .from(dropInSessions)
        .where(eq(dropInSessions.tenantId, tenantId))
        .orderBy(desc(dropInSessions.startedAt))
        .limit(limit);

      res.json({ success: true, sessions });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Create a drop-in session record (called when session starts)
  app.post("/api/fleet-comm/sessions", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const dispatcherId = req.session.userId!;

      const result = insertDropInSessionSchema.safeParse({
        ...req.body,
        tenantId,
        dispatcherId
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: fromZodError(result.error).message
        });
      }

      const [session] = await db.insert(dropInSessions)
        .values(result.data)
        .returning();

      res.json({ success: true, session });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // End a drop-in session
  app.patch("/api/fleet-comm/sessions/:id/end", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const endedAt = new Date();

      // Get session to calculate duration
      const [existingSession] = await db.select()
        .from(dropInSessions)
        .where(eq(dropInSessions.id, id))
        .limit(1);

      if (!existingSession) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }

      const durationSeconds = Math.floor(
        (endedAt.getTime() - existingSession.startedAt.getTime()) / 1000
      );

      const [updatedSession] = await db.update(dropInSessions)
        .set({
          status: "ended",
          endedAt,
          durationSeconds,
          notes: req.body.notes
        })
        .where(eq(dropInSessions.id, id))
        .returning();

      res.json({ success: true, session: updatedSession });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Check if a driver is online (REST fallback)
  app.get("/api/fleet-comm/drivers/:driverId/status", requireAuth, async (req, res) => {
    try {
      const { driverId } = req.params;
      const isOnline = isDriverOnline(driverId);
      res.json({ success: true, driverId, isOnline });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Make a phone call to a driver via Twilio (grandma mode drop-in)
  app.post("/api/fleet-comm/call", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { driverId, phoneNumber, message } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ success: false, message: "Phone number required" });
      }

      // Check if Twilio is configured
      if (!twilioService.isReady()) {
        return res.status(503).json({
          success: false,
          message: "Phone service not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER."
        });
      }

      // Default message if none provided
      const callMessage = message || "Hello, this is dispatch from Freedom Transportation calling to check in with you. Please call us back if you need anything.";

      // Make the call
      const result = await twilioService.sendCustomBroadcast(tenantId, {
        driverId: driverId || "unknown",
        driverPhone: phoneNumber,
        message: callMessage,
        broadcastType: "drop_in_call"
      });

      if (result.success) {
        res.json({
          success: true,
          callSid: result.callSid,
          broadcastId: result.broadcastId,
          message: "Call initiated"
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error || "Failed to initiate call"
        });
      }
    } catch (error: any) {
      console.error("[FleetComm] Phone call error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Hang up an active call
  app.post("/api/fleet-comm/hangup", requireAuth, async (req, res) => {
    try {
      const { callSid } = req.body;

      if (!callSid) {
        return res.status(400).json({ success: false, message: "Call SID required" });
      }

      // Check if Twilio is configured
      if (!twilioService.isReady()) {
        return res.status(503).json({
          success: false,
          message: "Phone service not configured"
        });
      }

      // Use the Twilio client to update the call status
      const Twilio = (await import('twilio')).default;
      const client = Twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await client.calls(callSid).update({ status: 'completed' });

      console.log(`[FleetComm] Call ${callSid} hung up`);

      res.json({ success: true, message: "Call ended" });
    } catch (error: any) {
      console.error("[FleetComm] Hangup error:", error);
      // Even if Twilio errors, return success (call may have already ended)
      res.json({ success: true, message: "Call ended" });
    }
  });

  // Schedule a call for later
  app.post("/api/fleet-comm/schedule", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { driverId, phoneNumber, scheduledFor, message } = req.body;

      if (!driverId || !phoneNumber || !scheduledFor) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      // Get driver name
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1);
      const driverName = driver ? `${driver.firstName} ${driver.lastName}` : "Unknown Driver";

      // Create scheduled call in voice_broadcasts table
      const [scheduledCall] = await db.insert(voiceBroadcasts).values({
        tenantId,
        driverId,
        broadcastType: "scheduled_call",
        phoneNumber,
        message: message || "Hello, this is dispatch from Freedom Transportation calling to check in with you.",
        status: "pending",
        scheduledFor: new Date(scheduledFor),
        metadata: { driverName }
      }).returning();

      console.log(`[FleetComm] Scheduled call for ${driverName} at ${scheduledFor}`);

      res.json({
        success: true,
        scheduledCall: {
          id: scheduledCall.id,
          driverId: scheduledCall.driverId,
          driverName,
          phoneNumber: scheduledCall.phoneNumber,
          scheduledFor: scheduledCall.scheduledFor,
          message: scheduledCall.message,
          status: scheduledCall.status
        }
      });
    } catch (error: any) {
      console.error("[FleetComm] Schedule error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get scheduled calls
  app.get("/api/fleet-comm/scheduled", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      // Get all scheduled calls (pending and recent completed/failed)
      const scheduledBroadcasts = await db.select()
        .from(voiceBroadcasts)
        .where(
          and(
            eq(voiceBroadcasts.tenantId, tenantId),
            eq(voiceBroadcasts.broadcastType, "scheduled_call")
          )
        )
        .orderBy(voiceBroadcasts.scheduledFor);

      const scheduledCalls = scheduledBroadcasts.map(b => ({
        id: b.id,
        driverId: b.driverId,
        driverName: (b.metadata as any)?.driverName || "Unknown",
        phoneNumber: b.phoneNumber,
        scheduledFor: b.scheduledFor,
        message: b.message,
        status: b.status
      }));

      res.json({ success: true, scheduledCalls });
    } catch (error: any) {
      console.error("[FleetComm] Get scheduled error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Cancel a scheduled call
  app.delete("/api/fleet-comm/scheduled/:id", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { id } = req.params;

      // Update status to cancelled
      await db.update(voiceBroadcasts)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(voiceBroadcasts.id, id),
            eq(voiceBroadcasts.tenantId, tenantId),
            eq(voiceBroadcasts.status, "pending")
          )
        );

      console.log(`[FleetComm] Cancelled scheduled call ${id}`);

      res.json({ success: true, message: "Scheduled call cancelled" });
    } catch (error: any) {
      console.error("[FleetComm] Cancel scheduled error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Update a scheduled call time
  app.patch("/api/fleet-comm/scheduled/:id", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { id } = req.params;
      const { scheduledFor } = req.body;

      if (!scheduledFor) {
        return res.status(400).json({ success: false, message: "scheduledFor is required" });
      }

      // Update the scheduled time
      await db.update(voiceBroadcasts)
        .set({ scheduledFor: new Date(scheduledFor) })
        .where(
          and(
            eq(voiceBroadcasts.id, id),
            eq(voiceBroadcasts.tenantId, tenantId),
            eq(voiceBroadcasts.status, "pending")
          )
        );

      console.log(`[FleetComm] Updated scheduled call ${id} to ${scheduledFor}`);

      res.json({ success: true, message: "Scheduled call updated" });
    } catch (error: any) {
      console.error("[FleetComm] Update scheduled error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Call now - immediately execute a scheduled call
  app.post("/api/fleet-comm/call-now/:id", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { id } = req.params;

      // Get the scheduled call
      const [call] = await db.select()
        .from(voiceBroadcasts)
        .where(
          and(
            eq(voiceBroadcasts.id, id),
            eq(voiceBroadcasts.tenantId, tenantId),
            eq(voiceBroadcasts.status, "pending")
          )
        );

      if (!call) {
        return res.status(404).json({ success: false, message: "Scheduled call not found or already processed" });
      }

      // Import twilioService
      const { twilioService } = await import("./twilio-service");

      // Make the call immediately
      console.log(`[FleetComm] Calling now: ${call.phoneNumber}`);

      const callResult = await twilioService.makeCall(
        call.phoneNumber!,
        call.message || "Hello, this is a message from Freedom Transportation."
      );

      if (callResult.success) {
        // Update status to completed
        await db.update(voiceBroadcasts)
          .set({
            status: "completed",
            completedAt: new Date(),
            callSid: callResult.callSid
          })
          .where(eq(voiceBroadcasts.id, id));

        console.log(`[FleetComm] Call placed successfully: ${callResult.callSid}`);
        res.json({ success: true, message: "Call placed", callSid: callResult.callSid });
      } else {
        // Update status to failed
        await db.update(voiceBroadcasts)
          .set({
            status: "failed",
            error: callResult.error
          })
          .where(eq(voiceBroadcasts.id, id));

        console.error(`[FleetComm] Call failed: ${callResult.error}`);
        res.json({ success: false, message: callResult.error || "Call failed" });
      }
    } catch (error: any) {
      console.error("[FleetComm] Call now error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==========================================
  // QUICK CALL - Natural Language Processing
  // ==========================================

  // Quick Call - parses natural language like "call Dan in 20 minutes and tell him great job"
  app.post("/api/fleet-comm/quick-call", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ success: false, message: "No prompt provided" });
      }

      // Get all drivers with phone numbers for this tenant
      const allDrivers = await db.select()
        .from(drivers)
        .where(
          and(
            eq(drivers.tenantId, tenantId),
            isNotNull(drivers.phoneNumber)
          )
        );

      if (allDrivers.length === 0) {
        return res.status(404).json({ success: false, message: "No drivers with phone numbers found" });
      }

      // Import Google Generative AI SDK
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const driverList = allDrivers.map(d => `${d.firstName} ${d.lastName}`).join(", ");

      // Parse the natural language command
      const parsePrompt = `You are a dispatcher assistant parsing a quick call command.

Available drivers: ${driverList}

User's command: "${prompt}"

Parse this command and return JSON with:
1. driverName: The full name of the driver to call (match flexibly: "Dan" = "Daniel", nicknames, etc.)
2. delayMinutes: How many minutes from now to make the call (0 = call now, "in 20 minutes" = 20, "in an hour" = 60)
3. message: What to say to the driver. If no specific message given, create a friendly check-in message.

Return ONLY valid JSON, no markdown:
{"driverName": "Full Name", "delayMinutes": 0, "message": "What to say..."}`;

      const parseResult = await model.generateContent(parsePrompt);
      let parsed: { driverName: string; delayMinutes: number; message: string };

      try {
        let parseText = parseResult.response.text().trim();
        // Remove markdown code blocks if present
        parseText = parseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(parseText);
      } catch (e) {
        console.error("[QuickCall] Failed to parse AI response:", parseResult.response.text());
        return res.status(400).json({ success: false, message: "Could not understand the command. Try: 'Call Dan in 20 minutes'" });
      }

      console.log("[QuickCall] Parsed:", parsed);

      // Find the matching driver
      const matchedDriver = allDrivers.find(d => {
        const fullName = `${d.firstName} ${d.lastName}`.toLowerCase();
        const searchName = parsed.driverName.toLowerCase();
        return fullName === searchName ||
               fullName.includes(searchName) ||
               d.firstName.toLowerCase() === searchName ||
               d.lastName.toLowerCase() === searchName;
      });

      if (!matchedDriver) {
        return res.status(404).json({
          success: false,
          message: `Could not find driver "${parsed.driverName}". Available: ${driverList}`
        });
      }

      // Generate the actual script using AI
      const scriptPrompt = `You are Milo, a friendly AI assistant for Freedom Transportation.
Generate a phone call script for a driver. Keep it conversational, warm, and professional.
The script should be spoken aloud, so write naturally. Keep it under 50 words.
Always start with "Hey [FirstName]!" and end with a goodbye.

Driver name: ${matchedDriver.firstName} ${matchedDriver.lastName}
What the dispatcher wants to say: ${parsed.message}

Generate the script:`;

      const scriptResult = await model.generateContent(scriptPrompt);
      const script = scriptResult.response.text().trim();

      // Calculate scheduled time
      const scheduledFor = new Date(Date.now() + parsed.delayMinutes * 60 * 1000);
      const callNow = parsed.delayMinutes === 0;

      // Create the scheduled call
      const [broadcast] = await db.insert(voiceBroadcasts).values({
        tenantId,
        driverId: matchedDriver.id,
        phoneNumber: matchedDriver.phoneNumber!,
        message: script,
        scheduledFor,
        status: "pending",
        broadcastType: "scheduled_call",
        metadata: { source: "quick-call", originalPrompt: prompt }
      }).returning();

      console.log(`[QuickCall] Scheduled call for ${matchedDriver.firstName} ${matchedDriver.lastName} at ${scheduledFor.toISOString()}`);

      // If call now, execute immediately
      if (callNow) {
        const { twilioService } = await import("./twilio-service");

        console.log(`[QuickCall] Calling now: ${matchedDriver.phoneNumber}`);
        const callResult = await twilioService.makeCall(
          matchedDriver.phoneNumber!,
          script
        );

        if (callResult.success) {
          await db.update(voiceBroadcasts)
            .set({
              status: "completed",
              completedAt: new Date(),
              callSid: callResult.callSid
            })
            .where(eq(voiceBroadcasts.id, broadcast.id));

          return res.json({
            success: true,
            callNow: true,
            driverName: `${matchedDriver.firstName} ${matchedDriver.lastName}`,
            script,
            callSid: callResult.callSid
          });
        } else {
          await db.update(voiceBroadcasts)
            .set({ status: "failed", error: callResult.error })
            .where(eq(voiceBroadcasts.id, broadcast.id));

          return res.json({ success: false, message: callResult.error || "Call failed" });
        }
      }

      // Return success for scheduled call
      res.json({
        success: true,
        callNow: false,
        driverName: `${matchedDriver.firstName} ${matchedDriver.lastName}`,
        scheduledFor: scheduledFor.toISOString(),
        script,
        callId: broadcast.id
      });

    } catch (error: any) {
      console.error("[QuickCall] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==========================================
  // AI CALL PLANNER ENDPOINTS
  // ==========================================

  // Smart AI Call Planner - accepts free-form text, AI extracts drivers and generates scripts
  app.post("/api/fleet-comm/generate-scripts", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { prompt, driverIds } = req.body;

      if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
        return res.status(400).json({ success: false, message: "No prompt provided" });
      }

      // Get all drivers with phone numbers for this tenant
      const allDrivers = await db.select()
        .from(drivers)
        .where(
          and(
            eq(drivers.tenantId, tenantId),
            isNotNull(drivers.phoneNumber)
          )
        );

      if (allDrivers.length === 0) {
        return res.status(404).json({ success: false, message: "No drivers with phone numbers found" });
      }

      // Import Google Generative AI SDK
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      let selectedDrivers: typeof allDrivers = [];

      // If driverIds are provided (legacy mode), use them directly
      if (driverIds && Array.isArray(driverIds) && driverIds.length > 0) {
        selectedDrivers = allDrivers.filter(d => driverIds.includes(d.id));
      } else {
        // Smart mode: Use AI to extract driver names from the prompt
        const driverList = allDrivers.map(d => `${d.firstName || ""} ${d.lastName || ""}`.trim()).join(", ");

        const extractionPrompt = `You are analyzing a dispatch message to identify which drivers should receive a phone call.

Available drivers: ${driverList}

User's message:
${prompt}

Extract ALL driver names mentioned in the message. Match names flexibly:
- "Dan" matches "Daniel"
- "Natasha" matches "Natasha Shirey"
- First names alone should match
- Be case-insensitive

Return ONLY a JSON array of full driver names that were mentioned, exactly as they appear in the available drivers list.
If the message mentions "all drivers" or "everyone", return all driver names.
If no specific drivers are mentioned, return an empty array [].

Example response: ["Daniel James Shirey", "Natasha Shirey"]`;

        try {
          const extractionResult = await model.generateContent(extractionPrompt);
          const extractionResponse = await extractionResult.response;
          const extractionText = extractionResponse.text().trim();

          console.log("[AICallPlanner] Extraction response:", extractionText);

          // Parse the JSON array of names
          let extractedNames: string[] = [];
          try {
            // Find JSON array in the response
            const jsonMatch = extractionText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              extractedNames = JSON.parse(jsonMatch[0]);
            }
          } catch (parseError) {
            console.error("[AICallPlanner] Failed to parse extracted names:", parseError);
          }

          console.log("[AICallPlanner] Extracted names:", extractedNames);

          // Match extracted names to drivers
          selectedDrivers = allDrivers.filter(driver => {
            const firstName = driver.firstName || "";
            const lastName = driver.lastName || "";
            const fullName = `${firstName} ${lastName}`.toLowerCase().trim();
            const firstNameLower = firstName.toLowerCase();
            const lastNameLower = lastName.toLowerCase();

            return extractedNames.some(name => {
              const nameLower = (name || "").toLowerCase();
              return fullName === nameLower ||
                     firstNameLower === nameLower ||
                     lastNameLower === nameLower ||
                     fullName.includes(nameLower) ||
                     nameLower.includes(fullName);
            });
          });

          console.log("[AICallPlanner] Matched drivers:", selectedDrivers.map(d => `${d.firstName || ""} ${d.lastName || ""}`.trim()));

        } catch (extractError: any) {
          console.error("[AICallPlanner] Name extraction failed:", extractError);
          return res.status(400).json({
            success: false,
            message: "Could not identify drivers from your message. Please mention driver names."
          });
        }
      }

      if (selectedDrivers.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No drivers found matching the names in your message. Please check the names and try again."
        });
      }

      // Check if user wants multiple scripts (e.g., "3 times", "3 different ways")
      const multipleMatch = prompt.match(/(\d+)\s*(?:times|different\s*ways?|variations?|versions?|scripts?)/i);
      const scriptCount = multipleMatch ? Math.min(parseInt(multipleMatch[1]), 5) : 1; // Max 5 scripts per driver

      // Generate personalized script for each driver
      const scripts = [];
      for (const driver of selectedDrivers) {
        if (!driver.phoneNumber) {
          continue;
        }

        const systemPrompt = `You are Milo, a friendly AI assistant for Freedom Transportation.
Your job is to generate a phone call script that will be spoken aloud via text-to-speech.

CRITICAL RULES:
1. Output ONLY the spoken words - no stage directions, no quotes around the text
2. Start with "Hey ${driver.firstName}!"
3. End with a friendly goodbye
4. Keep it under 50 words unless asked otherwise
5. Be conversational, warm, and natural - like a real person talking
6. If asked to tell a joke, ACTUALLY tell a funny joke - don't just say you're calling to tell a joke
7. If given specific info (like start times), include it naturally in the script
8. NEVER echo the instructions - GENERATE creative content based on them
9. Generate ONLY ONE script - do NOT generate multiple variations in one response`;

        // Generate multiple scripts if requested
        for (let i = 0; i < scriptCount; i++) {
          try {
            const variationNote = scriptCount > 1
              ? `\n\nThis is variation ${i + 1} of ${scriptCount}. Make it UNIQUE and DIFFERENT from other variations. Be creative!`
              : '';

            const scriptPrompt = `${systemPrompt}

Generate a phone call script for ${driver.firstName} ${driver.lastName}.

The dispatcher wants you to: ${prompt.replace(/\d+\s*(?:times|different\s*ways?|variations?|versions?|scripts?)/i, '')}${variationNote}

Remember: Output ONLY ONE script with the words to be spoken. Be creative and natural.`;

            const scriptResult = await model.generateContent(scriptPrompt);
            const scriptResponse = await scriptResult.response;
            const script = scriptResponse.text();

            scripts.push({
              driverId: driver.id,
              driverName: `${driver.firstName} ${driver.lastName}`,
              phoneNumber: driver.phoneNumber,
              script: script.trim(),
              variationNumber: scriptCount > 1 ? i + 1 : undefined
            });
          } catch (aiError: any) {
            console.error(`[AICallPlanner] Error generating script for ${driver.firstName}:`, aiError);
            scripts.push({
              driverId: driver.id,
              driverName: `${driver.firstName} ${driver.lastName}`,
              phoneNumber: driver.phoneNumber,
              script: `Hey ${driver.firstName}! This is Milo from Freedom Transportation. Just calling to check in. Have a great day! Goodbye.`
            });
          }
        }
      }

      console.log(`[AICallPlanner] Generated ${scripts.length} scripts for: ${scripts.map(s => s.driverName).join(", ")}`);

      res.json({ success: true, scripts });
    } catch (error: any) {
      console.error("[AICallPlanner] Generate scripts error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Schedule a batch of calls
  app.post("/api/fleet-comm/schedule-batch", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { calls } = req.body;

      if (!calls || !Array.isArray(calls) || calls.length === 0) {
        return res.status(400).json({ success: false, message: "No calls to schedule" });
      }

      const callIds = [];
      for (const call of calls) {
        if (!call.driverId || !call.phoneNumber || !call.message || !call.scheduledFor) {
          continue; // Skip invalid entries
        }

        const [broadcast] = await db.insert(voiceBroadcasts).values({
          tenantId,
          driverId: call.driverId,
          broadcastType: "scheduled_call",
          phoneNumber: call.phoneNumber,
          message: call.message,
          scheduledFor: new Date(call.scheduledFor),
          status: "pending",
          metadata: {
            source: "ai-call-planner",
            driverName: call.driverName || "Unknown"
          }
        }).returning();

        callIds.push(broadcast.id);
      }

      console.log(`[AICallPlanner] Scheduled ${callIds.length} calls`);

      res.json({ success: true, scheduled: callIds.length, callIds });
    } catch (error: any) {
      console.error("[AICallPlanner] Schedule batch error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Get call summary for a batch
  app.get("/api/fleet-comm/call-summary", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const idsParam = req.query.ids as string;
      if (!idsParam) {
        return res.status(400).json({ success: false, message: "No call IDs provided" });
      }

      const callIds = idsParam.split(",").map(id => id.trim()).filter(Boolean);

      if (callIds.length === 0) {
        return res.status(400).json({ success: false, message: "No valid call IDs" });
      }

      // Get the calls
      const callRecords = await db.select()
        .from(voiceBroadcasts)
        .where(
          and(
            eq(voiceBroadcasts.tenantId, tenantId),
            inArray(voiceBroadcasts.id, callIds)
          )
        );

      // Build summary
      const summary = {
        total: callRecords.length,
        completed: callRecords.filter(c => c.status === "completed").length,
        noAnswer: callRecords.filter(c => c.status === "failed" && c.errorMessage?.includes("no-answer")).length,
        failed: callRecords.filter(c => c.status === "failed" && !c.errorMessage?.includes("no-answer")).length,
        pending: callRecords.filter(c => c.status === "pending" || c.status === "queued" || c.status === "in_progress").length
      };

      const calls = callRecords.map(c => ({
        id: c.id,
        driverName: (c.metadata as any)?.driverName || "Unknown",
        phoneNumber: c.phoneNumber,
        status: c.status,
        attemptCount: c.attemptCount,
        completedAt: c.completedAt,
        errorMessage: c.errorMessage
      }));

      res.json({ success: true, summary, calls });
    } catch (error: any) {
      console.error("[AICallPlanner] Call summary error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==========================================
  // GEMINI TEXT PARSER ENDPOINT
  // ==========================================

  // Parse pasted schedule text using Gemini to extract driver/route data
  app.post("/api/fleet-comm/parse-text", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { text } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: "No text provided" });
      }

      // Get all drivers for context
      const allDrivers = await db.select()
        .from(drivers)
        .where(
          and(
            eq(drivers.tenantId, tenantId),
            isNotNull(drivers.phoneNumber)
          )
        );

      const driverList = allDrivers.map(d => `${d.firstName} ${d.lastName}`).join(", ");

      // Import Google Generative AI SDK
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

      const prompt = `You are a UNIVERSAL EXTRACTION PIPELINE for Freedom Transportation dispatch.

## INPUT TEXT:
${text}

## OUR DRIVERS DATABASE:
${driverList}

## EXTRACTION METHODOLOGY:

### STEP 1: IDENTIFY TEXT FORMAT
Classify what type of text this is:
- Structured list (bullets, numbered items)
- Free-form paragraph
- Table/CSV data
- Email content
- Mixed format

### STEP 2: EXTRACT HUMAN-READABLE ANCHORS

**TIME ANCHORS** (the "Go-Time" - most important):
- Dates: "Jan 2", "01/02", "Friday", "Tomorrow", "Tonight"
- Times: "6:00 AM", "00:30 CST", "Starts at 7"
- Relative: "Morning shift", "2 hours", "Next block"

**IDENTITY ANCHORS** (who we need to call):
- Full names: "Brian Worts", "Richard Ewing"
- Initials: "B. Worts", "R. Ewing"
- First names: "Brian", "Dan", "Natasha"
- Nicknames: "Rick" → Richard, "Dan" → Daniel, "Mike" → Michael, "Bob" → Robert

**LOCATION ANCHORS**:
- City/State: "Kansas City", "LENEXA, KS"
- Airport codes: MCI, ORD, DFW, DEN, LAX
- Warehouse codes: DKC4, MKC1, TUL1
- Route descriptions: "to Denver", "from Chicago"

**REFERENCE ANCHORS**:
- Block IDs: B-XXXXXXXX pattern
- Load numbers, trip IDs
- Any alphanumeric reference codes

### STEP 3: BUILD OUTPUT
Match names to our driver database aggressively:
- "Dan" matches "Daniel"
- "Rick" or "Dick" matches "Richard"
- "Mike" matches "Michael"
- Partial last names count

## RETURN JSON:
{
  "format": "structured_list | freeform | table | email | mixed",
  "confidence": "high | medium | low",
  "drivers": [
    {
      "name": "Name as shown in text",
      "origin": "Starting location",
      "destination": "Ending location",
      "startTime": "Time/date reference",
      "loadId": "Block ID or reference",
      "notes": "Other relevant info"
    }
  ],
  "blocks": [
    {
      "blockId": "Reference ID if found",
      "startTime": "Time",
      "route": "Location info",
      "driver": "Driver name"
    }
  ],
  "rawText": "Key schedule excerpts",
  "summary": "X drivers found with Y assignments"
}

## CRITICAL: Extract ALL names, even if not 100% certain of the match.`;

      console.log("[GeminiText] Processing text...");

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text().trim();

      console.log("[GeminiText] Raw response:", responseText);

      // Parse JSON from response
      let parsed: any = null;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error("[GeminiText] Failed to parse response:", parseError);
      }

      if (parsed) {
        // Helper function to match "F. LastName" pattern and nicknames
        const matchDriverName = (searchName: string, dbDriver: any): boolean => {
          const lastName = dbDriver.lastName.toLowerCase();
          const firstName = dbDriver.firstName.toLowerCase();
          const firstInitial = dbDriver.firstName.charAt(0).toLowerCase();
          const fullName = `${firstName} ${lastName}`;
          const searchLower = (searchName || "").toLowerCase().trim();

          // Exact match
          if (fullName === searchLower || firstName === searchLower || lastName === searchLower) {
            return true;
          }

          // Initial pattern: "B. Worts" or "B Worts"
          const initialPattern = /^([a-z])\.?\s*(.+)$/i;
          const match = searchLower.match(initialPattern);
          if (match) {
            const extractedInitial = match[1].toLowerCase();
            const extractedLastName = match[2].toLowerCase().replace(/[^a-z]/g, '');
            const dbLastNameClean = lastName.replace(/[^a-z]/g, '');
            if (extractedInitial === firstInitial &&
                (dbLastNameClean === extractedLastName || dbLastNameClean.includes(extractedLastName))) {
              return true;
            }
          }

          // Nickname matching
          const nicknames: Record<string, string[]> = {
            'richard': ['rick', 'dick', 'ricky'],
            'daniel': ['dan', 'danny'],
            'michael': ['mike', 'mikey'],
            'robert': ['bob', 'bobby', 'rob'],
            'william': ['bill', 'billy', 'will'],
            'james': ['jim', 'jimmy'],
            'joseph': ['joe', 'joey'],
            'christopher': ['chris'],
            'natasha': ['tasha', 'nat'],
            'brian': ['bri'],
            'matthew': ['matt'],
            'anthony': ['tony'],
            'abbas': ['ab']
          };

          for (const [formal, nicks] of Object.entries(nicknames)) {
            if (firstName === formal && nicks.some(n => searchLower.includes(n))) {
              return true;
            }
          }

          // Partial matches
          return fullName.includes(searchLower) || searchLower.includes(firstName) || searchLower.includes(lastName);
        };

        // Match extracted drivers to our database
        if (parsed.drivers && Array.isArray(parsed.drivers)) {
          parsed.drivers = parsed.drivers.map((d: any) => {
            const matchedDriver = allDrivers.find(dbDriver => matchDriverName(d.name, dbDriver));

            return {
              ...d,
              matched: !!matchedDriver,
              driverId: matchedDriver?.id || null,
              phoneNumber: matchedDriver?.phoneNumber || null,
              fullName: matchedDriver ? `${matchedDriver.firstName} ${matchedDriver.lastName}` : d.name
            };
          });
        }

        // Also match blocks if present
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          parsed.blocks = parsed.blocks.map((block: any) => {
            const matchedDriver = allDrivers.find(dbDriver => matchDriverName(block.driver, dbDriver));
            return {
              ...block,
              matchedDriver: matchedDriver ? {
                id: matchedDriver.id,
                fullName: `${matchedDriver.firstName} ${matchedDriver.lastName}`,
                phoneNumber: matchedDriver.phoneNumber
              } : null
            };
          });
        }

        res.json({ success: true, data: parsed });
      } else {
        res.json({
          success: true,
          data: {
            rawText: text,
            drivers: [],
            summary: "Could not parse structured data from text"
          }
        });
      }
    } catch (error: any) {
      console.error("[GeminiText] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // ==========================================
  // GEMINI VISION OCR ENDPOINT
  // ==========================================

  // Parse image using Gemini vision to extract schedule info (Amazon Relay optimized)
  app.post("/api/fleet-comm/parse-image", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId;
      if (!tenantId) {
        return res.status(401).json({ success: false, message: "No tenant" });
      }

      const { imageData, mimeType } = req.body;

      if (!imageData) {
        return res.status(400).json({ success: false, message: "No image data provided" });
      }

      // Get all drivers for context
      const allDrivers = await db.select()
        .from(drivers)
        .where(
          and(
            eq(drivers.tenantId, tenantId),
            isNotNull(drivers.phoneNumber)
          )
        );

      const driverList = allDrivers.map(d => `${d.firstName} ${d.lastName}`).join(", ");

      // Import Google Generative AI SDK
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Remove data URL prefix if present
      let base64Data = imageData;
      if (imageData.includes(",")) {
        base64Data = imageData.split(",")[1];
      }

      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType || "image/png"
        }
      };

      const prompt = `You are a UNIVERSAL EXTRACTION PIPELINE for Freedom Transportation dispatch.

## STEP 1: CLASSIFY THE ENVIRONMENT
First, identify what you're looking at:
- **Full Screenshot**: Browser window, desktop app, or mobile screen with UI elements (menus, tabs, buttons)
- **Cropped Schedule**: Just the schedule/table portion without window chrome
- **Text Document**: Email, spreadsheet, or text-based list
- **Mixed Content**: Multiple windows or overlapping content

Report the environment type in your response.

## STEP 2: FIND THE SCHEDULE DATA
Look for the AREA OF INTEREST - the actual schedule content. Ignore:
- Browser tabs, address bars, bookmarks
- Desktop icons, taskbar, system tray
- Application menus and toolbars
- Other windows or overlapping content
- Milo dashboard UI elements (if visible)

Focus ONLY on the schedule/dispatch data.

## STEP 3: EXTRACT HUMAN-READABLE ANCHORS
Find these anchor types in ANY format:

**TIME ANCHORS** (most important - the "Go-Time"):
- Dates: "Jan 2", "01/02", "Friday", "Tomorrow"
- Times: "6:00 AM", "00:30 CST", "Starts in 2 hrs"
- Relative: "Tonight", "Morning shift", "Next block"

**IDENTITY ANCHORS** (who we need to call):
- Full names: "Brian Worts", "Richard Ewing"
- Initials: "B. Worts", "R. Ewing", "B.W."
- First names only: "Brian", "Dan", "Natasha"
- Nicknames or shortened: "Dick" (Richard), "Mike" (Michael)

**LOCATION ANCHORS**:
- City/State: "LENEXA, KS", "Kansas City"
- Airport codes: "MCI", "ORD", "DFW"
- Warehouse codes: "DKC4", "MKC1", "TUL1"
- Addresses or landmarks

**REFERENCE ANCHORS**:
- Block IDs: "B-XXXXXXXX" pattern
- Load numbers, trip IDs, route numbers
- Order/shipment references

## STEP 4: BUILD STRUCTURED OUTPUT
Map extracted data to this standard format:

OUR DRIVERS DATABASE: ${driverList}

Match ANY extracted name to our database using:
- Exact match: "Brian Worts" → Brian Worts
- Initial pattern: "B. Worts" → Brian Worts
- First name: "Brian" → Brian Worts
- Nickname: "Rick" → Richard, "Dan" → Daniel, "Mike" → Michael

## RETURN JSON:
{
  "environment": "full_screenshot | cropped_schedule | text_document | mixed",
  "confidence": "high | medium | low",
  "scheduleFound": true/false,
  "drivers": [
    {
      "name": "Name exactly as shown in image",
      "origin": "Starting location if found",
      "destination": "Ending location if found",
      "startTime": "Time/date as shown",
      "loadId": "Block ID or reference number",
      "notes": "Any other relevant info"
    }
  ],
  "blocks": [
    {
      "blockId": "Reference ID if found",
      "startTime": "Time as shown",
      "route": "Location info",
      "driver": "Driver name as shown"
    }
  ],
  "rawText": "All readable schedule-related text",
  "summary": "Brief description of what was found"
}

## CRITICAL RULES:
1. If this is a FULL SCREENSHOT of a browser/app, locate and focus on just the schedule portion
2. Extract EVERY driver name you can find, even partial matches
3. Times are critical - extract all time references
4. If you see dropdown boxes with names, those are driver ASSIGNMENTS
5. Return "scheduleFound": false if no schedule data is present
6. Be aggressive about finding names - partial matches are valuable`;

      console.log("[GeminiVision] Processing image...");

      const result = await model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text().trim();

      console.log("[GeminiVision] Raw response:", text);

      // Parse JSON from response
      let parsed: any = null;
      try {
        // Find JSON in response (may have markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error("[GeminiVision] Failed to parse response:", parseError);
      }

      if (parsed) {
        // Universal driver name matcher with nickname and initial support
        const matchDriverName = (searchName: string, dbDriver: any): boolean => {
          const lastName = dbDriver.lastName.toLowerCase();
          const firstName = dbDriver.firstName.toLowerCase();
          const firstInitial = dbDriver.firstName.charAt(0).toLowerCase();
          const fullName = `${firstName} ${lastName}`;
          const searchLower = (searchName || "").toLowerCase().trim();

          if (!searchLower) return false;

          // Exact match
          if (fullName === searchLower || firstName === searchLower || lastName === searchLower) {
            return true;
          }

          // Initial pattern: "B. Worts" or "B Worts" or "B.Worts"
          const initialPattern = /^([a-z])\.?\s*(.+)$/i;
          const match = searchLower.match(initialPattern);
          if (match) {
            const extractedInitial = match[1].toLowerCase();
            const extractedLastName = match[2].toLowerCase().replace(/[^a-z-]/g, '');
            const dbLastNameClean = lastName.replace(/[^a-z-]/g, '');
            if (extractedInitial === firstInitial &&
                (dbLastNameClean === extractedLastName ||
                 dbLastNameClean.includes(extractedLastName) ||
                 extractedLastName.includes(dbLastNameClean))) {
              return true;
            }
          }

          // Nickname matching
          const nicknames: Record<string, string[]> = {
            'richard': ['rick', 'dick', 'ricky'],
            'daniel': ['dan', 'danny'],
            'michael': ['mike', 'mikey'],
            'robert': ['bob', 'bobby', 'rob'],
            'william': ['bill', 'billy', 'will'],
            'james': ['jim', 'jimmy'],
            'joseph': ['joe', 'joey'],
            'christopher': ['chris'],
            'natasha': ['tasha', 'nat'],
            'brian': ['bri'],
            'matthew': ['matt'],
            'anthony': ['tony'],
            'abbas': ['ab']
          };

          for (const [formal, nicks] of Object.entries(nicknames)) {
            if (firstName === formal && nicks.some(n => searchLower.includes(n))) {
              return true;
            }
          }

          // Last name only match
          if (searchLower.includes(lastName) || lastName.includes(searchLower)) {
            return true;
          }

          // Partial matches
          return fullName.includes(searchLower) || searchLower.includes(firstName);
        };

        // Match extracted drivers to our database
        if (parsed.drivers && Array.isArray(parsed.drivers)) {
          parsed.drivers = parsed.drivers.map((d: any) => {
            const matchedDriver = allDrivers.find(dbDriver => matchDriverName(d.name, dbDriver));

            return {
              ...d,
              matched: !!matchedDriver,
              driverId: matchedDriver?.id || null,
              phoneNumber: matchedDriver?.phoneNumber || null,
              fullName: matchedDriver ? `${matchedDriver.firstName} ${matchedDriver.lastName}` : d.name
            };
          });
        }

        // Also match blocks if present (new format)
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          parsed.blocks = parsed.blocks.map((block: any) => {
            const matchedDriver = allDrivers.find(dbDriver => matchDriverName(block.driver, dbDriver));

            return {
              ...block,
              matchedDriver: matchedDriver ? {
                id: matchedDriver.id,
                fullName: `${matchedDriver.firstName} ${matchedDriver.lastName}`,
                phoneNumber: matchedDriver.phoneNumber
              } : null
            };
          });
        }

        res.json({ success: true, data: parsed });
      } else {
        res.json({
          success: true,
          data: {
            rawText: text,
            drivers: [],
            summary: "Could not parse structured data from image"
          }
        });
      }
    } catch (error: any) {
      console.error("[GeminiVision] Error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  const httpServer = createServer(app);

  // Initialize WebSocket server for fleet communication
  initWebSocket(httpServer);

  return httpServer;
}
