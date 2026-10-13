// POST /api/auth/verify（Vercel 入口）
import handler from '../../netlify/functions/api-auth-verify.mjs';
import { adaptWebHandler } from '../../lib/vercel-adapter.mjs';

export default adaptWebHandler(handler);
