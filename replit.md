# Milo - AI-Powered Trucking Management Platform

## Overview

Milo is a modern trucking operations management platform designed to streamline driver scheduling, DOT compliance tracking, and fleet management. The application features an AI-powered assistant (Milo) that enables natural language interaction for scheduling tasks, driver management, and operational queries. The platform emphasizes data-dense information presentation with an intuitive Material Design 3-inspired interface optimized for operational efficiency.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes

### Phase 1: Special Requests System (November 12, 2025)

**Completed**: Full Special Requests workflow with workload tracking, swap candidate finding, and manual approval system.

**Key Features Implemented (Tasks 1-5)**:
- Database Schema: `special_requests` table with requestType ('time_off' | 'swap'), driver, affectedDate, affectedBlockId, reason, status (pending/approved/rejected), swap candidate tracking, review audit trail
- Workload Calculator: Tracks days worked per week (Sunday-Saturday), calculates total hours, determines workload levels (ideal=4 days, warning=5, critical=6+, underutilized<4)
- Swap Candidate Finder: Validates rolling-6 compliance, checks protected driver rules, ranks candidates by compliance status → workload level → days worked
- API Routes: POST /api/special-requests (submit), GET /api/special-requests (list with filters), PATCH approve/reject, GET /api/swap-candidates/:blockId, GET /api/workload-summary
- Special Requests UI: Tabbed view (Pending/Approved/Rejected), submission form (time_off/swap types), manual approve/reject buttons, swap candidates dialog with compliance + workload badges

**Critical Bug Fixes**:
- Fixed parseISO bug: Drizzle returns Date objects, not strings. Replaced `parseISO(block.startTimestamp)` with `new Date(block.startTimestamp)` throughout workload-calculator.ts
- Fixed tenantId validation: Backend now adds tenantId from session before validation (not passed from client)

**Architecture Decisions**:
- Workload tracking uses Sunday-Saturday week boundaries (DOT compliance standard)
- Protected driver rules: Never reassign blocks for Isaac Kiragu (Fridays), Firas IMAD Tahseen (Sat/Sun/Mon Solo1 @ 16:30), Tareef THAMER Mahdi (Sat/Sun Solo1 @ 17:30)
- Load balancing color system: 4 days/week = ideal (green), 5 days = overtime warning (yellow), 6 days = critical overload (red)
- Swap candidate ranking: Compliance status first (compliant > warning), then workload level (underutilized > ideal > warning > critical), then days worked (fewer is better)
- Manual approval required: Cannot auto-approve special requests due to compliance complexity

**Testing Coverage**:
- End-to-end test verified: Submit request → Pending tab → Approve/Reject workflow → Status updates → Correct tab navigation
- Test data: Created time-off requests, verified approval moves to Approved tab, rejection moves to Rejected tab
- Verified UI badges: Time Off/Swap type badges, Pending/Approved/Rejected status badges
- Server logs confirmed: POST 200, PATCH 200 for approve/reject operations

**Files Created**:
- server/workload-calculator.ts: Days worked calculator, hours worked calculator, workload summary, swap candidate finder
- client/src/pages/SpecialRequests.tsx: Full UI with tabs, submission form, approve/reject workflow

**Files Modified**:
- shared/schema.ts: Added special_requests table with check constraints for requestType and status
- server/storage.ts: Added IStorage methods for special requests CRUD
- server/db-storage.ts: Implemented special requests storage methods
- server/routes.ts: Added 6 API routes for special requests workflow

**Task 6 - Weekly Availability Tally (Completed November 12, 2025)**:
- API: GET /api/workload-summary/range endpoint with start/end date params
- Returns workload data for all drivers across all weeks in range: {driverId, driverName, weekStartIso, daysWorked, workloadLevel, totalHours, blockIds}
- Tally View UI: Driver × Week grid (6 weeks: current + next 5)
- Color-coded cells: Blue (underutilized <4 days), Green (ideal 4 days), Yellow (warning 5 days), Red (critical 6+ days)
- PTO badges displayed for approved time-off requests
- Legend explains color codes
- Sticky first column for horizontal scrolling
- Navigation (prev/next/today) advances currentDate and recalculates 6-week window
- Critical bug fix: React Query key corrected to pass query params as object: `queryKey: [path, { start, end }]`

**Task 7 - Integrate Workload into Calendar (Completed November 12, 2025)**:
- Added workload data fetching for calendar views (week/month) using /api/workload-summary/range
- Created workloadMap lookup: `workloadMap[driverId][weekStartIso]` for O(1) access
- Workload badges display next to driver names on block cards showing "{daysWorked}d"
- Color-coded badges: Green (ideal 4 days), Yellow (warning 5 days), Red (critical 6+ days), Blue (underutilized <4 days)
- Critical border highlighting: Red border-2 on block cards when driver has 6+ day workload
- Helper functions: getWorkloadBadgeVariant, getWorkloadBadgeColor, getDriverWorkload
- Normalization fix: weekStartIso format handling (ISO timestamp → yyyy-MM-dd) for consistent lookups
- Graceful handling of missing workload data (no badge displayed)
- Critical bug fix: Replaced ALL parseISO(block.startTimestamp) with new Date(block.startTimestamp) for Drizzle Date object compatibility

**Phase 1 Complete**: Special Requests + Workload Tracking + Calendar Integration

**Phase 2: Auto-Build Next Week**

**Task 8 - Pattern Learning Engine (Completed November 12, 2025)**:
- New database tables: `assignment_patterns` (pattern cache), `auto_build_runs` (suggestion batches)
- Pattern Learning (`server/pattern-engine.ts`):
  - Analyzes 12 weeks of historical assignments with exponential decay (4-week half-life)
  - Generates normalized block signatures: "contractId_soloType_startTime_dayOfWeek_tractor"
  - Calculates confidence scores per driver-block pattern (0-1 range)
  - Confidence thresholds: High (≥0.5), Medium (0.35-0.5), Low (<0.35)
- Auto-Build Engine (`server/auto-build-engine.ts`):
  - Composite scoring: pattern (50%) + workload (30%) + compliance (20%)
  - Protected driver pre-assignment (Isaac Fridays, Firas/Tareef weekends)
  - Workload balancing: Target 4-5 days, max 6 days hard limit
  - DOT compliance validation via rolling-6 calculator
  - Handles edge cases: new drivers, new blocks, insufficient history
- API Endpoints:
  - POST /api/patterns/recompute: Recompute patterns from historical data
  - GET /api/patterns/stats: Get pattern statistics
  - POST /api/auto-build/preview: Generate suggestions for target week
  - GET /api/auto-build/runs: Get all auto-build runs
  - POST /api/auto-build/commit: Commit approved suggestions

**Next Steps**:
- Task 9: Auto-Build Review UI (display suggestions, manual adjustments, bulk approve)
- Task 10: Milo AI Integration (conversational interface for workload queries + suggestions)

**Next Steps (Phase 3)**:
- Task 11: Milo AI Integration (OpenAI function calling for workload queries + swap suggestions)
- Task 12: Overtime Warnings (fairness scoring, utilization report)
- Task 13: Comprehensive end-to-end testing across all phases

### Phase 2 Task 4 - Dashboard Sidebar Integration (November 11, 2025)

**Completed**: Integrated Shadcn sidebar navigation system for authenticated routes.

**Key Features Implemented**:
- AppSidebar component with navigation links (Dashboard, Drivers, Schedules, Routes, AI Assistant)
- ProtectedLayout wrapper using SidebarProvider for authenticated routes
- SidebarTrigger button in dashboard header for collapse/expand functionality
- User info display in sidebar footer (username, email) with logout button
- Active route highlighting using wouter's useLocation hook
- Built-in keyboard shortcut (Cmd/Ctrl+B) for sidebar toggle via Shadcn
- Responsive mobile/desktop behavior handled by SidebarProvider

**Critical Bug Fix - Session Cookie Persistence**:
- Added `credentials: "include"` to ALL fetch requests in auth.tsx
- Fixed issue where login/signup would succeed but session wouldn't persist on navigation
- Session cookies now properly sent with requests for checkAuth, login, signup, and logout
- TanStack Query cache cleared on logout to prevent stale protected data exposure

**Architecture**:
- Sidebar only renders for protected routes (/dashboard and future protected pages)
- Public routes (/, /login, /signup) render without ProtectedLayout/sidebar
- Navigation links include comprehensive data-testid attributes for e2e testing
- Logout function clears both session and queryClient cache before redirect

**Testing Coverage**:
- Comprehensive e2e test covering signup → login → sidebar visibility → navigation → logout → protected route access
- All navigation elements have data-testid: nav-dashboard, nav-drivers, nav-schedules, nav-routes, nav-chat
- User info elements: text-user-name, text-user-email
- Action buttons: button-logout, button-sidebar-toggle

**Files Modified**:
- Created: client/src/components/app-sidebar.tsx
- Modified: client/src/App.tsx (added ProtectedLayout, SidebarProvider integration)
- Modified: client/src/lib/auth.tsx (added credentials: "include", queryClient.clear() on logout)
- Modified: client/src/pages/Dashboard.tsx (removed duplicate header, cleaned up layout)

**Next Steps**: 
- Task 5: Implement Drivers page with CRUD functionality
- Task 6: Build Schedules page with calendar view
- Task 7: Create AI Chat interface
- Task 8: Add CSV/Excel import functionality

## System Architecture

### Frontend Architecture

**Framework Stack**: React with TypeScript, Vite build system

The frontend follows a component-based architecture with a focus on reusability and type safety:

- **UI Components**: Radix UI primitives with shadcn/ui design system customization
- **Styling**: Tailwind CSS with custom design tokens following Material Design 3 principles
- **State Management**: TanStack Query (React Query) for server state, React Context for authentication
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod schema validation

**Design System Decisions**:
- Chose Material Design 3 + Linear-inspired aesthetics for operations-focused clarity over decorative elements
- Typography: Inter for UI text, JetBrains Mono for data/timestamps
- Spacing system based on Tailwind's 2/4/8/12/16 units for consistent hierarchy
- AI-first interface pattern with chat as primary interaction method

**Trade-offs**: 
- Radix UI provides accessibility and customization flexibility but requires more initial setup than pre-built component libraries
- Wouter chosen over React Router for smaller bundle size, sufficient for current routing needs
- TanStack Query handles caching and server synchronization but adds complexity for simple data fetching scenarios

### Backend Architecture

**Framework Stack**: Express.js with TypeScript, Node.js runtime

The backend implements a session-based REST API architecture:

- **API Layer**: Express routes with session-based authentication
- **Data Validation**: Zod schemas shared between client and server
- **Session Management**: express-session with configurable session store
- **Password Security**: bcryptjs for hashing and verification

**API Design Decisions**:
- RESTful endpoints organized by resource (users, drivers, trucks, routes, schedules, loads, contracts)
- Session-based auth chosen over JWT for simpler server-side session management and revocation
- Shared schema definitions between client/server prevent validation drift
- Middleware pattern for authentication checks across protected routes

**Trade-offs**:
- Session-based auth requires server-side state but provides better security for session revocation
- REST over GraphQL chosen for simpler implementation and better caching with standard HTTP
- Express middleware chain provides flexibility but can become difficult to trace in complex applications

### Data Storage Solutions

**Database**: PostgreSQL via Neon serverless

**ORM**: Drizzle ORM with type-safe query builder

**Schema Design**:
- Multi-tenant architecture with `tenantId` foreign keys for data isolation
- Core entities: Users, Tenants, Drivers, Trucks, Routes, Contracts, Schedules, Loads
- Timestamp tracking (createdAt, updatedAt) for audit trails
- Array types for certifications and flexible data storage

**Database Decisions**:
- Drizzle ORM chosen for excellent TypeScript support and migration system
- Neon serverless PostgreSQL for connection pooling and serverless compatibility
- Multi-tenant single-database approach with tenant isolation at query level
- UUID primary keys for distributed system compatibility

**Trade-offs**:
- Single database multi-tenancy simpler to manage but requires careful query filtering
- Drizzle's type safety excellent but migration rollback capabilities limited vs Prisma
- PostgreSQL arrays convenient but may complicate querying complex certification data

### Authentication and Authorization

**Strategy**: Session-based authentication with server-side session storage

**Implementation**:
- Login/signup endpoints with bcrypt password hashing
- Express session middleware with HTTP-only cookies
- Session data stores userId and tenantId for request context
- Protected route middleware pattern for authorization
- React Context provider for client-side auth state

**Security Considerations**:
- SESSION_SECRET environment variable required for session signing
- Password hashing with bcrypt before database storage
- HTTP-only cookies prevent XSS access to session tokens
- HTTPS enforcement in production via secure cookie flag
- Tenant-scoped queries prevent cross-tenant data access

### AI Integration Architecture

**Milo AI Assistant**: Natural language interface for operations management

Based on documentation references, the AI system implements:

- Function calling system for database operations (11+ available functions)
- Vector database for semantic search and long-term memory
- ML prediction engine integration via child process spawning
- Command processing pipeline: User input → tRPC → AI Scheduler → LLM → Function execution
- Context-aware scheduling with rolling 6-day DOT compliance patterns
- Protected driver rules enforcement (no manual override required)

**Integration Approach**:
- Bridges Node.js backend with Python ML engine for predictions
- Semantic embeddings for contextual queries beyond keyword matching
- Pattern learning from historical scheduling data
- Real-time conflict detection and resolution suggestions

## External Dependencies

### Third-Party Services

**Neon Database**: Serverless PostgreSQL hosting
- Connection pooling and scaling handled automatically
- WebSocket constructor override required for serverless compatibility (`ws` package)

**Google Fonts**: Typography hosting
- Inter font family for UI components
- JetBrains Mono for monospaced data display

### Key NPM Packages

**UI & Components**:
- `@radix-ui/*`: Headless UI primitives (18+ component packages)
- `tailwindcss`: Utility-first CSS framework
- `class-variance-authority`: Type-safe component variants
- `cmdk`: Command palette component

**Data & State**:
- `@tanstack/react-query`: Server state management and caching
- `drizzle-orm`: Type-safe SQL query builder
- `@neondatabase/serverless`: Neon database driver
- `zod`: Schema validation and type inference

**Authentication**:
- `express-session`: Session management middleware
- `bcryptjs`: Password hashing
- `connect-pg-simple`: PostgreSQL session store (available but not actively configured)

**Forms & Validation**:
- `react-hook-form`: Form state management
- `@hookform/resolvers`: Zod resolver integration
- `zod-validation-error`: User-friendly error formatting

**Development Tools**:
- `vite`: Fast build tool and dev server
- `tsx`: TypeScript execution for Node.js
- `esbuild`: Production bundling for server code
- `@replit/*`: Replit-specific development plugins

**Build Configuration**:
- TypeScript with strict mode enabled
- ESM module system throughout
- Path aliases for clean imports (@/, @shared/, @assets/)
- Separate client and server build outputs