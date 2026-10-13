// POST /api/auth/logout（Vercel 入口）
import handler from '../../netlify/functions/api-auth-logout.mjs';
import { adaptWebHandler } from '../../lib/vercel-adapter.mjs';

export default adaptWebHandler(handler);
