// POST /api/auth/send-code（Vercel 入口，业务逻辑复用同一份 handler）
import handler from '../../netlify/functions/api-auth-send-code.mjs';
import { adaptWebHandler } from '../../lib/vercel-adapter.mjs';

export default adaptWebHandler(handler);
