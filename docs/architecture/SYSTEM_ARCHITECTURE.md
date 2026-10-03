# System Architecture Documentation

## Overview
The AI-Powered Examination Platform is an enterprise-grade assessment system architected for ~100 concurrent students per examination session. It enforces strict academic integrity, role-based access control (RBAC), and automated evaluation workflows.

```
                    ┌─────────────────────────┐
                    │      React SPA /        │
                    │   Vite Frontend UI      │
                    │  (Port 3000 / Web Host) │
                    └───────────┬─────────────┘
                                │ HTTP / JSON API
                                ▼
                    ┌─────────────────────────┐
                    │     Express Backend     │
                    │  (Authentication & API) │
                    └───────────┬─────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│   Admin Portal   │  │  Teacher Portal  │  │  Student Portal  │
│  (User & Access  │  │ (Exams, Bank &   │  │  (Proctored Exam │
│   Management)    │  │  Evaluations)    │  │    Execution)    │
└──────────────────┘  └──────────────────┘  └──────────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │    MongoDB / Mongoose   │
                    │     (User & Exam Data)  │
                    └─────────────────────────┘
```

## Directory Separation
The repository is split into isolated frontend and backend workspaces:
- `frontend/`: Single Page Application (React 19, TypeScript, Tailwind CSS, Vite)
  - `src/`: UI components, pages, hooks, state, and API services.
  - `public/`: Static assets and favicon.
  - `vite.config.ts`, `tsconfig.json`, `package.json`.
- `backend/`: RESTful API Service (Express, TypeScript, Mongoose)
  - `src/config/`: Environment and MongoDB connection modules.
  - `src/controllers/`: Route handlers for authentication and user management.
  - `src/middleware/`: JWT verification, RBAC role guard, rate limiting, and centralized error handling.
  - `src/models/`: Mongoose schemas (User with role and status enforcement).
  - `src/routes/`: API endpoint definitions (`/api/auth`, `/api/users`).
  - `src/services/`: Business logic layer.
  - `src/utils/`: Safe logger, bcrypt hashing (12 rounds), JWT tokens.
  - `scripts/`: Idempotent seed scripts (Initial Admin setup).
  - `tests/`: Automated unit & RBAC integration tests.
  - `package.json`, `tsconfig.json`, `.env.example`.
- `docs/`: Technical and API specifications.

## Security Baseline
1. **Authentication**: ID + Password authentication exclusively. No third-party OAuth or open self-registration.
2. **Password Security**: Bcrypt with salt rounds = 12. Password hashes are never logged, returned, or exposed to the frontend.
3. **Role-Based Access Control**:
   - `ADMIN`: Full authority to manage teachers and students (create, activate, deactivate, password resets).
   - `TEACHER`: Manages assigned students and examination lifecycle.
   - `STUDENT`: Read-only access to assigned examinations and results.
4. **Network & App Protection**: Helmet security headers, CORS origin filtering, and rate limiting on sensitive routes.
