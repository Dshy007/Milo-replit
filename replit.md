# Milo - AI-Powered Trucking Management Platform

## Overview

Milo is an AI-powered trucking operations management platform designed to streamline driver scheduling, DOT compliance, and fleet management. Its core purpose is to provide an intuitive interface for managing complex logistics, featuring an AI assistant for natural language interactions. The platform emphasizes efficient, data-dense information presentation within a Material Design 3-inspired interface. Milo aims to enhance operational efficiency, ensure regulatory compliance, and reduce administrative overhead in the trucking industry. Key capabilities include AI-driven schedule generation, special request management, workload tracking, and bulk data import.

## Recent Changes

### Unified Excel Import Workflow & Contract-Centric Schedules (November 2025)

Streamlined weekly schedule management by consolidating Excel import on the Start Times page and restructuring the Schedules view to mirror the contract-based layout.

**Navigation Simplification**:
- Removed redundant "CSV Import" and "Excel Import" sidebar items
- Kept "Import Data" page as backup option
- Primary workflow now starts from Start Times (Contracts) page

**Excel Import on Start Times Page**:
- Added "Import Weekly Assignments" button to Contracts page header
- Upload modal accepts Excel files (e.g., weekly roster spreadsheets)
- Backend parses Excel using `server/excel-import.ts`:
  - Extracts contract info from "Operator ID" column (format: "Solo1 Tractor_8")
  - Converts Excel date/time values to JavaScript Date objects
  - Auto-creates contracts based on start time and tractor assignments
  - Creates blocks with full validation (DOT compliance, overlaps, protected drivers)
  - Returns detailed import results (created/failed/warnings)
- Frontend cache invalidation ensures both Start Times and Schedules refresh automatically

**Restructured Schedules Page** (`client/src/pages/Schedules.tsx`):
- Simplified from 1745 lines to 295 lines
- Contract-centric grid layout:
  - **Rows**: Contracts (sorted by type and start time)
  - **Columns**: Week days (Sun-Sat)
  - **Cells**: Blocks and driver assignments for each contract/day
- Week navigation with Previous/Next buttons
- Fetches data from:
  - `GET /api/contracts` - All contracts (same as Start Times)
  - `GET /api/schedules/calendar?startDate=X&endDate=Y` - Blocks with assignments
- Displays contract details: start time, tractor ID, solo type, domicile
- Shows block IDs and driver names in day cells

**Core User Workflow**:
1. Navigate to Start Times page (permanent contract structure)
2. Click "Import Weekly Assignments" every Friday
3. Upload weekly roster Excel file
4. Contracts and blocks auto-created/updated
5. Navigate to Schedules page to view weekly assignments in grid format
6. Use week navigation to view past/future weeks

**Technical Implementation**:
- Excel parsing: XLSX library with robust date/time conversion
- Contract upsert: Matches by `startTime + tractorId + type`
- Block creation: Links to contracts, includes full timestamps
- Cache invalidation: Refreshes `/api/contracts` and `/api/schedules/calendar`
- End-to-end tested: Upload → Create → Display → Navigate

### Compliance Heatmap Dashboard (November 2025)

Implemented DOT compliance visualization system with exact sliding-window sweep algorithm for real-time driver workload monitoring.

**Backend (`server/compliance-heatmap.ts`)**:
- `generateComplianceHeatmap()` function with exact sliding-window calculation
- Evaluates compliance at all critical time points (assignment boundaries ± 24h/48h offsets)
- Supports Solo1 (24h window, 10h limit) and Solo2 (48h window, 20h limit) driver types
- Returns color-coded status: safe (green), warning (yellow, 90-100% of limit), violation (red, >100%)
- Sorts drivers by violations (descending), then warnings, then name

**API Endpoint**:
- `GET /api/compliance/heatmap/:startDate/:endDate` - Protected route with path parameters
- Returns structured data: `{ drivers: DriverSummary[], cells: HeatmapCell[], dateRange: string[] }`
- Validates date range (max 31 days)

**Frontend (`client/src/components/ComplianceHeatmap.tsx`)**:
- React component with color-coded driver×day grid
- Date range navigation (Previous Week / This Week / Next Week)
- Tooltips showing detailed compliance information per cell
- Legend explaining status colors and thresholds
- Integrated into Dashboard page as prominent compliance monitoring widget

**Technical Implementation**:
- Critical Points Algorithm: Evaluates windows at assignment start/end, derived offsets (±24h/48h), and day boundaries
- Catches violations at ANY point during the day, including midnight-crossing shifts
- O(drivers × assignments × critical_points) time complexity
- Filters to only points where windows overlap the evaluated day

### CSV Bulk Import System (November 2025)

Production-ready CSV/Excel bulk import with validation preview, DOT compliance checking, and multi-assignment conflict prevention.

**Features**:
- File upload with drag-and-drop support (CSV/Excel formats)
- Real-time validation preview with color-coded status (valid/warning/violation)
- DOT compliance checking during import (violations blocked, warnings allowed)
- Bulk commit with transaction safety
- Multi-assignment history tracking to prevent duplicate imports

**Implementation**:
- `server/csv-import.ts` - Validation and import logic with Zod schemas
- `client/src/pages/CSVImport.tsx` - React component with preview table
- Uses `rolling6-calculator.ts` for DOT compliance validation
- Differentiates warnings (90-100% of limit) from violations (>100%)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React and TypeScript, using Vite for a fast development experience. It features a component-based architecture leveraging Radix UI primitives customized with shadcn/ui and styled using Tailwind CSS, adhering to Material Design 3 principles. State management is handled by TanStack Query for server state and React Context for authentication. Wouter is used for client-side routing, and React Hook Form with Zod provides robust form handling and validation. The design prioritizes operational clarity and an AI-first interaction model.

### Backend Architecture

The backend is an Express.js application written in TypeScript, implementing a session-based REST API. It uses Zod for shared data validation schemas between client and server, `express-session` for session management, and `bcryptjs` for secure password handling. The API is designed with RESTful endpoints organized by resources, using middleware for authentication and authorization, and employing session-based authentication for its security benefits regarding session revocation.

### Data Storage Solutions

The project utilizes PostgreSQL, hosted on Neon for serverless capabilities, as its primary database. Drizzle ORM is employed for type-safe query building and migrations. The schema supports multi-tenancy with `tenantId` foreign keys for data isolation across core entities like Users, Drivers, Schedules, and Contracts. UUIDs are used for primary keys, and timestamp tracking (`createdAt`, `updatedAt`) is implemented for audit trails.

### Authentication and Authorization

The system uses session-based authentication with `express-session` and HTTP-only cookies. User authentication involves `bcryptjs` for password hashing. Authorization is managed via protected route middleware, checking `userId` and `tenantId` stored in the session. Security measures include environment variable-based session secrets, HTTPS enforcement, and tenant-scoped queries to prevent cross-tenant data access.

### AI Integration Architecture

Milo features an AI assistant powered by a function calling system for database operations, a vector database for semantic search and long-term memory, and an ML prediction engine. It bridges Node.js with a Python ML engine for predictions, uses semantic embeddings for contextual queries, and learns patterns from historical scheduling data. The AI-driven scheduling system incorporates DOT compliance (rolling 6-day patterns), protected driver rules, and real-time conflict detection and resolution. The architecture supports AI-driven schedule generation, workload queries, and swap suggestions.

## External Dependencies

### Third-Party Services

- **Neon Database**: Serverless PostgreSQL hosting.
- **Google Fonts**: Hosts "Inter" and "JetBrains Mono" font families.

### Key NPM Packages

- **UI & Components**: `@radix-ui/*`, `tailwindcss`, `class-variance-authority`, `cmdk`.
- **Data & State**: `@tanstack/react-query`, `drizzle-orm`, `@neondatabase/serverless`, `zod`.
- **Authentication**: `express-session`, `bcryptjs`.
- **Forms & Validation**: `react-hook-form`, `@hookform/resolvers`, `zod-validation-error`.
- **Development Tools**: `vite`, `tsx`, `esbuild`, `@replit/*`.