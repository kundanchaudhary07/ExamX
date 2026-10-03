import { Question } from '../models/Question';
import { Exam } from '../models/Exam';
import { ExamAttempt } from '../models/ExamAttempt';
import { Result } from '../models/Result';
import { StudentQuery } from '../models/StudentQuery';
import { ProctoringEvent } from '../models/ProctoringEvent';
import { AuditLog } from '../models/AuditLog';
import { UnblockRequest } from '../models/UnblockRequest';
import { ChatMessage } from '../models/ChatMessage';
import { Conversation } from '../models/Conversation';

export const QUESTION_ID_REGEX = /^QST-[0-9]{5}$/;
export const EXAM_ID_REGEX = /^EXM-[0-9]{5}$/;
export const ATTEMPT_ID_REGEX = /^ATT-[0-9]{5}$/;
export const RESULT_ID_REGEX = /^RES-[0-9]{5}$/;
export const QUERY_ID_REGEX = /^QRY-[0-9]{5}$/;
export const UNBLOCK_ID_REGEX = /^UBR-[0-9]{5}$/;
export const MESSAGE_ID_REGEX = /^MSG-[0-9]{5}$/;
export const CONVERSATION_ID_REGEX = /^CNV-[0-9]{5}$/;

export async function generateNextQuestionId(): Promise<string> {
  const latest = await Question.find({ questionId: { $regex: '^QST-[0-9]{5}$' } })
    .sort({ questionId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.questionId) {
    const currentSeq = parseInt(latest[0].questionId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `QST-${nextSeq}`;
  while (await Question.exists({ questionId: candidateId })) {
    nextSeq++;
    candidateId = `QST-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextExamId(): Promise<string> {
  const latest = await Exam.find({ examId: { $regex: '^EXM-[0-9]{5}$' } })
    .sort({ examId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.examId) {
    const currentSeq = parseInt(latest[0].examId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `EXM-${nextSeq}`;
  while (await Exam.exists({ examId: candidateId })) {
    nextSeq++;
    candidateId = `EXM-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextAttemptId(): Promise<string> {
  const latest = await ExamAttempt.find({ attemptId: { $regex: '^ATT-[0-9]{5}$' } })
    .sort({ attemptId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.attemptId) {
    const currentSeq = parseInt(latest[0].attemptId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `ATT-${nextSeq}`;
  while (await ExamAttempt.exists({ attemptId: candidateId })) {
    nextSeq++;
    candidateId = `ATT-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextResultId(): Promise<string> {
  const latest = await Result.find({ resultId: { $regex: '^RES-[0-9]{5}$' } })
    .sort({ resultId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.resultId) {
    const currentSeq = parseInt(latest[0].resultId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `RES-${nextSeq}`;
  while (await Result.exists({ resultId: candidateId })) {
    nextSeq++;
    candidateId = `RES-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextQueryId(): Promise<string> {
  const latest = await StudentQuery.find({ queryId: { $regex: '^QRY-[0-9]{5}$' } })
    .sort({ queryId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.queryId) {
    const currentSeq = parseInt(latest[0].queryId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `QRY-${nextSeq}`;
  while (await StudentQuery.exists({ queryId: candidateId })) {
    nextSeq++;
    candidateId = `QRY-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextProctoringEventId(): Promise<string> {
  const count = await ProctoringEvent.countDocuments();
  return `PRC-${10001 + count}-${Date.now().toString().slice(-4)}`;
}

export async function generateNextAuditId(): Promise<string> {
  const count = await AuditLog.countDocuments();
  return `AUD-${10001 + count}-${Date.now().toString().slice(-4)}`;
}

export async function generateNextUnblockRequestId(): Promise<string> {
  const latest = await UnblockRequest.find({ requestId: { $regex: '^UBR-[0-9]{5}$' } })
    .sort({ requestId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.requestId) {
    const currentSeq = parseInt(latest[0].requestId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `UBR-${nextSeq}`;
  while (await UnblockRequest.exists({ requestId: candidateId })) {
    nextSeq++;
    candidateId = `UBR-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextMessageId(): Promise<string> {
  const latest = await ChatMessage.find({ messageId: { $regex: '^MSG-[0-9]{5}$' } })
    .sort({ messageId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.messageId) {
    const currentSeq = parseInt(latest[0].messageId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `MSG-${nextSeq}`;
  while (await ChatMessage.exists({ messageId: candidateId })) {
    nextSeq++;
    candidateId = `MSG-${nextSeq}`;
  }

  return candidateId;
}

export async function generateNextConversationId(): Promise<string> {
  const latest = await Conversation.find({ conversationId: { $regex: '^CNV-[0-9]{5}$' } })
    .sort({ conversationId: -1 })
    .limit(1)
    .lean();

  let nextSeq = 10001;
  if (latest.length > 0 && latest[0]?.conversationId) {
    const currentSeq = parseInt(latest[0].conversationId.slice(4), 10);
    if (!isNaN(currentSeq)) {
      nextSeq = currentSeq + 1;
    }
  }

  let candidateId = `CNV-${nextSeq}`;
  while (await Conversation.exists({ conversationId: candidateId })) {
    nextSeq++;
    candidateId = `CNV-${nextSeq}`;
  }

  return candidateId;
}

