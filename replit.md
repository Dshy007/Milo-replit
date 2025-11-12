# Milo - AI-Powered Trucking Management Platform

## Overview

Milo is an AI-powered trucking operations management platform designed to streamline driver scheduling, DOT compliance, and fleet management. Its core purpose is to provide an intuitive interface for managing complex logistics, featuring an AI assistant for natural language interactions. The platform emphasizes efficient, data-dense information presentation within a Material Design 3-inspired interface. Milo aims to enhance operational efficiency, ensure regulatory compliance, and reduce administrative overhead in the trucking industry. Key capabilities include AI-driven schedule generation, special request management, workload tracking, and bulk data import.

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