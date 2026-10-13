// GET /api/auth/me（Vercel 入口）
import handler from '../../netlify/functions/api-auth-me.mjs';
import { adaptWebHandler } from '../../lib/vercel-adapter.mjs';

export default adaptWebHandler(handler);
