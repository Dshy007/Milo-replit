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
  insertContractSchema, updateContractSchema,
  insertBlockSchema, updateBlockSchema,
  insertBlockAssignmentSchema,
  insertProtectedDriverRuleSchema, updateProtectedDriverRuleSchema,
  insertSpecialRequestSchema, updateSpecialRequestSchema
} from "@shared/schema";
import session from "express-session";
import { fromZodError } from "zod-validation-error";
import bcrypt from "bcryptjs";
import { benchContracts } from "./seed-data";
import multer from "multer";
import { validateBlockAssignment, normalizeSoloType } from "./rolling6-calculator";
import { subDays, parseISO } from "date-fns";
import { findSwapCandidates, getAllDriverWorkloads } from "./workload-calculator";

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
        secure: 'auto', // Auto-detect based on connection
        httpOnly: false, // Allow JS access for better mobile compatibility
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

  // Middleware to check authentication
  const requireAuth = (req: any, res: any, next: any) => {
    console.log('Auth check - Session ID:', req.sessionID, 'User ID:', req.session?.userId);
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

  // ==================== BLOCKS ====================
  
  app.get("/api/blocks", requireAuth, async (req, res) => {
    try {
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
        block,
        existingAssignments,
        protectedRules,
        allAssignments
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
                const allBlockAssignments = await dbStorage.getBlockAssignments(req.session.tenantId!);
                
                const validationResult = await validateBlockAssignment(
                  driver,
                  block,
                  existingAssignments,
                  protectedRules,
                  allBlockAssignments
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

  // ===== Special Requests Routes =====
  
  // GET /api/special-requests - List all special requests for tenant
  app.get("/api/special-requests", requireAuth, async (req, res) => {
    try {
      const tenantId = req.session.tenantId!;
      const { status, driverId, startDate, endDate } = req.query;

      let requests;
      
      if (status) {
        requests = await dbStorage.getSpecialRequestsByStatus(tenantId, status as string);
      } else if (driverId) {
        requests = await dbStorage.getSpecialRequestsByDriver(driverId as string);
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
      const { id } = req.params;
      const request = await dbStorage.getSpecialRequest(id);
      
      if (!request) {
        return res.status(404).json({ message: "Special request not found" });
      }
      
      // Verify tenant access
      if (request.tenantId !== req.session.tenantId) {
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
      
      const validation = insertSpecialRequestSchema.safeParse(req.body);
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

  const httpServer = createServer(app);
  return httpServer;
}
