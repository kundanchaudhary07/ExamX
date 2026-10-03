import assert from 'node:assert/strict';
import { AiQuestionService } from '../src/services/ai.service';

async function run(): Promise<void> {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalProvider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = 'GEMINI';
  delete process.env.GEMINI_API_KEY;

  try {
    const status = AiQuestionService.getStatus();
    assert.equal(status.configured, false, 'AI service should report not configured when GEMINI_API_KEY is absent');
    assert.equal(status.status, 'NOT_CONFIGURED', 'AI service should report NOT_CONFIGURED when the backend key is absent');

    await assert.rejects(
      () => AiQuestionService.generateQuestionsForReview({
        subject: 'Operating Systems',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        count: 1,
        marks: 2,
        difficulty: 'MEDIUM',
        syllabusText: 'A sufficiently long syllabus text is not enough by itself unless it has been uploaded and persisted for the authenticated teacher.'
      }),
      (error: any) => error.code === 'INSUFFICIENT_SYLLABUS_CONTEXT',
      'Generation must require a persisted syllabus ID'
    );

    await assert.rejects(
      () => AiQuestionService.generateQuestionsForReview({
        syllabusId: 'SYL-config-safety',
        subject: 'Operating Systems',
        topic: 'Scheduling',
        course: 'B.Tech CSE',
        semester: 'Semester 4',
        count: 2,
        marks: 2,
        difficulty: 'MEDIUM',
        questionType: 'MCQ',
        syllabusText: 'Process scheduling in operating systems is based on priority and time slices. Preemptive scheduling allows a running process to be interrupted, while non-preemptive scheduling lets it continue until completion or blocking.'
      }),
      (error: any) => error.code === 'AI_GENERATION_NOT_CONFIGURED',
      'AI generation should reject when the API key is absent instead of synthesizing fake questions'
    );

    process.env.GEMINI_API_KEY = 'test-only-provider-placeholder';
    const providerParams = {
      syllabusId: 'SYL-provider-regression',
      subject: 'Operating Systems',
      topic: 'Scheduling',
      course: 'B.Tech CSE',
      semester: 'Semester 4',
      count: 1,
      marks: 2,
      difficulty: 'MEDIUM' as const,
      syllabusText: 'UNIT III: Process scheduling uses priorities and time slices. Preemptive scheduling interrupts a running process. Non-preemptive scheduling lets a process continue until completion or blocking.'
    };
    let capturedRequest: any;
    await assert.rejects(
      () => AiQuestionService.generateQuestionsForReview(providerParams, {
        models: {
          generateContent: async (request) => {
            capturedRequest = request;
            return { text: '{malformed structured response' };
          }
        }
      }),
      (error: any) => error.code === 'AI_INVALID_RESPONSE',
      'Malformed Gemini structured output must be rejected'
    );
    assert(String(capturedRequest.contents).includes(providerParams.syllabusText));
    assert(capturedRequest.config.responseSchema.items.properties.sourceReference);

    await assert.rejects(
      () => AiQuestionService.generateQuestionsForReview(providerParams, {
        models: {
          generateContent: async () => { throw new Error('test provider unavailable'); }
        }
      }),
      (error: any) => error.code === 'AI_GENERATION_TEMPORARILY_UNAVAILABLE' || error.code === 'AI_PROVIDER_UNAVAILABLE',
      'Provider failures must be reported as AI_GENERATION_TEMPORARILY_UNAVAILABLE'
    );

    console.log('✅ AI config safety regression test passed');
  } finally {
    if (originalProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = originalProvider;
    }
    if (originalKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalKey;
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
