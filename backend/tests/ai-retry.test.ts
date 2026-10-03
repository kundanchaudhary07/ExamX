import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  AiQuestionService,
  callGeminiWithTransientRetries,
  GeminiContentClient,
  GeminiRetryHooks
} from '../src/services/ai.service';
import { Question } from '../src/models/Question';
import { Syllabus } from '../src/models/Syllabus';
import { JwtUserPayload } from '../src/types/auth.types';

function providerError(status: number, code = 'UNAVAILABLE'): Error & { status: number; code: string } {
  return Object.assign(new Error(`provider status ${status}`), { status, code });
}

function retryHooks(delays: number[]): GeminiRetryHooks {
  return {
    wait: async (milliseconds) => { delays.push(milliseconds); },
    random: () => 0
  };
}

const providerParams = {
  syllabusId: 'SYL-retry-unit',
  subject: 'Operating Systems',
  topic: 'Scheduling',
  course: 'B.Tech CSE',
  semester: 'Semester 4',
  count: 1,
  marks: 2,
  difficulty: 'MEDIUM' as const,
  syllabusText: 'UNIT III: Process scheduling uses priorities and time slices. Preemptive scheduling interrupts a running process. Non-preemptive scheduling lets a process continue until completion or blocking.'
};

async function run(): Promise<void> {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'GEMINI';
  process.env.GEMINI_API_KEY = 'test-only-retry-placeholder';

  try {
    // 1. 503 → retry → success
    {
      let calls = 0;
      const delays: number[] = [];
      const result = await callGeminiWithTransientRetries(async () => {
        calls += 1;
        if (calls === 1) throw providerError(503, 'UNAVAILABLE');
        return 'success-on-second-attempt';
      }, retryHooks(delays));
      assert.equal(result, 'success-on-second-attempt');
      assert.equal(calls, 2, '1. 503 then success must use two total attempts');
      assert.deepEqual(delays, [1000]);
    }

    // 2. 503 → 503 → success
    {
      let calls = 0;
      const delays: number[] = [];
      const result = await callGeminiWithTransientRetries(async () => {
        calls += 1;
        if (calls < 3) throw providerError(503, 'UNAVAILABLE');
        return 'success-on-third-attempt';
      }, retryHooks(delays));
      assert.equal(result, 'success-on-third-attempt');
      assert.equal(calls, 3, '2. two 503 responses then success must stop after the third attempt');
      assert.deepEqual(delays, [1000, 2000]);
    }

    // 3. 503 → 503 → 503 → final 503
    {
      let calls = 0;
      const delays: number[] = [];
      await assert.rejects(
        () => callGeminiWithTransientRetries(async () => {
          calls += 1;
          throw providerError(503, 'UNAVAILABLE');
        }, retryHooks(delays)),
        (error: any) => error.status === 503,
        '3. Three 503s must surface the final provider error'
      );
      assert.equal(calls, 3);
      assert.deepEqual(delays, [1000, 2000]);

      // Verify that generateQuestionsForReview wraps exhausted 503s into AI_GENERATION_TEMPORARILY_UNAVAILABLE
      let genCalls = 0;
      const mockClient: GeminiContentClient = {
        models: {
          generateContent: async () => {
            genCalls += 1;
            throw providerError(503, 'UNAVAILABLE');
          }
        }
      };
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(providerParams, mockClient, retryHooks([])),
        (error: any) =>
          error.statusCode === 503 &&
          error.code === 'AI_GENERATION_TEMPORARILY_UNAVAILABLE' &&
          error.message === 'Gemini is temporarily unavailable due to high demand. Please try again in a moment.'
      );
      assert.equal(genCalls, 3);
    }

    // 4. 429 → retry
    {
      let calls = 0;
      const delays: number[] = [];
      const result = await callGeminiWithTransientRetries(async () => {
        calls += 1;
        if (calls === 1) throw providerError(429, 'RESOURCE_EXHAUSTED');
        return 'recovered-after-429';
      }, retryHooks(delays));
      assert.equal(result, 'recovered-after-429');
      assert.equal(calls, 2, '4. 429 rate limit then success must use two attempts');
      assert.deepEqual(delays, [1000]);
    }

    // 5. 400 → no retry
    {
      let calls = 0;
      const delays: number[] = [];
      await assert.rejects(
        () => callGeminiWithTransientRetries(async () => {
          calls += 1;
          throw providerError(400, 'BAD_REQUEST');
        }, retryHooks(delays)),
        (error: any) => error.status === 400
      );
      assert.equal(calls, 1, '5. HTTP 400 must not be retried');
      assert.deepEqual(delays, []);
    }

    // 6. 401 → no retry
    {
      let calls = 0;
      const delays: number[] = [];
      await assert.rejects(
        () => callGeminiWithTransientRetries(async () => {
          calls += 1;
          throw providerError(401, 'UNAUTHENTICATED');
        }, retryHooks(delays)),
        (error: any) => error.status === 401
      );
      assert.equal(calls, 1, '6. HTTP 401 must not be retried');
      assert.deepEqual(delays, []);
    }

    // 7. 403 → no retry
    {
      let calls = 0;
      const delays: number[] = [];
      await assert.rejects(
        () => callGeminiWithTransientRetries(async () => {
          calls += 1;
          throw providerError(403, 'PERMISSION_DENIED');
        }, retryHooks(delays)),
        (error: any) => error.status === 403
      );
      assert.equal(calls, 1, '7. HTTP 403 must not be retried');
      assert.deepEqual(delays, []);
    }

    // 8. invalid structured response → no fake fallback
    {
      let calls = 0;
      const client: GeminiContentClient = {
        models: {
          generateContent: async () => {
            calls += 1;
            return { text: '{malformed JSON' };
          }
        }
      };
      await assert.rejects(
        () => AiQuestionService.generateQuestionsForReview(providerParams, client, retryHooks([])),
        (error: any) => error.code === 'AI_INVALID_RESPONSE' && error.statusCode === 502
      );
      assert.equal(calls, 1, '8. Malformed model output must not be retried or fall back to fake questions');
    }

    // 9. duplicate generation protection
    {
      const dupTeacher: JwtUserPayload = {
        id: `dup-test-${Date.now()}`,
        userId: `125_dup_${Date.now()}`,
        name: 'Duplicate Test Teacher',
        role: 'TEACHER'
      };

      let releaseSlowCall!: () => void;
      const slowCallBlocker = new Promise<void>((resolve) => {
        releaseSlowCall = resolve;
      });

      const slowClient: GeminiContentClient = {
        models: {
          generateContent: async () => {
            await slowCallBlocker;
            return {
              text: JSON.stringify([
                {
                  questionText: 'What is preemptive scheduling?',
                  subject: providerParams.subject,
                  course: providerParams.course,
                  semester: providerParams.semester,
                  topic: providerParams.topic,
                  syllabusUnit: 'UNIT III',
                  syllabusTopic: 'Process scheduling',
                  sourceReference: 'UNIT III: Process scheduling uses priorities and time slices.',
                  difficulty: 'MEDIUM',
                  options: [
                    { id: 'A', text: 'An OS mechanism allowing running process interruption' },
                    { id: 'B', text: 'A process that never yields control' },
                    { id: 'C', text: 'Hardware-only task execution' },
                    { id: 'D', text: 'Non-terminating batch job' }
                  ],
                  correctOption: 'A',
                  marks: 2,
                  explanation: 'Preemptive scheduling interrupts executing tasks based on priorities.'
                }
              ])
            };
          }
        }
      };

      // Connect to db temporarily for duplicate generation lifecycle check
      const mongoUri = process.env.MONGODB_URI;
      assert(mongoUri, 'MONGODB_URI must target an isolated test database for duplicate protection check');
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      }

      const dupSyllabusId = `SYL-dup-${Date.now()}`;
      await Syllabus.create({
        syllabusId: dupSyllabusId,
        uploadedBy: dupTeacher.userId,
        uploadedByRole: 'TEACHER',
        course: providerParams.course,
        semester: providerParams.semester,
        subject: providerParams.subject,
        fileName: 'dup-test-syllabus.txt',
        fileType: 'TXT',
        charCount: providerParams.syllabusText.length,
        wordCount: providerParams.syllabusText.split(/\s+/).length,
        extractedText: providerParams.syllabusText
      });

      try {
        // Start first generation in flight
        const firstGenPromise = AiQuestionService.generateQuestions(
          { ...providerParams, syllabusId: dupSyllabusId },
          dupTeacher,
          slowClient,
          retryHooks([])
        );

        // Verify active generation status
        assert.equal(AiQuestionService.isUserGenerating(dupTeacher.userId), true);
        assert.equal(AiQuestionService.getStatus().status, 'GENERATING');

        // Second submission while first is still generating must be rejected with 409
        await assert.rejects(
          () => AiQuestionService.generateQuestions(
            { ...providerParams, syllabusId: dupSyllabusId },
            dupTeacher,
            slowClient,
            retryHooks([])
          ),
          (error: any) => error.statusCode === 409 && error.code === 'AI_GENERATION_IN_PROGRESS',
          '9. Duplicate generation request while active must be rejected with 409 AI_GENERATION_IN_PROGRESS'
        );

        // Release first generation
        releaseSlowCall();
        const firstResult = await firstGenPromise;
        assert.equal(firstResult.generated.length, 1);
        assert.equal(AiQuestionService.isUserGenerating(dupTeacher.userId), false);
      } finally {
        await Question.deleteMany({ syllabusId: dupSyllabusId });
        await Syllabus.deleteOne({ syllabusId: dupSyllabusId });
        AiQuestionService.clearActiveGenerations();
      }
    }

    // 10. no questions are persisted when all Gemini attempts fail
    const mongoUri = process.env.MONGODB_URI;
    assert(mongoUri, 'MONGODB_URI must target an isolated test database for the persistence assertion');
    const databaseName = new URL(mongoUri).pathname.replace(/^\/+/, '').split('?')[0];
    assert(databaseName.toLowerCase().endsWith('_test'), 'Refusing to run persistence assertion outside a clearly named test database');
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    }

    const syllabusId = `SYL-retry-${Date.now()}`;
    const teacher: JwtUserPayload = {
      id: `test-${Date.now()}`,
      userId: `125${String(Date.now()).slice(-5)}`,
      name: 'Retry Test Teacher',
      role: 'TEACHER'
    };
    try {
      await Syllabus.create({
        syllabusId,
        uploadedBy: teacher.userId,
        uploadedByRole: 'TEACHER',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        subject: 'Operating Systems',
        fileName: 'retry-test-syllabus.txt',
        fileType: 'TXT',
        charCount: providerParams.syllabusText.length,
        wordCount: providerParams.syllabusText.split(/\s+/).length,
        extractedText: providerParams.syllabusText
      });
      const before = await Question.countDocuments({ syllabusId });
      let calls = 0;
      const client: GeminiContentClient = {
        models: {
          generateContent: async () => { calls += 1; throw providerError(503, 'UNAVAILABLE'); }
        }
      };
      await assert.rejects(
        () => AiQuestionService.generateQuestions({ ...providerParams, syllabusId }, teacher, client, retryHooks([])),
        (error: any) =>
          error.code === 'AI_GENERATION_TEMPORARILY_UNAVAILABLE' &&
          error.statusCode === 503 &&
          error.message === 'Gemini is temporarily unavailable due to high demand. Please try again in a moment.'
      );
      const after = await Question.countDocuments({ syllabusId });
      assert.equal(calls, 3);
      assert.equal(after, before, '10. Failed generation must not persist partial or fake questions');
      assert.equal(after, 0);
    } finally {
      await Question.deleteMany({ syllabusId });
      await Syllabus.deleteOne({ syllabusId });
      await mongoose.disconnect();
    }

    console.log('✓ All 10 Gemini retry, backoff, safety, and duplicate protection tests passed');
  } finally {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
