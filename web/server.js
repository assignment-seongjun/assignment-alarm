const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 80;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (!IS_PRODUCTION ? crypto.randomBytes(32).toString('hex') : null);
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || null;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || null;
const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const GOOGLE_ALLOWED_DOMAIN = 'bssm.hs.kr';
const ADMIN_NAME = process.env.ADMIN_NAME ? String(process.env.ADMIN_NAME).trim() : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const ADMIN_GRADE = Number.parseInt(process.env.ADMIN_GRADE || '1', 10);
const ADMIN_CLASS = Number.parseInt(process.env.ADMIN_CLASS || '1', 10);
const MAX_GRADE = 3;
const MAX_CLASS = 4;
const AUTH_COOKIE_NAME = 'assignment_alarm_session';
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT = 20;
const authAttempts = new Map();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'mysql',
  port: Number(process.env.MYSQLPORT || process.env.DB_PORT) || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER,
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'assignment_alarm',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
};

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required in production.');
}

if (!dbConfig.user || !dbConfig.password) {
  throw new Error('Database credentials are missing. Set MYSQLUSER/MYSQLPASSWORD or DB_USER/DB_PASSWORD.');
}

const pool = mysql.createPool(dbConfig);

const bootstrapSchema = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL UNIQUE,
    google_sub VARCHAR(255) DEFAULT NULL,
    google_email VARCHAR(255) DEFAULT NULL,
    grade INT NOT NULL,
    class_number INT NOT NULL,
    profile_image_url VARCHAR(500) DEFAULT NULL,
    is_alarm_enabled TINYINT(1) DEFAULT 1,
    is_admin TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    assignment_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    due_date DATE NOT NULL,
    target_grade INT NOT NULL,
    target_class INT DEFAULT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    type ENUM('grade', 'class') NOT NULL,
    target_grade INT NOT NULL,
    target_class INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS user_assignments (
    user_id INT NOT NULL,
    assignment_id INT NOT NULL,
    is_completed TINYINT(1) DEFAULT 0,
    PRIMARY KEY (user_id, assignment_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE
  )`
];

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'src'), { maxAge: 0, etag: false, lastModified: false }));

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join('='));
    return acc;
  }, {});
}

function getRequestToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.split(' ')[1];
  return parseCookies(req)[AUTH_COOKIE_NAME] || null;
}

function buildAuthCookie(token, maxAge = AUTH_TTL_MS) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAge / 1000)}`
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  return parts.join('; ');
}

function clearAuthCookie() {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  return parts.join('; ');
}

function createToken(user) {
  return jwt.sign(
    { id: user.id || user.user_id, name: user.name, grade: user.grade, class_number: user.class_number, is_admin: normalizeBooleanFlag(user.is_admin) },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', buildAuthCookie(token));
}

function createGoogleSetupToken(profile) {
  return jwt.sign(
    { type: 'google-setup', profile },
    JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeGoogleName(value) {
  let name = normalizeName(value);
  if (!name) name = 'Google 사용자';
  if (name.length > 30) name = name.slice(0, 30).trim();
  if (name.length < 2) name = 'Google 사용자';
  return name;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function isAdminUser(user) {
  return normalizeBooleanFlag(user?.is_admin) === 1;
}

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function verifyGoogleCredential(credential) {
  if (!googleClient || !GOOGLE_CLIENT_ID) {
    throw new Error('google-not-configured');
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  if (!payload?.sub) {
    throw new Error('google-invalid-token');
  }
  const email = String(payload.email || '').trim().toLowerCase();
  if (!payload.email_verified || !email.endsWith(`@${GOOGLE_ALLOWED_DOMAIN}`)) {
    throw new Error('google-domain-not-allowed');
  }

  return {
    google_sub: payload.sub,
    google_email: email,
    name: normalizeGoogleName(payload.name || payload.email || 'Google 사용자'),
    profile_image_url: payload.picture || null
  };
}

async function findUserByGoogleSub(googleSub) {
  const [rows] = await pool.execute(
    'SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled, is_admin, google_sub, google_email FROM users WHERE google_sub = ? LIMIT 1',
    [googleSub]
  );
  return rows[0] || null;
}

function authRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.expiresAt <= now) {
    authAttempts.set(key, { count: 1, expiresAt: now + AUTH_RATE_WINDOW_MS });
    return next();
  }
  if (entry.count >= AUTH_RATE_LIMIT) {
    return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
  }
  entry.count += 1;
  next();
}

function clearAuthRateLimit(req) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  authAttempts.delete(key);
}

function authMiddleware(req, res, next) {
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.setHeader('Set-Cookie', clearAuthCookie());
    return res.status(401).json({ error: '토큰이 만료되었습니다.' });
  }
}

async function getCurrentUser(userId) {
  const [rows] = await pool.execute('SELECT user_id, name, grade, class_number, is_admin FROM users WHERE user_id = ?', [userId]);
  return rows[0] || null;
}

async function ensureAdminAccess(req, res) {
  const currentUser = await getCurrentUser(req.user.id);
  if (!currentUser) {
    res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    return null;
  }
  if (!isAdminUser(currentUser)) {
    res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    return null;
  }
  return currentUser;
}

async function verifyTurnstileToken(token, remoteIp) {
  if (!TURNSTILE_ENABLED) return { success: true };
  if (!token) return { success: false, error: 'missing-input-response' };

  const params = new URLSearchParams({
    secret: TURNSTILE_SECRET_KEY,
    response: String(token)
  });

  if (remoteIp) {
    params.set('remoteip', remoteIp);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  if (!response.ok) {
    throw new Error(`Turnstile verification failed with status ${response.status}`);
  }

  return response.json();
}

async function migrateSchema(conn) {
  const [legacyEmailColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'email'`
  );

  if (legacyEmailColumns.length > 0) {
    const [emailIndexes] = await conn.execute(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME = 'email'
         AND INDEX_NAME <> 'PRIMARY'`
    );

    for (const index of emailIndexes) {
      await conn.execute(`ALTER TABLE users DROP INDEX \`${index.INDEX_NAME}\``);
    }

    await conn.execute('ALTER TABLE users DROP COLUMN email');
  }

  const [googleSubColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'google_sub'`
  );

  if (googleSubColumns.length === 0) {
    await conn.execute('ALTER TABLE users ADD COLUMN google_sub VARCHAR(255) DEFAULT NULL AFTER name');
  }

  const [googleEmailColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'google_email'`
  );

  if (googleEmailColumns.length === 0) {
    await conn.execute('ALTER TABLE users ADD COLUMN google_email VARCHAR(255) DEFAULT NULL AFTER google_sub');
  }

  const [nameUniqueIndexes] = await conn.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'name'
       AND NON_UNIQUE = 0
       AND INDEX_NAME <> 'PRIMARY'`
  );

  if (nameUniqueIndexes.length === 0) {
    await conn.execute('ALTER TABLE users ADD UNIQUE INDEX users_name_unique (name)');
  }

  const [googleSubUniqueIndexes] = await conn.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'google_sub'
       AND NON_UNIQUE = 0
       AND INDEX_NAME <> 'PRIMARY'`
  );

  if (googleSubUniqueIndexes.length === 0) {
    await conn.execute('ALTER TABLE users ADD UNIQUE INDEX users_google_sub_unique (google_sub)');
  }

  const [adminColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'is_admin'`
  );

  if (adminColumns.length === 0) {
    await conn.execute('ALTER TABLE users ADD COLUMN is_admin TINYINT(1) DEFAULT 0 AFTER is_alarm_enabled');
  }
}

async function seedAdminAccount(conn) {
  if (!ADMIN_NAME || !ADMIN_PASSWORD) return;
  if (ADMIN_PASSWORD.length < 8) {
    console.warn('Skipping admin bootstrap: ADMIN_PASSWORD must be at least 8 characters.');
    return;
  }

  const adminGrade = Number.isInteger(ADMIN_GRADE) && ADMIN_GRADE >= 1 && ADMIN_GRADE <= MAX_GRADE ? ADMIN_GRADE : 1;
  const adminClass = Number.isInteger(ADMIN_CLASS) && ADMIN_CLASS >= 1 && ADMIN_CLASS <= MAX_CLASS ? ADMIN_CLASS : 1;
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const [rows] = await conn.execute('SELECT user_id FROM users WHERE name = ? LIMIT 1', [ADMIN_NAME]);

  if (rows.length === 0) {
    await conn.execute(
      'INSERT INTO users (password, name, grade, class_number, is_admin) VALUES (?, ?, ?, ?, 1)',
      [passwordHash, ADMIN_NAME, adminGrade, adminClass]
    );
    console.log(`Admin account created: ${ADMIN_NAME}`);
    return;
  }

  await conn.execute(
    'UPDATE users SET password = ?, grade = ?, class_number = ?, is_admin = 1 WHERE user_id = ?',
    [passwordHash, adminGrade, adminClass, rows[0].user_id]
  );
  console.log(`Admin account synced: ${ADMIN_NAME}`);
}

// Auth
app.get('/api/public-config', (_req, res) => {
  res.json({
    turnstileSiteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : null,
    googleClientId: GOOGLE_CLIENT_ID || null
  });
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  return res.status(403).json({ error: '구글 로그인으로만 가입할 수 있습니다.' });
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  return res.status(403).json({ error: '구글 로그인만 사용할 수 있습니다.' });
});

app.post('/api/auth/google', authRateLimit, async (req, res) => {
  try {
    const credential = String(req.body.credential || '').trim();
    if (!credential) return res.status(400).json({ error: '구글 인증 정보가 없습니다.' });
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: '구글 로그인이 아직 설정되지 않았습니다.' });

    const profile = await verifyGoogleCredential(credential);
    const existingUser = await findUserByGoogleSub(profile.google_sub);

    if (existingUser) {
      await pool.execute(
        'UPDATE users SET google_email = ?, profile_image_url = COALESCE(?, profile_image_url) WHERE user_id = ?',
        [profile.google_email, profile.profile_image_url, existingUser.user_id]
      );

      const user = {
        id: existingUser.user_id,
        name: existingUser.name,
        grade: existingUser.grade,
        class_number: existingUser.class_number,
        is_admin: existingUser.is_admin
      };
      setAuthCookie(res, createToken(user));
      clearAuthRateLimit(req);
      return res.json({
        user: {
          id: existingUser.user_id,
          name: existingUser.name,
          grade: existingUser.grade,
          class_number: existingUser.class_number,
          profile_image_url: profile.profile_image_url || existingUser.profile_image_url,
          is_alarm_enabled: existingUser.is_alarm_enabled,
          is_admin: existingUser.is_admin
        }
      });
    }

    return res.json({
      requiresProfile: true,
      setupToken: createGoogleSetupToken(profile),
      profile: {
        name: profile.name,
        email: profile.google_email,
        profile_image_url: profile.profile_image_url
      }
    });
  } catch (error) {
    const message = error?.message === 'google-not-configured'
      ? '구글 로그인이 아직 설정되지 않았습니다.'
      : error?.message === 'google-domain-not-allowed'
        ? 'bssm.hs.kr 학교 계정으로만 로그인할 수 있습니다.'
      : '구글 로그인 확인에 실패했습니다.';
    return res.status(401).json({ error: message });
  }
});

app.post('/api/auth/google/register', authRateLimit, async (req, res) => {
  try {
    const setupToken = String(req.body.setupToken || '').trim();
    const grade = parseInteger(req.body.grade);
    const class_number = parseInteger(req.body.class_number);

    if (!setupToken || !grade || !class_number) {
      return res.status(400).json({ error: '학년과 반을 입력해주세요.' });
    }
    if (grade < 1 || grade > MAX_GRADE || class_number < 1 || class_number > MAX_CLASS) {
      return res.status(400).json({ error: '학년 또는 반 값이 올바르지 않습니다.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(setupToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: '구글 가입 정보가 만료되었습니다. 다시 로그인해주세요.' });
    }

    if (decoded?.type !== 'google-setup' || !decoded?.profile?.google_sub) {
      return res.status(401).json({ error: '구글 가입 정보가 올바르지 않습니다.' });
    }

    const existingUser = await findUserByGoogleSub(decoded.profile.google_sub);
    if (existingUser) {
      const user = {
        id: existingUser.user_id,
        name: existingUser.name,
        grade: existingUser.grade,
        class_number: existingUser.class_number,
        is_admin: existingUser.is_admin
      };
      setAuthCookie(res, createToken(user));
      clearAuthRateLimit(req);
      return res.json({
        user: {
          id: existingUser.user_id,
          name: existingUser.name,
          grade: existingUser.grade,
          class_number: existingUser.class_number,
          profile_image_url: existingUser.profile_image_url,
          is_alarm_enabled: existingUser.is_alarm_enabled,
          is_admin: existingUser.is_admin
        }
      });
    }

    const uniqueName = normalizeGoogleName(decoded.profile.name);
    const passwordHash = await bcrypt.hash(`google:${decoded.profile.google_sub}:${crypto.randomBytes(8).toString('hex')}`, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (password, name, google_sub, google_email, grade, class_number, profile_image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        passwordHash,
        uniqueName,
        decoded.profile.google_sub,
        decoded.profile.google_email,
        grade,
        class_number,
        decoded.profile.profile_image_url
      ]
    );

    const user = { id: result.insertId, name: uniqueName, grade, class_number, is_admin: 0 };
    setAuthCookie(res, createToken(user));
    clearAuthRateLimit(req);
    return res.json({
      user: {
        id: result.insertId,
        name: uniqueName,
        grade,
        class_number,
        profile_image_url: decoded.profile.profile_image_url,
        is_alarm_enabled: 1,
        is_admin: 0
      }
    });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '이미 연결된 구글 계정입니다.' });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearAuthCookie());
  res.json({ success: true });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled, is_admin FROM users WHERE user_id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Users
app.get('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req.user.id);
    if (!currentUser) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const requestedUserId = parseInteger(req.params.id);
    if (requestedUserId !== req.user.id && !isAdminUser(currentUser)) return res.status(403).json({ error: '권한이 없습니다.' });
    const [rows] = await pool.execute('SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled, is_admin FROM users WHERE user_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/admin/users', authMiddleware, async (req, res) => {
  try {
    const adminUser = await ensureAdminAccess(req, res);
    if (!adminUser) return;
    const [rows] = await pool.execute(
      'SELECT user_id, name, grade, class_number, is_alarm_enabled, is_admin, created_at FROM users ORDER BY is_admin DESC, grade ASC, class_number ASC, name ASC'
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/admin/users/:id', authMiddleware, async (req, res) => {
  try {
    const adminUser = await ensureAdminAccess(req, res);
    if (!adminUser) return;
    const targetUserId = parseInteger(req.params.id);
    if (!targetUserId) return res.status(400).json({ error: '사용자 정보가 올바르지 않습니다.' });

    const [targetRows] = await pool.execute('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [targetUserId]);
    if (targetRows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

    if (req.body.name !== undefined) {
      const name = normalizeName(req.body.name);
      if (!name) return res.status(400).json({ error: '이름을 입력해주세요.' });
      if (name.length < 2 || name.length > 30) return res.status(400).json({ error: '이름은 2자 이상 30자 이하로 입력해주세요.' });
      const [exists] = await pool.execute('SELECT user_id FROM users WHERE name = ? AND user_id <> ? LIMIT 1', [name, targetUserId]);
      if (exists.length > 0) return res.status(409).json({ error: '이미 사용 중인 이름입니다.' });
      req.body.name = name;
    }

    if (req.body.grade !== undefined) {
      const grade = parseInteger(req.body.grade);
      if (!grade || grade < 1 || grade > MAX_GRADE) return res.status(400).json({ error: '학년 값이 올바르지 않습니다.' });
      req.body.grade = grade;
    }

    if (req.body.class_number !== undefined) {
      const classNumber = parseInteger(req.body.class_number);
      if (!classNumber || classNumber < 1 || classNumber > MAX_CLASS) return res.status(400).json({ error: '반 값이 올바르지 않습니다.' });
      req.body.class_number = classNumber;
    }

    if (req.body.is_alarm_enabled !== undefined) {
      req.body.is_alarm_enabled = normalizeBooleanFlag(req.body.is_alarm_enabled);
    }

    const allowed = ['name', 'grade', 'class_number', 'is_alarm_enabled'];
    const updates = [];
    const values = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    values.push(targetUserId);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, values);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, async (req, res) => {
  try {
    const adminUser = await ensureAdminAccess(req, res);
    if (!adminUser) return;
    const targetUserId = parseInteger(req.params.id);
    if (!targetUserId) return res.status(400).json({ error: '사용자 정보가 올바르지 않습니다.' });
    if (targetUserId === req.user.id) return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });

    const [rows] = await pool.execute('SELECT is_admin FROM users WHERE user_id = ? LIMIT 1', [targetUserId]);
    if (rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (isAdminUser(rows[0])) return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });

    await pool.execute('DELETE FROM users WHERE user_id = ?', [targetUserId]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    if (parseInteger(req.params.id) !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    if (req.body.name !== undefined) {
      const name = normalizeName(req.body.name);
      if (!name) return res.status(400).json({ error: '이름을 입력해주세요.' });
      if (name.length < 2 || name.length > 30) return res.status(400).json({ error: '이름은 2자 이상 30자 이하로 입력해주세요.' });
      const [exists] = await pool.execute('SELECT user_id FROM users WHERE name = ? AND user_id <> ? LIMIT 1', [name, req.params.id]);
      if (exists.length > 0) return res.status(409).json({ error: '이미 사용 중인 이름입니다.' });
      req.body.name = name;
    }
    if (req.body.is_alarm_enabled !== undefined) {
      req.body.is_alarm_enabled = normalizeBooleanFlag(req.body.is_alarm_enabled);
    }
    const allowed = ['name', 'is_alarm_enabled'];
    const updates = [];
    const values = [];
    for (const field of allowed) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    values.push(req.params.id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, values);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Assignments
app.get('/api/assignments', authMiddleware, async (req, res) => {
  try {
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (isAdminUser(user)) {
      const [rows] = await pool.execute(
        'SELECT a.*, u.name AS creator_name FROM assignments a JOIN users u ON a.created_by = u.user_id ORDER BY a.due_date ASC, a.target_grade ASC, a.target_class ASC, a.created_at DESC'
      );
      return res.json(rows);
    }
    const [rows] = await pool.execute(
      'SELECT a.*, u.name AS creator_name FROM assignments a JOIN users u ON a.created_by = u.user_id WHERE a.target_grade = ? AND (a.target_class = ? OR a.target_class IS NULL) ORDER BY a.due_date ASC',
      [user.grade, user.class_number]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/assignments', authMiddleware, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const content = req.body.content === undefined || req.body.content === null ? null : String(req.body.content).trim();
    const due_date = String(req.body.due_date || '');
    if (!title || !due_date) return res.status(400).json({ error: '과제명과 마감일은 필수입니다.' });
    if (title.length > 120) return res.status(400).json({ error: '과제명은 120자 이하로 입력해주세요.' });
    if (content && content.length > 2000) return res.status(400).json({ error: '과제 내용은 2000자 이하로 입력해주세요.' });
    if (!isValidDateOnly(due_date)) return res.status(400).json({ error: '마감일 형식이 올바르지 않습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    let target_grade = user.grade;
    let target_class = user.class_number;

    if (isAdminUser(user)) {
      target_grade = parseInteger(req.body.target_grade);
      target_class = parseInteger(req.body.target_class);
      if (!target_grade || target_grade < 1 || target_grade > MAX_GRADE) return res.status(400).json({ error: '대상 학년이 올바르지 않습니다.' });
      if (!target_class || target_class < 1 || target_class > MAX_CLASS) return res.status(400).json({ error: '대상 반이 올바르지 않습니다.' });
    }

    const [result] = await pool.execute('INSERT INTO assignments (title, content, due_date, target_grade, target_class, created_by) VALUES (?, ?, ?, ?, ?, ?)', [title, content || null, due_date, target_grade, target_class || null, req.user.id]);
    const assignmentId = result.insertId;
    const [students] = await pool.execute('SELECT user_id FROM users WHERE grade = ? AND class_number = ?', [target_grade, target_class]);
    for (const s of students) {
      await pool.execute('INSERT IGNORE INTO user_assignments (user_id, assignment_id, is_completed) VALUES (?, ?, 0)', [s.user_id, assignmentId]);
    }
    res.json({ assignment_id: assignmentId, success: true });
  } catch (e) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/assignments/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT created_by FROM assignments WHERE assignment_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    if (rows[0].created_by !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    const { title, content, due_date } = req.body;
    const updates = [];
    const values = [];
    if (title !== undefined) {
      const normalizedTitle = String(title).trim();
      if (!normalizedTitle || normalizedTitle.length > 120) return res.status(400).json({ error: '과제명은 1자 이상 120자 이하로 입력해주세요.' });
      updates.push('title = ?');
      values.push(normalizedTitle);
    }
    if (content !== undefined) {
      const normalizedContent = content === null ? null : String(content).trim();
      if (normalizedContent && normalizedContent.length > 2000) return res.status(400).json({ error: '과제 내용은 2000자 이하로 입력해주세요.' });
      updates.push('content = ?');
      values.push(normalizedContent);
    }
    if (due_date !== undefined) {
      if (!isValidDateOnly(due_date)) return res.status(400).json({ error: '마감일 형식이 올바르지 않습니다.' });
      updates.push('due_date = ?');
      values.push(due_date);
    }
    if (updates.length === 0) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    values.push(req.params.id);
    await pool.execute(`UPDATE assignments SET ${updates.join(', ')} WHERE assignment_id = ?`, values);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/assignments/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT created_by FROM assignments WHERE assignment_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (rows[0].created_by !== req.user.id && !isAdminUser(user)) return res.status(403).json({ error: '권한이 없습니다.' });
    await pool.execute('DELETE FROM assignments WHERE assignment_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// User Assignments (completion status)
app.get('/api/user-assignments/:userId', authMiddleware, async (req, res) => {
  try {
    if (parseInteger(req.params.userId) !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    const [rows] = await pool.execute('SELECT * FROM user_assignments WHERE user_id = ?', [req.params.userId]);
    const map = {};
    rows.forEach(r => { map[r.assignment_id] = r.is_completed; });
    res.json(map);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/user-assignments', authMiddleware, async (req, res) => {
  try {
    const assignmentId = parseInteger(req.body.assignment_id);
    if (!assignmentId) return res.status(400).json({ error: '과제 정보가 올바르지 않습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (isAdminUser(user)) return res.status(403).json({ error: '관리자 계정은 완료 처리를 할 수 없습니다.' });
    const [allowedRows] = await pool.execute(
      'SELECT assignment_id FROM assignments WHERE assignment_id = ? AND target_grade = ? AND (target_class = ? OR target_class IS NULL) LIMIT 1',
      [assignmentId, user.grade, user.class_number]
    );
    if (allowedRows.length === 0) return res.status(403).json({ error: '권한이 없습니다.' });
    const isCompleted = normalizeBooleanFlag(req.body.is_completed);
    await pool.execute(
      'INSERT INTO user_assignments (user_id, assignment_id, is_completed) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_completed = ?',
      [req.user.id, assignmentId, isCompleted, isCompleted]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/users/:userId/assignments', authMiddleware, async (req, res) => {
  try {
    const userId = parseInteger(req.params.userId);
    if (userId !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (isAdminUser(user)) {
      const [rows] = await pool.execute(
        'SELECT a.*, u.name AS creator_name, 0 AS is_completed FROM assignments a JOIN users u ON a.created_by = u.user_id ORDER BY a.due_date ASC, a.target_grade ASC, a.target_class ASC, a.created_at DESC'
      );
      return res.json(rows);
    }
    const [rows] = await pool.execute(
      'SELECT a.*, u.name AS creator_name, COALESCE(ua.is_completed, 0) AS is_completed FROM assignments a JOIN users u ON a.created_by = u.user_id LEFT JOIN user_assignments ua ON a.assignment_id = ua.assignment_id AND ua.user_id = ? WHERE a.target_grade = ? AND (a.target_class = ? OR a.target_class IS NULL) ORDER BY a.due_date ASC',
      [userId, user.grade, user.class_number]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Messages
app.get('/api/messages', authMiddleware, async (req, res) => {
  try {
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const type = req.query.type ? String(req.query.type) : null;
    if (type && !['grade', 'class'].includes(type)) return res.status(400).json({ error: '메세지 유형이 올바르지 않습니다.' });
    if (isAdminUser(user)) {
      let sql = 'SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON m.sender_id = u.user_id';
      const params = [];
      if (type) {
        sql += ' WHERE m.type = ?';
        params.push(type);
      }
      sql += ' ORDER BY m.created_at DESC';
      const [rows] = await pool.execute(sql, params);
      return res.json(rows);
    }
    let sql = 'SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON m.sender_id = u.user_id WHERE m.target_grade = ? AND ((m.type = ? AND m.target_class IS NULL) OR (m.type = ? AND m.target_class = ?))';
    const params = [user.grade, 'grade', 'class', user.class_number];
    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }
    sql += ' ORDER BY m.created_at DESC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const content = String(req.body.content || '').trim();
    const type = String(req.body.type || '');
    if (!content || !type) return res.status(400).json({ error: '내용과 유형은 필수입니다.' });
    if (!['grade', 'class'].includes(type)) return res.status(400).json({ error: '메세지 유형이 올바르지 않습니다.' });
    if (content.length > 1000) return res.status(400).json({ error: '메세지는 1000자 이하로 입력해주세요.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (!isAdminUser(user)) return res.status(403).json({ error: '학년 공지와 반 공지는 관리자만 보낼 수 있습니다.' });

    let target_grade = parseInteger(req.body.target_grade);
    let target_class = null;

    if (!target_grade || target_grade < 1 || target_grade > MAX_GRADE) return res.status(400).json({ error: '대상 학년이 올바르지 않습니다.' });
    if (type === 'class') {
      target_class = parseInteger(req.body.target_class);
      if (!target_class || target_class < 1 || target_class > MAX_CLASS) return res.status(400).json({ error: '대상 반이 올바르지 않습니다.' });
    }

    const [result] = await pool.execute('INSERT INTO messages (sender_id, content, type, target_grade, target_class) VALUES (?, ?, ?, ?, ?)', [req.user.id, content, type, target_grade, target_class || null]);
    res.json({ message_id: result.insertId, success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/messages/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT sender_id FROM messages WHERE message_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '메세지를 찾을 수 없습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (rows[0].sender_id !== req.user.id && !isAdminUser(user)) return res.status(403).json({ error: '권한이 없습니다.' });
    await pool.execute('DELETE FROM messages WHERE message_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'login.html'));
});

async function init() {
  let retries = 30;
  while (retries > 0) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      for (const statement of bootstrapSchema) {
        await conn.execute(statement);
      }
      await migrateSchema(conn);
      await seedAdminAccount(conn);
      conn.release();
      console.log(`MySQL connected: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
      app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
      return;
    } catch {
      retries--;
      console.log(`Waiting for MySQL... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('Failed to connect to MySQL');
  process.exit(1);
}

init();
