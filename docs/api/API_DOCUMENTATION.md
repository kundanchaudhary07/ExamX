# REST API Documentation (Phase 1.3)

Base URL: `/api`

All protected endpoints require an `Authorization` header formatted as:
`Authorization: Bearer <jwt_token>`

---

## 1. System Health

### GET `/api/health`
Returns backend service status and MongoDB database connectivity.

---

## 2. Authentication (`/api/auth`)

- `POST /api/auth/login`: Authenticates `ADMIN`, `TEACHER`, or `STUDENT` using 8-digit `userId` and `password`.
- `POST /api/auth/signup/student`: Public, rate-limited student self-signup. The backend assigns the student ID, hashes the chosen password, and returns an authenticated student session; client-supplied role/ID fields are ignored.
- `GET /api/auth/me` (also `/api/users/me`): Returns the authenticated user profile (excluding `passwordHash`).

---

## 3. User Management (`/api/users`)

- `POST /api/users/teachers` (`ADMIN`): Provisions a Teacher (`1251xxxx`) with `FirstName@DOB-Year` initial password.
- `GET /api/users/teachers` (`ADMIN`): Lists all Teacher accounts.
- `PATCH /api/users/teachers/:userId` (`ADMIN`): Updates Teacher profile or status.
- `POST /api/users/teachers/:userId/reset-password` (`ADMIN`): Resets Teacher password.
- `POST /api/users/students` (`ADMIN`, `TEACHER`): Provisions a Student (`1261xxxx`) assigned to the creating/selected Teacher.
- `GET /api/users/students` (`ADMIN`, `TEACHER`): Lists all students (`ADMIN`) or supervised students (`TEACHER`).
- `PATCH /api/users/students/:userId` (`ADMIN`, `TEACHER`): Updates Student profile or status (enforces supervision ownership).
- `POST /api/users/students/:userId/reset-password` (`ADMIN`, `TEACHER`): Resets Student password.
- `PATCH /api/users/:userId/status` (`ADMIN`, `TEACHER`): Updates account status (`ACTIVE`, `INACTIVE`, `BLOCKED`).

---

## 4. Question Bank (`/api/questions` & `/api/question-bank`)

- `POST /api/questions` (`TEACHER`, `ADMIN`): Creates a validated MCQ in the Question Bank.
- `GET /api/questions` (`TEACHER`, `ADMIN`): Lists questions (Teacher sees own questions; Admin sees all).
- `GET /api/questions/:questionId` (`TEACHER`, `ADMIN`): Retrieves a single question with ownership check.
- `PATCH /api/questions/:questionId` (`TEACHER`, `ADMIN`): Updates a question with ownership check.
- `PATCH /api/questions/:questionId/status` (`TEACHER`, `ADMIN`): Updates question status (`ACTIVE`, `INACTIVE`, `ARCHIVED`).
- `DELETE /api/questions/:questionId` (`TEACHER`, `ADMIN`): Deletes or archives a question.

---

## 5. AI Question Generation (`/api/ai`)

- `GET /api/ai/status` (`TEACHER`, `ADMIN`): Reports the selected backend provider/model and whether generation is configured, ready, or pending review.
- `POST /api/ai/questions/generate` (`TEACHER`, `ADMIN`): Generates 1–200 validated, syllabus-grounded MCQ drafts using the backend provider selected by `AI_PROVIDER` (`GEMINI` or `GROQ`). Each successful request creates a persisted generation batch and associates its questions with that batch. Drafts remain pending until their owning teacher approves them; provider failures do not trigger cross-provider fallback.
- `GET /api/ai/generation-batches` (`TEACHER`, `ADMIN`): Lists batch metadata and live review counts. Teachers see only their own batches; admins see all batches. Historical runs are included only when a generation audit matches the exact teacher, syllabus, time window, and generated count; ambiguous records are not grouped.
- `GET /api/ai/generation-batches/:generationId/questions` (`TEACHER`, `ADMIN`): Lists questions associated with a batch, subject to teacher ownership. For a verified historical run, the response supplies a virtual generation ID without modifying stored question records.
- `GET /api/subjects` (`TEACHER`, `ADMIN`): Lists normalized subject suggestions from registered subjects and existing ExamX records.
- `POST /api/subjects` (`TEACHER`, `ADMIN`): Registers or returns a whitespace/case-normalized subject name.

---

## 6. Examinations (`/api/exams` & `/api/student/exams`)

- `POST /api/exams` (`TEACHER`, `ADMIN`): Creates a new exam in `DRAFT` status (and optionally attaches questions/students).
- `GET /api/exams` (`TEACHER`, `ADMIN`): Lists exams (Teacher sees own exams; Admin sees all).
- `GET /api/exams/:examId` (`TEACHER`, `ADMIN`): Retrieves exam details.
- `PATCH /api/exams/:examId` (`TEACHER`, `ADMIN`): Updates exam configuration or status.
- `PATCH /api/exams/:examId/status` (`TEACHER`, `ADMIN`): Transitions exam lifecycle status (`DRAFT`, `SCHEDULED`, `LIVE`, `ENDED`, `PUBLISHED`, `CLOSED`, `ARCHIVED`).
- `DELETE /api/exams/:examId` (`TEACHER`, `ADMIN`): Deletes an exam and its assignments.
- `POST /api/exams/:examId/questions` (`TEACHER`, `ADMIN`): Attaches Question Bank questions to an exam.
- `POST /api/exams/:examId/assign` (`TEACHER`, `ADMIN`): Assigns supervised students to an exam.
- `POST /api/exams/:examId/publish` (`TEACHER`, `ADMIN`): Validates prerequisites and publishes the exam.
- `POST /api/exams/:examId/close` (`TEACHER`, `ADMIN`): Closes an active exam.
- `GET /api/student/exams` (`STUDENT`): Lists published/live exams assigned to the authenticated student (without exposing answers).
- `GET /api/student/exams/:examId` (`STUDENT`): Retrieves sanitized student exam metadata.

---

## 7. Exam Attempts (`/api/attempts` & `/api/exams/:examId/attempts`)

- `POST /api/exams/:examId/attempts` (also `/api/student/exams/:examId/start`) (`STUDENT`): Starts or resumes an exam attempt, enforcing assignment, schedule window, and `attemptLimit`. Returns sanitized questions (without `correctOption` or `explanation`) and server-calculated `remainingSeconds`.
- `GET /api/attempts/:attemptId` (`STUDENT`, `TEACHER`, `ADMIN`): Retrieves attempt status and remaining time.
- `PATCH /api/attempts/:attemptId/answers` (`STUDENT`): Validates and saves student answers during an active attempt; auto-expires attempt if server timer has elapsed.
- `POST /api/attempts/:attemptId/submit` (`STUDENT`): Submits an active attempt, performs authoritative server-side scoring, and creates an unpublished `Result` record.

---

## 8. Results & Publication (`/api/results` & `/api/exams/:examId/results`)

- `GET /api/results` (`STUDENT`, `TEACHER`, `ADMIN`):
  - `STUDENT`: Returns ONLY published results belonging to the authenticated student.
  - `TEACHER`: Returns results for exams created by the teacher.
  - `ADMIN`: Returns all results.
- `GET /api/results/:resultId` (`STUDENT`, `TEACHER`, `ADMIN`): Retrieves a single result. Rejects student access with `403 Forbidden` if `isPublished === false` or if `studentId !== req.user.userId`.
- `PATCH /api/results/:resultId/publish` (`TEACHER`, `ADMIN`): Publishes an individual student result.
- `POST /api/exams/:examId/results/publish` (`TEACHER`, `ADMIN`): Publishes all evaluated results for an exam.

---

## 9. Proctoring Events (`/api/proctoring`)

- `POST /api/proctoring/events` (`STUDENT`): Records a real browser proctoring event (`TAB_SWITCH`, `WINDOW_BLUR`, `FULLSCREEN_EXIT`, `CAMERA_BLOCKED`, etc.) for the student's active attempt and updates attempt integrity metrics.
- `GET /api/proctoring/events` (`TEACHER`, `ADMIN`): Lists proctoring events for supervised exams (`TEACHER`) or all exams (`ADMIN`).

---

## 10. Student Queries (`/api/queries`)

- `POST /api/queries` (`STUDENT`): Creates a query linked to the authenticated student.
- `GET /api/queries` (`STUDENT`, `TEACHER`, `ADMIN`): Lists queries scoped by role ownership.
- `PATCH /api/queries/:queryId` (`TEACHER`, `ADMIN`): Resolves or rejects a student query with faculty response.

---

## 11. Audit Logs (`/api/audit-logs`)

- `GET /api/audit-logs` (`ADMIN`): Returns persistent security and lifecycle audit records from MongoDB.
