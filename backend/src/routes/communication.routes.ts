import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { CommunicationController } from '../controllers/communication.controller';

const router = Router();

router.use(authenticate);

router.get('/contacts', CommunicationController.getContacts);
router.get('/conversations', CommunicationController.getConversations);
router.get('/conversations/:conversationId/messages', CommunicationController.getMessages);
router.post('/messages', CommunicationController.sendMessage);

export default router;
