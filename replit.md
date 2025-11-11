# Milo - AI-Powered Trucking Management Platform

## Overview

Milo is a modern trucking operations management platform designed to streamline driver scheduling, DOT compliance tracking, and fleet management. The application features an AI-powered assistant (Milo) that enables natural language interaction for scheduling tasks, driver management, and operational queries. The platform emphasizes data-dense information presentation with an intuitive Material Design 3-inspired interface optimized for operational efficiency.

## User Preferences

Preferred communication style: Simple, everyday language.

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