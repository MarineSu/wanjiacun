// GET /api/auth/me —— 返回当前登录用户，未登录返回 { user: null }
import { db } from '../lib/db.mjs';
import { currentUser, json } from '../lib/auth.mjs';

export const config = { path: '/api/auth/me' };

export default async function handler(request) {
  let sql;
  try {
    sql = db();
  } catch {
    return json({ user: null, degraded: true }, 200);
  }
  try {
    const u = await currentUser(sql, request);
    if (!u) return json({ user: null }, 200);
    return json({
      user: {
        id: u.id,
        uid: u.uid,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
        role: u.role,
      },
    });
  } catch {
    return json({ user: null, degraded: true }, 200);
  }
}
