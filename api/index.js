import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, supabaseQuery, supabaseInsert, supabaseUpdate, supabaseDelete, json, genId, genUserCode } from './db.js';

const API_BASE = 'https://api.302.ai/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'my-super-secret-jwt-key-2026';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req.body) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

async function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${header}.${body}.${JWT_SECRET}`))
    .then(buf => Buffer.from(buf).toString('base64url'));
  return `${header}.${body}.${sig}`;
}

async function verifyJwt(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${header}.${body}.${JWT_SECRET}`))
      .then(buf => Buffer.from(buf).toString('base64url'));
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch { return null; }
}

async function getUserFromAuth(req) {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const payload = await verifyJwt(auth.slice(7));
  if (!payload) return null;
  const users = await supabaseQuery('users', { id: `eq.${payload.id}` });
  return users && users[0];
}

// ============ 发送验证码 ============
export async function GET(req) {
  const url = new URL(req.url);
  
  // ---------- 获取当前用户信息 ----------
  if (url.pathname === '/api/user/me') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401);
    const token = auth.slice(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    
    const users = await supabaseQuery('users', { id: `eq.${payload.id}` });
    if (!users || users.length === 0) return json({ error: '用户不存在' }, 404);
    const u = users[0];
    return json({ id: u.id, userCode: u.user_code, username: u.username, level: u.level, points: u.points, charCredits: u.char_credits, role: u.role, phone: u.phone });
  }
  
  return json({ error: 'Not found' }, 404);
}

export async function POST(req) {
  const url = new URL(req.url);
  const body = JSON.parse(await readBody(req));

  // ---------- 发送验证码 ----------
  if (url.pathname === '/api/sms/send') {
    const { phone, isLogin } = body;
    if (!phone || !/^1\d{10}$/.test(phone)) return json({ error: '请输入正确的手机号' }, 400);

    const users = await supabaseQuery('users', { phone: `eq.${phone}` });
    const exists = users && users.length > 0;

    if (isLogin && !exists) return json({ error: '该手机号未注册' }, 400);
    if (!isLogin && exists) return json({ error: '该手机号已注册' }, 400);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 300000).toISOString();

    await supabaseDelete('sms_codes', { phone: `eq.${phone}` });
    await supabaseInsert('sms_codes', { phone, code, expires_at: expires });
    console.log(`📱 验证码: ${phone} -> ${code}`);
    return json({ success: true, message: '验证码已发送（控制台查看）' });
  }

  // ---------- 注册 ----------
  if (url.pathname === '/api/register') {
    const { phone, code, username } = body;
    if (!phone || !/^1\d{10}$/.test(phone)) return json({ error: '请输入正确的手机号' }, 400);
    if (!username || username.trim().length < 2) return json({ error: '用户名至少2个字符' }, 400);
    if (!code) return json({ error: '请输入验证码' }, 400);

    const smsCodes = await supabaseQuery('sms_codes', { phone: `eq.${phone}` });
    const sms = smsCodes && smsCodes[0];
    if (!sms || sms.code !== code) return json({ error: '验证码错误' }, 400);
    if (new Date(sms.expires_at) < new Date()) return json({ error: '验证码已过期' }, 400);

    const users = await supabaseQuery('users', { phone: `eq.${phone}` });
    if (users && users.length > 0) return json({ error: '该手机号已注册' }, 400);

    const newUser = {
      id: genId(),
      user_code: genUserCode(),
      phone,
      username: username.trim(),
      role: 'user',
      level: 'normal',
      points: 0,
      char_credits: 0,
    };

    await supabaseInsert('users', newUser);
    await supabaseDelete('sms_codes', { phone: `eq.${phone}` });

    const token = await signJwt({ id: newUser.id, role: newUser.role });

    return json({ success: true, token, user: { id: newUser.id, userCode: newUser.user_code, username: newUser.username, level: newUser.level, points: newUser.points, charCredits: newUser.char_credits, role: newUser.role } });
  }

  // ---------- 登录 ----------
  if (url.pathname === '/api/login') {
    const { phone, code } = body;
    if (!phone || !/^1\d{10}$/.test(phone)) return json({ error: '请输入正确的手机号' }, 400);
    if (!code) return json({ error: '请输入验证码' }, 400);

    const users = await supabaseQuery('users', { phone: `eq.${phone}` });
    const user = users && users[0];
    if (!user) return json({ error: '该手机号未注册' }, 404);

    // 管理员使用固定验证码 666666
    if (user.role === 'admin') {
      if (code !== '666666') return json({ error: '验证码错误' }, 400);
    } else {
      const smsCodes = await supabaseQuery('sms_codes', { phone: `eq.${phone}` });
      const sms = smsCodes && smsCodes[0];
      if (!sms || sms.code !== code) return json({ error: '验证码错误' }, 400);
      if (new Date(sms.expires_at) < new Date()) return json({ error: '验证码已过期' }, 400);
      await supabaseDelete('sms_codes', { phone: `eq.${phone}` });
    }

    const token = await signJwt({ id: user.id, role: user.role });

    return json({ success: true, token, user: { id: user.id, userCode: user.user_code, username: user.username, level: user.level, points: user.points, charCredits: user.char_credits, role: user.role } });
  }

  // ---------- AI 翻译 ----------
  if (url.pathname === '/api/translate') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401);
    const token = auth.slice(7);
    const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    const users = await supabaseQuery('users', { id: `eq.${jwtPayload.id}` });
    const user = users && users[0];
    if (!user) return json({ error: '用户不存在' }, 404);

    const { model, messages, temperature, max_tokens, charCount } = body;
    const cost = charCount || 0;

    if (cost > 0 && user.role !== 'admin') {
      if (user.char_credits < cost) return json({ error: `字符点数不足，需要 ${cost} 点，当前仅 ${user.char_credits} 点` }, 400);
    }

    const apiRes = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.API_KEY}`,
      },
      body: JSON.stringify({ model, messages, temperature: temperature || 0.3, max_tokens: max_tokens || 4096 }),
    });

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      return json({ error: true, status: apiRes.status, data: apiData }, apiRes.status);
    }

    // 扣费
    if (cost > 0 && user.role !== 'admin') {
      await supabaseUpdate('users', { id: `eq.${user.id}` }, {
        char_credits: user.char_credits - cost,
        points: user.points + Math.floor(cost / 10),
      });
      user.char_credits -= cost;
      user.points += Math.floor(cost / 10);
    }

    return json({ error: false, data: apiData, charCredits: user.char_credits, points: user.points });
  }

  // ---------- 管理员：获取用户列表 ----------
  if (url.pathname === '/api/admin/users') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401);
    const token = auth.slice(7);
    const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (jwtPayload.role !== 'admin') return json({ error: '无权限' }, 403);

    const users = await supabaseQuery('users', {}, 'id,user_code,username,phone,level,points,char_credits,role,created_at');
    return json({ users: users.map(u => ({ ...u, userCode: u.user_code, charCredits: u.char_credits })) });
  }

  // ---------- 管理员：修改用户 ----------
  if (url.pathname === '/api/admin/user/update') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401);
    const token = auth.slice(7);
    const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (jwtPayload.role !== 'admin') return json({ error: '无权限' }, 403);

    const { userId, level, charCredits, points, username } = body;
    const updateData = {};
    if (level) updateData.level = level;
    if (typeof charCredits === 'number') updateData.char_credits = charCredits;
    if (typeof points === 'number') updateData.points = points;
    if (username) updateData.username = username;

    await supabaseUpdate('users', { id: `eq.${userId}` }, updateData);
    return json({ success: true });
  }

  // ---------- 管理员：删除用户 ----------
  if (url.pathname === '/api/admin/user/delete') {
    const auth = req.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) return json({ error: '未登录' }, 401);
    const token = auth.slice(7);
    const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (jwtPayload.role !== 'admin') return json({ error: '无权限' }, 403);

    const { userId } = body;
    await supabaseDelete('users', { id: `eq.${userId}` });
    return json({ success: true });
  }

  return json({ error: 'Not found' }, 404);
}
