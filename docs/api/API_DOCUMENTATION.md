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

- `GET /api/ai/status` (`TEACHER`, `ADMIN`): Reports the Groq model and whether generation is configured, ready, or pending review.
- `POST /api/ai/syllabus/upload` (`TEACHER`, `ADMIN`): Extracts and validates the uploaded syllabus against the selected subject before persisting it. The response includes the unit headings discovered in the extracted document.
- `POST /api/ai/questions/generate` (`TEACHER`, `ADMIN`): Generates 1–200 validated, syllabus-grounded MCQ drafts using the backend-only Groq provider. `selectedUnits` may contain one or more exact unit headings returned by syllabus upload; generation is restricted to those unit sections. If omitted or empty, generation uses all syllabus content. Each successful request creates a persisted generation batch including the unit selection and associates its questions with that batch. Drafts remain pending until their owning teacher approves them.
- `GET /api/ai/generation-batches` (`TEACHER`, `ADMIN`): Lists batch metadata and live review counts. Teachers see only their own batches; admins see all batches. Historical runs are included only when a generation audit matches the exact teacher, syllabus, time window, and generated count; ambiguous records are not grouped.
- `GET /api/ai/generation-batches/:generationId/questions` (`TEACHER`, `ADMIN`): Lists questions associated with a batch, subject to teacher ownership. For a verified historical run, the response supplies a virtual generation ID without modifying stored question records.
- Approved questions from a listed generation batch can be selected in exam creation as a reusable set. Existing question records are reused; exam creation validates their subject and any declared course/semester context before attachment.
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

- `POST /api/exams/:examId/attempts` (also `/api/student/exams/:examId/start` and `/api/attempts/start`) (`STUDENT`): Starts or resumes an exam attempt, enforcing assignment, schedule window, and `attemptLimit`. Requires the authenticated browser's `X-ExamX-Device-Session` UUID. A partial unique index and server-side ownership checks enforce one in-progress attempt per student; a different device receives a conflict identifying the existing attempt rather than creating another. Returns sanitized questions (without `correctOption` or `explanation`) and server-calculated `remainingSeconds`.
- `GET /api/attempts/:attemptId` (`STUDENT`, `TEACHER`, `ADMIN`): Retrieves attempt status and remaining time. Student responses also include sanitized exam metadata and questions so suspended or resumed attempts can restore the same exam context without exposing answer keys.
- `GET /api/attempts/my` (`STUDENT`): Lists the authenticated student's attempts.
- `PATCH /api/attempts/:attemptId/answers` and `POST /api/attempts/:attemptId/save` (`STUDENT`): Saves validated answers and monitoring checkpoint (current question, camera, face, and fullscreen state) during an active attempt; auto-expires the attempt if server time has elapsed.
- `POST /api/attempts/:attemptId/heartbeat` (`STUDENT`): Persists the latest connection and monitoring heartbeat and returns server-authoritative remaining time.
- `POST /api/attempts/:attemptId/submit` (`STUDENT`): Submits an active attempt, performs authoritative server-side scoring, and creates an unpublished `Result` record.
- The fifth proctoring warning suspends, but does not terminate, an in-progress attempt. Its timer, answers, flags, reported questions, warning history, and current question remain attached to the same attempt; an approved faculty assistance request resumes that attempt.

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

- `POST /api/proctoring/events` (`STUDENT`): Records a real browser proctoring event (`TAB_SWITCH`, `WINDOW_BLUR`, `FULLSCREEN_EXIT`, `CAMERA_BLOCKED`, face events, etc.) for the student's active attempt and updates attempt integrity metrics. The fifth warning suspends the attempt pending faculty review.
- `GET /api/proctoring/events` (`TEACHER`, `ADMIN`): Lists proctoring events for supervised exams (`TEACHER`) or all exams (`ADMIN`).
- `POST /api/proctoring/unblock-requests` (`STUDENT`): Creates an assistance request for the authenticated student's suspended attempt; student, exam, attempt, and assigned faculty are validated by the backend.
- `GET /api/proctoring/unblock-requests` (`STUDENT`, `TEACHER`, `ADMIN`): Lists only the caller's own request, requests assigned to the faculty member, or all requests for an administrator.
- `PATCH /api/proctoring/unblock-requests/:requestId` (`TEACHER`, `ADMIN`): Audits an `APPROVED` or `REJECTED` decision. Approval resumes the existing, unexpired attempt without resetting its checkpoint. Rejection submits and evaluates the stored answers on that same attempt and emits a realtime submission update.

---

## 10. Student Queries (`/api/queries`)

- `POST /api/queries` (`STUDENT`): Creates a question report. The backend derives student, exam, attempt, question text and options, selected answer, question number, and assigned faculty; the student supplies the issue category and description.
- `GET /api/queries` (`STUDENT`, `TEACHER`, `ADMIN`): Lists only the student's own queries, queries assigned to the faculty member, or all queries for an administrator.
- `PATCH /api/queries/:queryId/resolve` (`TEACHER`, `ADMIN`): Resolves a query with one of `VALID_QUESTION`, `OUT_OF_SYLLABUS`, `INVALID_QUESTION`, `CORRECT_ANSWER_CHANGED`, `GRACE_MARKS`, or `EXCLUDE_QUESTION`, plus resolution notes. Answer corrections, grace marks, and exclusions update the existing `Result`/evaluation flow; each resolution is audited.
- `PATCH /api/queries/:queryId` (`TEACHER`, `ADMIN`): Backward-compatible query resolution endpoint.

The existing Socket.IO connection emits role-scoped updates including `query.created`, `query.updated`, `query.resolved`, `unblock.created`, `unblock.updated`, `attempt.suspended`, `attempt.resumed`, `monitoring.updated`, `proctoring.event`, and `result.updated`. Dashboards reload authoritative backend state after reconnect.

---

## 11. Audit Logs (`/api/audit-logs`)

- `GET /api/audit-logs` (`ADMIN`): Returns persistent security and lifecycle audit records from MongoDB.
