import { ChatMessage, IChatMessageDocument } from '../models/ChatMessage';
import { Conversation, IConversationDocument } from '../models/Conversation';
import { User, IUserDocument } from '../models/User';
import { Exam } from '../models/Exam';
import { ExamAssignment } from '../models/ExamAssignment';
import { JwtUserPayload } from '../types/auth.types';
import { generateNextMessageId, generateNextConversationId } from '../utils/exam-id.generator';
import { emitToRooms } from '../realtime/socket';
import { logger } from '../utils/logger';

export class CommunicationService {
  /**
   * Check if sender is authorized to message recipient (Strict RBAC)
   * STUDENT: Can message assigned teacher or ADMIN. Cannot message other students.
   * TEACHER: Can message assigned students or ADMIN. Cannot message other students.
   * ADMIN: Can message any authorized teacher or student.
   */
  static async verifyMessagingPermission(
    sender: JwtUserPayload,
    recipientUserId: string,
    examId?: string
  ): Promise<{ recipient: IUserDocument; isLiveExamChat: boolean }> {
    if (sender.userId === recipientUserId) {
      const err: any = new Error('Cannot message yourself');
      err.statusCode = 400;
      throw err;
    }

    const recipient = await User.findOne({ userId: recipientUserId });
    if (!recipient) {
      const err: any = new Error(`Recipient ${recipientUserId} not found`);
      err.statusCode = 404;
      throw err;
    }

    // Live Exam Context check
    if (examId) {
      const exam = await Exam.findOne({ examId });
      if (exam) {
        if (sender.role === 'STUDENT') {
          // Student can message exam teacher or admin
          if (recipient.role === 'ADMIN' || recipient.userId === exam.createdBy) {
            return { recipient, isLiveExamChat: true };
          }
        } else if (sender.role === 'TEACHER') {
          // Exam teacher can message assigned students
          const isAssigned =
            (Array.isArray(exam.assignedStudentIds) && exam.assignedStudentIds.includes(recipient.userId)) ||
            (Array.isArray(exam.assignedStudents) && exam.assignedStudents.includes(recipient.userId)) ||
            Boolean(await ExamAssignment.exists({ examId, studentId: recipient.userId }));

          if (exam.createdBy === sender.userId && isAssigned) {
            return { recipient, isLiveExamChat: true };
          }
        }
      }
    }

    // Role-Based Access Control
    if (sender.role === 'ADMIN') {
      // Admin can message any active teacher or student
      return { recipient, isLiveExamChat: false };
    }

    if (sender.role === 'TEACHER') {
      if (recipient.role === 'ADMIN') {
        // Teacher can message admin
        return { recipient, isLiveExamChat: false };
      }
      if (recipient.role === 'STUDENT') {
        // Teacher can message their assigned / supervised students
        const isSupervised =
          Array.isArray(recipient.managedBy) && recipient.managedBy.includes(sender.userId);
        const isTagged =
          Array.isArray(recipient.teacherIds) && recipient.teacherIds.includes(sender.userId);

        if (isSupervised || isTagged) {
          return { recipient, isLiveExamChat: false };
        }

        // Or students assigned to exams created by this teacher
        const sharedExam = await Exam.findOne({
          createdBy: sender.userId,
          $or: [
            { assignedStudentIds: recipient.userId },
            { assignedStudents: recipient.userId }
          ]
        });

        if (sharedExam) {
          return { recipient, isLiveExamChat: false };
        }

        const err: any = new Error('Forbidden: Teachers can only message assigned students or administrators');
        err.statusCode = 403;
        throw err;
      }

      // Teacher cannot message other unrelated teachers/students
      const err: any = new Error('Forbidden: Communication not authorized');
      err.statusCode = 403;
      throw err;
    }

    if (sender.role === 'STUDENT') {
      if (recipient.role === 'ADMIN') {
        // Student can message admin
        return { recipient, isLiveExamChat: false };
      }
      if (recipient.role === 'TEACHER') {
        const student = await User.findOne({ userId: sender.userId });
        const isSupervised =
          Array.isArray(student?.managedBy) && student.managedBy.includes(recipient.userId);
        const isTagged =
          Array.isArray(student?.teacherIds) && student.teacherIds.includes(recipient.userId);

        if (isSupervised || isTagged) {
          return { recipient, isLiveExamChat: false };
        }

        // Or teacher who created an exam assigned to this student
        const sharedExam = await Exam.findOne({
          createdBy: recipient.userId,
          $or: [
            { assignedStudentIds: sender.userId },
            { assignedStudents: sender.userId }
          ]
        });

        if (sharedExam) {
          return { recipient, isLiveExamChat: false };
        }

        const err: any = new Error('Forbidden: Students can only message their assigned teachers or administrators');
        err.statusCode = 403;
        throw err;
      }

      if (recipient.role === 'STUDENT') {
        const err: any = new Error('Forbidden: Students cannot message other students');
        err.statusCode = 403;
        throw err;
      }
    }

    const err: any = new Error('Forbidden: Unauthorized communication path');
    err.statusCode = 403;
    throw err;
  }

  /**
   * Get or create a conversation between participants
   */
  static async getOrCreateConversation(
    sender: JwtUserPayload,
    recipientUserId: string,
    options?: { type?: 'DIRECT' | 'EXAM_LIVE'; examId?: string; examTitle?: string }
  ): Promise<IConversationDocument> {
    const { recipient, isLiveExamChat } = await this.verifyMessagingPermission(
      sender,
      recipientUserId,
      options?.examId
    );

    const type = options?.type || (isLiveExamChat ? 'EXAM_LIVE' : 'DIRECT');
    const participants = [sender.userId, recipient.userId].sort();

    let query: any = {
      type,
      participants: { $all: participants, $size: 2 }
    };

    if (type === 'EXAM_LIVE' && options?.examId) {
      query.examId = options.examId;
    }

    let conv = await Conversation.findOne(query);

    if (!conv) {
      const conversationId = await generateNextConversationId();
      conv = await Conversation.create({
        conversationId,
        type,
        examId: options?.examId || '',
        examTitle: options?.examTitle || '',
        participants,
        participantRoles: {
          [sender.userId]: sender.role,
          [recipient.userId]: recipient.role
        },
        participantNames: {
          [sender.userId]: sender.name,
          [recipient.userId]: recipient.name
        }
      });
    }

    return conv;
  }

  /**
   * Send a real MongoDB message with Socket.IO realtime broadcast
   */
  static async sendMessage(
    input: {
      recipientId: string;
      content: string;
      conversationId?: string;
      examId?: string;
      type?: 'DIRECT' | 'EXAM_LIVE';
    },
    sender: JwtUserPayload
  ): Promise<{ message: IChatMessageDocument; conversation: IConversationDocument }> {
    if (!input.content || typeof input.content !== 'string' || !input.content.trim()) {
      const err: any = new Error('Message content is required');
      err.statusCode = 400;
      throw err;
    }

    if (!input.recipientId || typeof input.recipientId !== 'string' || !input.recipientId.trim()) {
      const err: any = new Error('recipientId is required');
      err.statusCode = 400;
      throw err;
    }

    const conversation = await this.getOrCreateConversation(sender, input.recipientId.trim(), {
      type: input.type,
      examId: input.examId
    });

    const messageId = await generateNextMessageId();
    const chatMsg = await ChatMessage.create({
      messageId,
      conversationId: conversation.conversationId,
      senderId: sender.userId,
      senderRole: sender.role,
      senderName: sender.name,
      recipientId: input.recipientId.trim(),
      content: input.content.trim(),
      type: conversation.type,
      examId: conversation.examId || '',
      readBy: [sender.userId]
    });

    conversation.lastMessage = {
      content: chatMsg.content,
      senderId: chatMsg.senderId,
      senderRole: chatMsg.senderRole,
      senderName: chatMsg.senderName,
      createdAt: chatMsg.createdAt
    };
    await conversation.save();

    // Realtime emission to rooms
    const targetRooms = [
      `admin:${sender.userId}`,
      `teacher:${sender.userId}`,
      `student:${sender.userId}`,
      `admin:${input.recipientId.trim()}`,
      `teacher:${input.recipientId.trim()}`,
      `student:${input.recipientId.trim()}`
    ];

    if (conversation.type === 'EXAM_LIVE' && conversation.examId) {
      targetRooms.push(`exam:${conversation.examId}`);
    }

    emitToRooms(targetRooms, 'message.created', {
      message: chatMsg.toJSON(),
      conversation: conversation.toJSON()
    }, sender.userId);

    logger.info(`Message ${messageId} sent from ${sender.userId} to ${input.recipientId}`);
    return { message: chatMsg, conversation };
  }

  /**
   * List conversations for the authenticated user
   */
  static async listConversations(
    user: JwtUserPayload,
    type?: 'DIRECT' | 'EXAM_LIVE'
  ): Promise<IConversationDocument[]> {
    const query: any = { participants: user.userId };
    if (type) query.type = type;
    return Conversation.find(query).sort({ updatedAt: -1 });
  }

  /**
   * Get messages for a conversation
   */
  static async getConversationMessages(
    conversationId: string,
    user: JwtUserPayload
  ): Promise<IChatMessageDocument[]> {
    const conv = await Conversation.findOne({ conversationId });
    if (!conv) {
      const err: any = new Error('Conversation not found');
      err.statusCode = 404;
      throw err;
    }

    if (user.role !== 'ADMIN' && !conv.participants.includes(user.userId)) {
      const err: any = new Error('Forbidden: You are not a participant in this conversation');
      err.statusCode = 403;
      throw err;
    }

    return ChatMessage.find({ conversationId }).sort({ createdAt: 1 });
  }

  /**
   * List allowed contacts for the user according to RBAC
   */
  static async listContacts(user: JwtUserPayload) {
    if (user.role === 'ADMIN') {
      const users = await User.find({ status: 'ACTIVE', userId: { $ne: user.userId } })
        .select('userId name role department designation course')
        .sort({ role: 1, name: 1 })
        .lean();
      return users;
    }

    if (user.role === 'TEACHER') {
      // Admins + assigned students
      const [admins, students] = await Promise.all([
        User.find({ role: 'ADMIN', status: 'ACTIVE' })
          .select('userId name role department')
          .lean(),
        User.find({
          role: 'STUDENT',
          status: 'ACTIVE',
          $or: [{ managedBy: user.userId }, { teacherIds: user.userId }]
        })
          .select('userId name role department course semester section')
          .lean()
      ]);
      return [...admins, ...students];
    }

    if (user.role === 'STUDENT') {
      // Admins + assigned teachers
      const student = await User.findOne({ userId: user.userId });
      const teacherIds = Array.from(
        new Set([...(student?.managedBy || []), ...(student?.teacherIds || [])])
      );

      const [admins, teachers] = await Promise.all([
        User.find({ role: 'ADMIN', status: 'ACTIVE' })
          .select('userId name role department')
          .lean(),
        User.find({
          role: 'TEACHER',
          status: 'ACTIVE',
          userId: { $in: teacherIds }
        })
          .select('userId name role department designation')
          .lean()
      ]);
      return [...admins, ...teachers];
    }

    return [];
  }
}
