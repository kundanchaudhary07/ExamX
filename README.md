# ExamX — AI-Powered Examination Platform

An institutional online examination and proctoring platform featuring role-based dashboards (Admin, Teacher, Student), centered header navigation, real-time exam lifecycle control, server-side evaluation, result publication gates, candidate query adjudication, and audit logging.

---

## 1. Project Architecture & Directory Layout

```
project-root/
│
├── frontend/               # React 19 + TypeScript + Vite SPA
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/     # ExamXLogo, Header (Centered Role-Specific Navigation)
│   │   │   ├── dashboard/  # AdminDashboard, TeacherDashboard, StudentDashboard, TeacherExamScheduler
│   │   │   ├── landing/    # LandingPage (Frozen Home Page)
│   │   │   ├── Charts.tsx
│   │   │   └── ProctoringModule.tsx
│   │   ├── services/       # dbService (REST API client), geminiService (Backend AI proxy)
│   │   ├── App.tsx
│   │   ├── constants.ts
│   │   └── types.ts
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── backend/                # Node.js + Express + TypeScript + Mongoose API Service
│   ├── src/
│   │   ├── config/         # MongoDB and Environment Config
│   │   ├── controllers/    # Auth, User, Question, Exam Controllers
│   │   ├── middleware/     # JWT Auth, RBAC Guards, Error Handler
│   │   ├── models/         # User, Question, Exam, ExamAssignment, ExamAttempt, Result, StudentQuery, ProctoringEvent, AuditLog
│   │   ├── routes/         # /api/auth, /api/users, /api/questions, /api/question-bank, /api/ai, /api/exams, /api/student, /api/attempts, /api/results, /api/queries, /api/proctoring, /api/audit-logs
│   │   ├── services/       # Auth, User, Question, AiQuestion, Exam, Attempt, Result, Query, Proctoring, Audit Services
│   │   ├── app.ts          # Express Application Factory
│   │   └── server.ts       # Server Startup & Vite Dev Middleware
│   ├── scripts/
│   │   └── seed-admin.ts   # Idempotent Initial Admin Seed Script
│   └── tests/
│       ├── auth-rbac.test.ts             # Phase 1.1 Auth & RBAC Test Suite
│       ├── phase1-2-exam-core.test.ts    # Phase 1.2 Exam Core & Question Bank Test Suite
│       └── phase1-3-full-lifecycle.test.ts # Phase 1.3 Full Examination Lifecycle & Security Test Suite
│
├── docs/
│   ├── api/
│   │   └── API_DOCUMENTATION.md
│   ├── architecture/
│   │   └── SYSTEM_ARCHITECTURE.md
│   └── PHASE_1_3_VERIFICATION_REPORT.md
│
├── package.json
└── README.md
```

---

## 2. Examination Roles & RBAC Navigation

| Role | Header Navigation Modules | Scope & Permissions |
| :--- | :--- | :--- |
| **`ADMIN`** | `Dashboard`, `Teachers`, `Students`, `Exams`, `Question Bank`, `Results`, `Proctoring`, `Queries`, `Audit Logs`, `Settings` | Institutional governance, teacher & student provisioning, global exam & result oversight, audit log review. |
| **`TEACHER`** | `Dashboard`, `Students`, `Exams`, `Question Bank`, `AI Question Generation`, `Exam Monitoring`, `Results`, `Queries`, `Analytics`, `Profile` | Supervised student management, Question Bank authoring, AI draft review, exam scheduling & publishing, result publication, query resolution. |
| **`STUDENT`** | `Dashboard`, `Exams`, `Exam History`, `Results`, `Queries`, `Proctoring Status`, `Profile` | Assigned exam participation, server-timed attempts, published result viewing, and query submission. |

---

## 3. Phase 1.3 Real Examination Engine

1. **Question Bank (`/api/questions` & `/api/question-bank`)**:
   - Supports MCQ authoring with `questionText`, `options`, `correctOption`, `marks`, `negativeMarks`, `difficulty`, `subject`, `topic`, and teacher ownership isolation.
   - `correctOption` / `correctAnswer` and `explanation` are strictly stripped from all student-facing endpoints during active examinations.
2. **AI Question Generation (`/api/ai/questions/generate` & `/api/ai/status`)**:
   - Backend-only `GEMINI` (`gemini-3.8-flash`) and `GROQ` (`openai/gpt-oss-120b`) providers are selected with `AI_PROVIDER`; configure the matching key in the root environment. No provider key is exposed in frontend code or `VITE_*` variables, and provider failures do not fall back to another provider.
   - Generation counts accept whole numbers from 1 to 200. Each run persists a batch record linked to its questions; teachers see only their own batches and drafts, while admins can inspect all batches.
   - Syllabus-grounded structured drafts require explicit teacher review before approval moves them into the active Question Bank. Subjects are searchable and can be registered through the teacher/admin API.
3. **Exam & Assignment (`/api/exams`)**:
   - Controlled lifecycle: `DRAFT`, `SCHEDULED`, `LIVE`, `ENDED`, `PUBLISHED`, `CLOSED`, `ARCHIVED`.
   - Teachers can only assign students under their supervision (`managedBy`).
4. **Exam Attempts & Server Timer (`/api/attempts`)**:
   - Enforces `attemptLimit` (default `1`) on the backend.
   - Calculates `expiresAt` authoritatively from `startedAt + durationMinutes`. Expired attempts are automatically finalized server-side.
5. **Server-Side Scoring & Result Publication (`/api/results`)**:
   - Server evaluates `selectedOption` against `correctOption`, applying `marks` and `negativeMarks`. Client-supplied scores are ignored.
   - Results are created with `isPublished: false`. Students cannot view unpublished results (`403 Forbidden`) or another student's results (`403 Forbidden`).
6. **Proctoring, Queries & Audit Logs (`/api/proctoring`, `/api/queries`, `/api/audit-logs`)**:
   - Persistent MongoDB storage for real browser proctoring events, student queries, and administrative audit logs.

---

## 4. Running & Testing

```bash
# Start full-stack server on port 3000
npm run dev

# Typecheck frontend & backend
npm run lint

# Build frontend production bundle
npm run build

# Run backend test suites
npx tsx backend/tests/auth-rbac.test.ts
npx tsx backend/tests/phase1-2-exam-core.test.ts
npx tsx backend/tests/phase1-3-full-lifecycle.test.ts
```
