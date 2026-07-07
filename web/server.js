const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const OpenAI = require('openai');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 80;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = parseTrustProxySetting(process.env.TRUST_PROXY);
const JWT_SECRET = process.env.JWT_SECRET || (!IS_PRODUCTION ? crypto.randomBytes(32).toString('hex') : null);
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || null;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || null;
const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const GOOGLE_ALLOWED_DOMAIN = 'bssm.hs.kr';
const ADMIN_GOOGLE_EMAILS = Array.from(new Set(
  String(
    process.env.ADMIN_GOOGLE_EMAILS
    || process.env.ADMIN_GOOGLE_EMAIL
    || process.env.ADMIN_EMAIL
    || ''
  )
    .split(/[,\n]/)
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
));
const ADMIN_EXCLUDED_GOOGLE_EMAILS = Array.from(new Set(
  String(
    process.env.ADMIN_EXCLUDED_GOOGLE_EMAILS
    || process.env.ADMIN_EXCLUDED_EMAILS
    || ''
  )
    .split(/[,\n]/)
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
));
const ADMIN_NAME = process.env.ADMIN_NAME ? String(process.env.ADMIN_NAME).trim() : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const ADMIN_GRADE = Number.parseInt(process.env.ADMIN_GRADE || '1', 10);
const ADMIN_CLASS = Number.parseInt(process.env.ADMIN_CLASS || '1', 10);
const MAX_GRADE = 3;
const MAX_CLASS = 4;
const MAX_ASSIGNMENT_CONTENT_LENGTH = 12000;
const MAX_ASSIGNMENT_IMAGE_BYTES = 4 * 1024 * 1024;
const STATIC_ASSET_CACHE_SECONDS = 300;
const ADMIN_PAGE_SIZE_DEFAULT = 12;
const ADMIN_PAGE_SIZE_MAX = 50;
const AUTH_COOKIE_NAME = 'assignment_alarm_session';
const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT = 20;
const AUTH_RATE_MAX_TRACKED_CLIENTS = Math.max(Number.parseInt(process.env.AUTH_RATE_MAX_TRACKED_CLIENTS || '5000', 10) || 5000, 1000);
const CHATBOT_RATE_WINDOW_MS = Math.max(Number.parseInt(process.env.CHATBOT_RATE_WINDOW_MS || '300000', 10) || 300000, 60000);
const CHATBOT_RATE_LIMIT = Math.max(Number.parseInt(process.env.CHATBOT_RATE_LIMIT || '20', 10) || 20, 1);
const ASSIGNMENT_IMAGE_RATE_WINDOW_MS = Math.max(Number.parseInt(process.env.ASSIGNMENT_IMAGE_RATE_WINDOW_MS || '600000', 10) || 600000, 60000);
const ASSIGNMENT_IMAGE_RATE_LIMIT = Math.max(Number.parseInt(process.env.ASSIGNMENT_IMAGE_RATE_LIMIT || '10', 10) || 10, 1);
const ASSIGNMENT_WRITE_RATE_WINDOW_MS = Math.max(Number.parseInt(process.env.ASSIGNMENT_WRITE_RATE_WINDOW_MS || '600000', 10) || 600000, 60000);
const ASSIGNMENT_WRITE_RATE_LIMIT = Math.max(Number.parseInt(process.env.ASSIGNMENT_WRITE_RATE_LIMIT || '20', 10) || 20, 1);
const CHATBOT_MAX_MESSAGE_LENGTH = 2000;
const CHATBOT_MAX_HISTORY_ITEMS = 10;
const CHATBOT_CONTEXT_ASSIGNMENT_LIMIT = 8;
const CHATBOT_CONTEXT_CONTENT_LENGTH = 120;
const CHATBOT_CONTEXT_TITLE_LENGTH = 60;
const CHATBOT_RETRY_COUNT = Math.max(Number.parseInt(process.env.CHATBOT_RETRY_COUNT || '2', 10) || 2, 0);
const CHATBOT_RETRY_DELAY_MS = Math.max(Number.parseInt(process.env.CHATBOT_RETRY_DELAY_MS || '1500', 10) || 1500, 0);
const CHATBOT_RESPONSE_CACHE_TTL_MS = Math.max(Number.parseInt(process.env.CHATBOT_RESPONSE_CACHE_TTL_MS || '45000', 10) || 45000, 5000);
const authAttempts = new Map();
const chatbotAttempts = new Map();
const chatbotResponseCache = new Map();
const assignmentImageAttempts = new Map();
const assignmentWriteAttempts = new Map();
const adminUserCache = new Map();
const adminAssignmentCache = new Map();
const adminMessageCache = new Map();
const notificationCache = new Map();
const RESPONSE_CACHE_TTL_MS = 15 * 1000;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const gemini = GEMINI_API_KEY
  ? new OpenAI({ apiKey: GEMINI_API_KEY, baseURL: GEMINI_BASE_URL })
  : null;
const ASSIGNMENT_IMAGE_DIR = path.join(__dirname, 'src', 'uploads', 'assignment-images');
const ASSIGNMENT_IMAGE_PUBLIC_PATH = '/uploads/assignment-images';
const ASSIGNMENT_IMAGE_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif']
]);

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

function parseTrustProxySetting(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true') return true;
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isInteger(numeric) && String(numeric) === normalized) return numeric;
  return normalized;
}

function buildContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://generativelanguage.googleapis.com",
    "font-src 'self' data: https:",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "frame-src 'self' https://accounts.google.com",
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    "script-src 'self' https://accounts.google.com",
    "style-src 'self' 'unsafe-inline'"
  ].join('; ');
}

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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY users_grade_class_idx (grade, class_number)
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
    FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE,
    KEY assignments_scope_due_created_idx (target_grade, target_class, due_date, created_at),
    KEY assignments_created_at_idx (created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    message_id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    type ENUM('grade', 'class') NOT NULL,
    target_grade INT NOT NULL,
    target_class INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
    KEY messages_scope_type_created_idx (target_grade, type, target_class, created_at),
    KEY messages_created_at_idx (created_at)
  )`,
  `CREATE TABLE IF NOT EXISTS user_assignments (
    user_id INT NOT NULL,
    assignment_id INT NOT NULL,
    is_completed TINYINT(1) DEFAULT 0,
    PRIMARY KEY (user_id, assignment_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES assignments(assignment_id) ON DELETE CASCADE,
    KEY user_assignments_assignment_user_idx (assignment_id, user_id, is_completed)
  )`
];

app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', buildContentSecurityPolicy());
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  if (IS_PRODUCTION && req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'src'), {
  etag: true,
  lastModified: true,
  maxAge: IS_PRODUCTION ? `${STATIC_ASSET_CACHE_SECONDS}s` : 0,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (!IS_PRODUCTION) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (['.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) {
      res.setHeader('Cache-Control', `public, max-age=${STATIC_ASSET_CACHE_SECONDS}, must-revalidate`);
    }
  }
}));

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, limit) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(limit - 3, 1)).trim()}...`;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function parsePagination(query = {}) {
  const rawPage = parseInteger(query.page);
  const rawPageSize = parseInteger(query.pageSize);
  const page = rawPage && rawPage > 0 ? rawPage : 1;
  const pageSize = rawPageSize && rawPageSize > 0
    ? Math.min(rawPageSize, ADMIN_PAGE_SIZE_MAX)
    : ADMIN_PAGE_SIZE_DEFAULT;
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

function getCachedResponse(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > RESPONSE_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedResponse(cache, key, value) {
  cache.set(key, {
    value,
    cachedAt: Date.now()
  });
  return value;
}

function clearResponseCaches({ users = false, assignments = false, messages = false, notifications = false } = {}) {
  if (users) {
    adminUserCache.clear();
  }
  if (assignments) {
    adminAssignmentCache.clear();
  }
  if (messages) {
    adminMessageCache.clear();
  }
  if (notifications) {
    notificationCache.clear();
  }
}

function logApiError(label, error, metadata = null) {
  if (metadata) {
    console.error(`[API] ${label}`, metadata, error);
    return;
  }
  console.error(`[API] ${label}`, error);
}

function getAdminAssignmentCacheKey({ page, pageSize, grade, classNumber }) {
  return JSON.stringify({
    page,
    pageSize,
    grade: grade ?? 'all',
    classNumber: classNumber ?? 'all'
  });
}

function getAdminMessageCacheKey({ page, pageSize, type, grade, classNumber }) {
  return JSON.stringify({
    page,
    pageSize,
    type: type ?? 'all',
    grade: grade ?? 'all',
    classNumber: classNumber ?? 'all'
  });
}

function getNotificationCacheKey(user) {
  return JSON.stringify({
    userId: user.user_id,
    isAdmin: isAdminUser(user),
    grade: user.grade ?? null,
    classNumber: user.class_number ?? null
  });
}

function toSqlLimit(value, fallback) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return fallback;
  }
  return numeric;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getChatbotResponseCacheKey(userId, rawMessage, history) {
  return JSON.stringify({
    userId,
    rawMessage: String(rawMessage || '').trim(),
    history: Array.isArray(history)
      ? history.map((item) => ({
        role: item?.role,
        content: String(item?.content || '').trim()
      }))
      : []
  });
}

function getCachedChatbotResponse(cacheKey) {
  const entry = chatbotResponseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CHATBOT_RESPONSE_CACHE_TTL_MS) {
    chatbotResponseCache.delete(cacheKey);
    return null;
  }
  return entry.reply;
}

function setCachedChatbotResponse(cacheKey, reply) {
  chatbotResponseCache.set(cacheKey, {
    reply,
    cachedAt: Date.now()
  });
}

function isChatbotTransientError(error) {
  const status = Number(error?.status || error?.code || 0);
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();

  if ([408, 409, 425, 429].includes(status) || status >= 500) {
    return true;
  }

  return [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EAI_AGAIN',
    'ENOTFOUND'
  ].includes(code) || message.includes('timeout') || message.includes('timed out');
}

async function requestChatbotCompletion(messages) {
  let lastError = null;

  for (let attempt = 0; attempt <= CHATBOT_RETRY_COUNT; attempt += 1) {
    try {
      return await gemini.chat.completions.create({
        model: GEMINI_CHAT_MODEL,
        messages
      });
    } catch (error) {
      lastError = error;
      if (!isChatbotTransientError(error) || attempt >= CHATBOT_RETRY_COUNT) {
        throw error;
      }
      await wait(CHATBOT_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError || new Error('chatbot-request-failed');
}

function normalizeBooleanFlag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function isTeacherAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const [localPart = '', domain = ''] = normalized.split('@');
  return domain === GOOGLE_ALLOWED_DOMAIN && localPart.includes('teacher');
}

function isAdminEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (ADMIN_EXCLUDED_GOOGLE_EMAILS.includes(normalized)) return false;
  return ADMIN_GOOGLE_EMAILS.includes(normalized) || isTeacherAdminEmail(normalized);
}

function isAdminUser(user) {
  return normalizeBooleanFlag(user?.is_admin) === 1;
}

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function decodeAssignmentImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!match) {
    throw new Error('assignment-image-invalid');
  }

  const mimeType = match[1].toLowerCase();
  const extension = ASSIGNMENT_IMAGE_EXTENSIONS.get(mimeType);
  if (!extension) {
    throw new Error('assignment-image-type');
  }

  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new Error('assignment-image-invalid');
  }
  if (buffer.length > MAX_ASSIGNMENT_IMAGE_BYTES) {
    throw new Error('assignment-image-too-large');
  }

  return { buffer, extension };
}

function getAssignmentContentErrorMessage() {
  return `과제 내용은 ${MAX_ASSIGNMENT_CONTENT_LENGTH}자 이하로 입력해주세요.`;
}

function truncateText(value, maxLength = CHATBOT_MAX_MESSAGE_LENGTH) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength);
}

function normalizeChatHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({
      role: item.role,
      content: truncateText(item.content)
    }))
    .filter((item) => item.content)
    .slice(-CHATBOT_MAX_HISTORY_ITEMS);
}

function summarizeChatbotContextText(value, maxLength) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

async function buildChatbotContext(user) {
  const [rows] = await pool.execute(
    `SELECT a.assignment_id, a.title, a.content, a.due_date, COALESCE(ua.is_completed, 0) AS is_completed
       FROM assignments a
       LEFT JOIN user_assignments ua
         ON ua.assignment_id = a.assignment_id
        AND ua.user_id = ?
      WHERE a.target_grade = ?
        AND (a.target_class = ? OR a.target_class IS NULL)
      ORDER BY a.due_date ASC, a.created_at DESC
      LIMIT ${CHATBOT_CONTEXT_ASSIGNMENT_LIMIT}`,
    [user.user_id, user.grade, user.class_number]
  );

  const assignmentLines = rows.map((assignment) => {
    const title = summarizeChatbotContextText(assignment.title, CHATBOT_CONTEXT_TITLE_LENGTH) || '제목 없음';
    const contentSummary = summarizeChatbotContextText(assignment.content, CHATBOT_CONTEXT_CONTENT_LENGTH);
    const statusLabel = normalizeBooleanFlag(assignment.is_completed) ? '완료' : '미완료';
    const parts = [
      `- ${title}`,
      `마감 ${assignment.due_date || '미정'}`,
      statusLabel
    ];

    if (contentSummary) {
      parts.push(`내용 요약: ${contentSummary}`);
    }

    return parts.join(' / ');
  });

  return [
    '[사용자 기본 정보]',
    `- 소속: ${user.grade}학년 ${user.class_number}반`,
    '',
    '[현재 과제 요약]',
    assignmentLines.length > 0 ? assignmentLines.join('\n') : '- 현재 확인된 과제가 없습니다.'
  ].join('\n');
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

async function findLegacyUserForGoogleProfile(profile) {
  const normalizedName = normalizeGoogleName(profile?.name);
  if (!normalizedName) return null;
  const [rows] = await pool.execute(
    `SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled, is_admin, google_sub, google_email
       FROM users
      WHERE google_sub IS NULL
        AND name = ?
      LIMIT 1`,
    [normalizedName]
  );
  return rows[0] || null;
}

async function linkGoogleProfileToExistingUser(userId, profile, shouldGrantAdmin, overrides = {}) {
  const nextGrade = parseInteger(overrides.grade);
  const nextClassNumber = parseInteger(overrides.class_number);
  const shouldUpdateGrade = Number.isInteger(nextGrade) && nextGrade >= 1 && nextGrade <= MAX_GRADE;
  const shouldUpdateClass = Number.isInteger(nextClassNumber) && nextClassNumber >= 1 && nextClassNumber <= MAX_CLASS;

  const updates = [
    'google_sub = ?',
    'google_email = ?',
    'profile_image_url = COALESCE(?, profile_image_url)'
  ];
  const values = [
    profile.google_sub,
    profile.google_email,
    profile.profile_image_url
  ];

  if (shouldGrantAdmin) {
    updates.push('is_admin = 1');
  }
  if (shouldUpdateGrade) {
    updates.push('grade = ?');
    values.push(nextGrade);
  }
  if (shouldUpdateClass) {
    updates.push('class_number = ?');
    values.push(nextClassNumber);
  }

  values.push(userId);
  await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, values);

  const [rows] = await pool.execute(
    'SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled, is_admin, google_sub, google_email FROM users WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

function cleanupExpiredAttempts(store, now = Date.now()) {
  for (const [key, value] of store.entries()) {
    if (!value || value.expiresAt <= now) {
      store.delete(key);
    }
  }
}

function consumeRateLimitAttempt(store, key, { windowMs, limit, maxTrackedClients }, now = Date.now()) {
  cleanupExpiredAttempts(store, now);
  const entry = store.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (store.size >= maxTrackedClients) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) {
        store.delete(oldestKey);
      }
    }
    store.set(key, { count: 1, expiresAt: now + windowMs });
    return { allowed: true };
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: Math.max(entry.expiresAt - now, 1000) };
  }
  entry.count += 1;
  return { allowed: true };
}

function authRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const result = consumeRateLimitAttempt(
    authAttempts,
    key,
    {
      windowMs: AUTH_RATE_WINDOW_MS,
      limit: AUTH_RATE_LIMIT,
      maxTrackedClients: AUTH_RATE_MAX_TRACKED_CLIENTS
    },
    now
  );
  if (!result.allowed) {
    return res.status(429).json({ error: '잠시 후 다시 시도해주세요.' });
  }
  next();
}

function clearAuthRateLimit(req) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  authAttempts.delete(key);
}

function chatbotRateLimit(req, res, next) {
  const key = req.user?.id ? `user:${req.user.id}` : (req.ip || req.socket.remoteAddress || 'unknown');
  const result = consumeRateLimitAttempt(
    chatbotAttempts,
    key,
    {
      windowMs: CHATBOT_RATE_WINDOW_MS,
      limit: CHATBOT_RATE_LIMIT,
      maxTrackedClients: AUTH_RATE_MAX_TRACKED_CLIENTS
    }
  );

  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((result.retryAfterMs || CHATBOT_RATE_WINDOW_MS) / 1000)));
    return res.status(429).json({ error: '챗봇 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  next();
}

function assignmentImageRateLimit(req, res, next) {
  const key = req.user?.id ? `user:${req.user.id}` : (req.ip || req.socket.remoteAddress || 'unknown');
  const result = consumeRateLimitAttempt(
    assignmentImageAttempts,
    key,
    {
      windowMs: ASSIGNMENT_IMAGE_RATE_WINDOW_MS,
      limit: ASSIGNMENT_IMAGE_RATE_LIMIT,
      maxTrackedClients: AUTH_RATE_MAX_TRACKED_CLIENTS
    }
  );

  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((result.retryAfterMs || ASSIGNMENT_IMAGE_RATE_WINDOW_MS) / 1000)));
    return res.status(429).json({ error: '이미지 업로드 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  next();
}

function assignmentWriteRateLimit(req, res, next) {
  const key = req.user?.id ? `user:${req.user.id}` : (req.ip || req.socket.remoteAddress || 'unknown');
  const result = consumeRateLimitAttempt(
    assignmentWriteAttempts,
    key,
    {
      windowMs: ASSIGNMENT_WRITE_RATE_WINDOW_MS,
      limit: ASSIGNMENT_WRITE_RATE_LIMIT,
      maxTrackedClients: AUTH_RATE_MAX_TRACKED_CLIENTS
    }
  );

  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((result.retryAfterMs || ASSIGNMENT_WRITE_RATE_WINDOW_MS) / 1000)));
    return res.status(429).json({ error: '과제 변경 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  next();
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

async function ensureIndex(conn, tableName, indexName, definitionSql) {
  const [rows] = await conn.execute(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  if (rows.length === 0) {
    await conn.execute(`ALTER TABLE \`${tableName}\` ADD INDEX \`${indexName}\` ${definitionSql}`);
  }
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

  const [userCreatedAtColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'created_at'`
  );

  if (userCreatedAtColumns.length === 0) {
    await conn.execute('ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER is_admin');
  }

  const [assignmentAttachmentColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'assignments'
       AND COLUMN_NAME = 'attachment_url'`
  );

  if (assignmentAttachmentColumns.length > 0) {
    await conn.execute('ALTER TABLE assignments DROP COLUMN attachment_url');
  }

  await ensureIndex(conn, 'users', 'users_grade_class_idx', '(grade, class_number)');
  await ensureIndex(conn, 'assignments', 'assignments_scope_due_created_idx', '(target_grade, target_class, due_date, created_at)');
  await ensureIndex(conn, 'assignments', 'assignments_created_at_idx', '(created_at)');
  await ensureIndex(conn, 'messages', 'messages_scope_type_created_idx', '(target_grade, type, target_class, created_at)');
  await ensureIndex(conn, 'messages', 'messages_created_at_idx', '(created_at)');
  await ensureIndex(conn, 'user_assignments', 'user_assignments_assignment_user_idx', '(assignment_id, user_id, is_completed)');
}

async function cleanupOrphanedRecords(conn) {
  const [[orphanUserAssignmentsByUser]] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM user_assignments ua
       LEFT JOIN users u ON ua.user_id = u.user_id
      WHERE u.user_id IS NULL`
  );
  if (Number(orphanUserAssignmentsByUser.total) > 0) {
    await conn.execute(
      `DELETE ua
         FROM user_assignments ua
         LEFT JOIN users u ON ua.user_id = u.user_id
        WHERE u.user_id IS NULL`
    );
  }

  const [[orphanUserAssignmentsByAssignment]] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM user_assignments ua
       LEFT JOIN assignments a ON ua.assignment_id = a.assignment_id
      WHERE a.assignment_id IS NULL`
  );
  if (Number(orphanUserAssignmentsByAssignment.total) > 0) {
    await conn.execute(
      `DELETE ua
         FROM user_assignments ua
         LEFT JOIN assignments a ON ua.assignment_id = a.assignment_id
        WHERE a.assignment_id IS NULL`
    );
  }

  const [[orphanAssignments]] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM assignments a
       LEFT JOIN users u ON a.created_by = u.user_id
      WHERE u.user_id IS NULL`
  );
  if (Number(orphanAssignments.total) > 0) {
    await conn.execute(
      `DELETE a
         FROM assignments a
         LEFT JOIN users u ON a.created_by = u.user_id
        WHERE u.user_id IS NULL`
    );
  }

  const [[orphanMessages]] = await conn.execute(
    `SELECT COUNT(*) AS total
       FROM messages m
       LEFT JOIN users u ON m.sender_id = u.user_id
      WHERE u.user_id IS NULL`
  );
  if (Number(orphanMessages.total) > 0) {
    await conn.execute(
      `DELETE m
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.user_id
        WHERE u.user_id IS NULL`
    );
  }

  const summary = [
    Number(orphanUserAssignmentsByUser.total) || 0,
    Number(orphanUserAssignmentsByAssignment.total) || 0,
    Number(orphanAssignments.total) || 0,
    Number(orphanMessages.total) || 0
  ];
  if (summary.some((count) => count > 0)) {
    console.log(`Cleaned orphaned records: user_assignments(user)=${summary[0]}, user_assignments(assignment)=${summary[1]}, assignments=${summary[2]}, messages=${summary[3]}`);
  }
}

async function seedAdminAccount(conn) {
  if (ADMIN_EXCLUDED_GOOGLE_EMAILS.length > 0) {
    const excludedPlaceholders = ADMIN_EXCLUDED_GOOGLE_EMAILS.map(() => '?').join(', ');
    await conn.execute(
      `UPDATE users SET is_admin = 0 WHERE google_email IN (${excludedPlaceholders})`,
      ADMIN_EXCLUDED_GOOGLE_EMAILS
    );
  }

  const [teacherRows] = await conn.execute(
    'SELECT user_id, google_email FROM users WHERE google_email LIKE ?',
    [`%teacher%@${GOOGLE_ALLOWED_DOMAIN}`]
  );
  for (const row of teacherRows) {
    if (ADMIN_EXCLUDED_GOOGLE_EMAILS.includes(String(row.google_email || '').trim().toLowerCase())) {
      continue;
    }
    await conn.execute('UPDATE users SET is_admin = 1 WHERE user_id = ?', [row.user_id]);
    console.log(`Admin account synced by teacher email rule: ${row.google_email}`);
  }

  if (ADMIN_GOOGLE_EMAILS.length > 0) {
    const targetAdminEmails = ADMIN_GOOGLE_EMAILS.filter(email => !ADMIN_EXCLUDED_GOOGLE_EMAILS.includes(email));
    if (targetAdminEmails.length > 0) {
      const placeholders = targetAdminEmails.map(() => '?').join(', ');
      const [googleRows] = await conn.execute(
        `SELECT user_id, google_email FROM users WHERE google_email IN (${placeholders})`,
        targetAdminEmails
      );
      for (const row of googleRows) {
        await conn.execute('UPDATE users SET is_admin = 1 WHERE user_id = ?', [row.user_id]);
        console.log(`Admin account synced by email: ${row.google_email}`);
      }
    }
  }

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
    googleClientId: GOOGLE_CLIENT_ID || null,
    chatbotEnabled: Boolean(GEMINI_API_KEY)
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
      const shouldGrantAdmin = isAdminEmail(profile.google_email);
      if (shouldGrantAdmin && !isAdminUser(existingUser)) {
        await pool.execute('UPDATE users SET is_admin = 1 WHERE user_id = ?', [existingUser.user_id]);
      }

      await pool.execute(
        'UPDATE users SET google_email = ?, profile_image_url = COALESCE(?, profile_image_url) WHERE user_id = ?',
        [profile.google_email, profile.profile_image_url, existingUser.user_id]
      );

      const user = {
        id: existingUser.user_id,
        name: existingUser.name,
        grade: existingUser.grade,
        class_number: existingUser.class_number,
        is_admin: shouldGrantAdmin ? 1 : existingUser.is_admin
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
          is_admin: shouldGrantAdmin ? 1 : existingUser.is_admin
        }
      });
    }

    const legacyUser = await findLegacyUserForGoogleProfile(profile);
    if (legacyUser) {
      const shouldGrantAdmin = isAdminEmail(profile.google_email);
      const linkedUser = await linkGoogleProfileToExistingUser(legacyUser.user_id, profile, shouldGrantAdmin);
      const user = {
        id: linkedUser.user_id,
        name: linkedUser.name,
        grade: linkedUser.grade,
        class_number: linkedUser.class_number,
        is_admin: linkedUser.is_admin
      };
      setAuthCookie(res, createToken(user));
      clearAuthRateLimit(req);
      return res.json({
        user: {
          id: linkedUser.user_id,
          name: linkedUser.name,
          grade: linkedUser.grade,
          class_number: linkedUser.class_number,
          profile_image_url: linkedUser.profile_image_url,
          is_alarm_enabled: linkedUser.is_alarm_enabled,
          is_admin: linkedUser.is_admin
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
      const shouldGrantAdmin = isAdminEmail(decoded.profile.google_email);
      if (shouldGrantAdmin && !isAdminUser(existingUser)) {
        await pool.execute('UPDATE users SET is_admin = 1 WHERE user_id = ?', [existingUser.user_id]);
      }
      const user = {
        id: existingUser.user_id,
        name: existingUser.name,
        grade: existingUser.grade,
        class_number: existingUser.class_number,
        is_admin: shouldGrantAdmin ? 1 : existingUser.is_admin
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
          is_admin: shouldGrantAdmin ? 1 : existingUser.is_admin
        }
      });
    }

    const legacyUser = await findLegacyUserForGoogleProfile(decoded.profile);
    if (legacyUser) {
      const shouldGrantAdmin = isAdminEmail(decoded.profile.google_email);
      const linkedUser = await linkGoogleProfileToExistingUser(
        legacyUser.user_id,
        decoded.profile,
        shouldGrantAdmin,
        { grade, class_number }
      );
      const user = {
        id: linkedUser.user_id,
        name: linkedUser.name,
        grade: linkedUser.grade,
        class_number: linkedUser.class_number,
        is_admin: linkedUser.is_admin
      };
      setAuthCookie(res, createToken(user));
      clearAuthRateLimit(req);
      return res.json({
        user: {
          id: linkedUser.user_id,
          name: linkedUser.name,
          grade: linkedUser.grade,
          class_number: linkedUser.class_number,
          profile_image_url: linkedUser.profile_image_url,
          is_alarm_enabled: linkedUser.is_alarm_enabled,
          is_admin: linkedUser.is_admin
        }
      });
    }

    const uniqueName = normalizeGoogleName(decoded.profile.name);
    const isAdmin = isAdminEmail(decoded.profile.google_email) ? 1 : 0;
    const passwordHash = await bcrypt.hash(`google:${decoded.profile.google_sub}:${crypto.randomBytes(8).toString('hex')}`, 10);
    const [result] = await pool.execute(
      'INSERT INTO users (password, name, google_sub, google_email, grade, class_number, profile_image_url, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        passwordHash,
        uniqueName,
        decoded.profile.google_sub,
        decoded.profile.google_email,
        grade,
        class_number,
        decoded.profile.profile_image_url,
        isAdmin
      ]
    );

    const user = { id: result.insertId, name: uniqueName, grade, class_number, is_admin: isAdmin };
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
        is_admin: isAdmin
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

app.post('/api/uploads/assignment-image', authMiddleware, assignmentImageRateLimit, async (req, res) => {
  try {
    const imageDataUrl = String(req.body.image_data_url || '');
    if (!imageDataUrl) {
      return res.status(400).json({ error: '이미지 데이터가 필요합니다.' });
    }

    const user = await getCurrentUser(req.user.id);
    if (!user) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    let decoded;
    try {
      decoded = decodeAssignmentImageDataUrl(imageDataUrl);
    } catch (error) {
      const message = error?.message === 'assignment-image-too-large'
        ? '이미지는 4MB 이하만 업로드할 수 있습니다.'
        : error?.message === 'assignment-image-type'
          ? 'PNG, JPG, WEBP, GIF 이미지만 업로드할 수 있습니다.'
          : '이미지 형식이 올바르지 않습니다.';
      return res.status(400).json({ error: message });
    }

    const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${decoded.extension}`;
    await fs.writeFile(path.join(ASSIGNMENT_IMAGE_DIR, filename), decoded.buffer);

    res.json({
      success: true,
      url: `${ASSIGNMENT_IMAGE_PUBLIC_PATH}/${filename}`,
      markdown: `![첨부 이미지](${ASSIGNMENT_IMAGE_PUBLIC_PATH}/${filename})`
    });
  } catch {
    res.status(500).json({ error: '이미지 업로드에 실패했습니다.' });
  }
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
    const { page, pageSize, offset } = parsePagination(req.query);
    const safePageSize = toSqlLimit(pageSize, ADMIN_PAGE_SIZE_DEFAULT);
    const safeOffset = toSqlLimit(offset, 0);
    const cacheKey = JSON.stringify({ page, pageSize, scope: 'admin-users' });
    const cached = getCachedResponse(adminUserCache, cacheKey);
    if (cached) {
      return res.json(cached);
    }
    const [[countRow]] = await pool.execute('SELECT COUNT(*) AS total FROM users');
    const [rows] = await pool.execute(
      `SELECT user_id, name, grade, class_number, is_alarm_enabled, is_admin, created_at
         FROM users
        ORDER BY is_admin DESC, grade ASC, class_number ASC, name ASC
        LIMIT ${safePageSize} OFFSET ${safeOffset}`
    );
    const payload = {
      items: rows,
      total: Number(countRow.total) || 0,
      page,
      pageSize
    };
    res.json(setCachedResponse(adminUserCache, cacheKey, payload));
  } catch (error) {
    logApiError('GET /api/admin/users failed', error, { query: req.query, userId: req.user?.id });
    res.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: ADMIN_PAGE_SIZE_DEFAULT
    });
  }
});

app.get('/api/admin/assignments', authMiddleware, async (req, res) => {
  try {
    const adminUser = await ensureAdminAccess(req, res);
    if (!adminUser) return;

    const { page, pageSize, offset } = parsePagination(req.query);
    const safePageSize = toSqlLimit(pageSize, ADMIN_PAGE_SIZE_DEFAULT);
    const safeOffset = toSqlLimit(offset, 0);
    const grade = req.query.grade && req.query.grade !== 'all' ? parseInteger(req.query.grade) : null;
    const classNumber = req.query.class_number && req.query.class_number !== 'all' ? parseInteger(req.query.class_number) : null;

    if (grade !== null && (grade < 1 || grade > MAX_GRADE)) {
      return res.status(400).json({ error: '학년 값이 올바르지 않습니다.' });
    }
    if (classNumber !== null && (classNumber < 1 || classNumber > MAX_CLASS)) {
      return res.status(400).json({ error: '반 값이 올바르지 않습니다.' });
    }

    const cacheKey = getAdminAssignmentCacheKey({ page, pageSize, grade, classNumber });
    const cached = getCachedResponse(adminAssignmentCache, cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const conditions = [];
    const params = [];
    if (grade !== null) {
      conditions.push('a.target_grade = ?');
      params.push(grade);
    }
    if (classNumber !== null) {
      conditions.push('a.target_class = ?');
      params.push(classNumber);
    }
    const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM assignments a${whereSql}`,
      params
    );
    const [rows] = await pool.execute(
        `SELECT a.*, COALESCE(u.name, '삭제된 사용자') AS creator_name
           FROM assignments a
           LEFT JOIN users u ON a.created_by = u.user_id${whereSql}
          ORDER BY a.due_date ASC, a.target_grade ASC, a.target_class ASC, a.created_at DESC
          LIMIT ${safePageSize} OFFSET ${safeOffset}`,
        params
      );

    const payload = {
      items: rows,
      total: Number(countRow.total) || 0,
      page,
      pageSize
    };
    res.json(setCachedResponse(adminAssignmentCache, cacheKey, payload));
  } catch (error) {
    logApiError('GET /api/admin/assignments failed', error, { query: req.query, userId: req.user?.id });
    res.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: ADMIN_PAGE_SIZE_DEFAULT
    });
  }
});

app.get('/api/admin/messages', authMiddleware, async (req, res) => {
  try {
    const adminUser = await ensureAdminAccess(req, res);
    if (!adminUser) return;

    const { page, pageSize, offset } = parsePagination(req.query);
    const safePageSize = toSqlLimit(pageSize, ADMIN_PAGE_SIZE_DEFAULT);
    const safeOffset = toSqlLimit(offset, 0);
    const type = req.query.type ? String(req.query.type) : null;
    const grade = req.query.grade && req.query.grade !== 'all' ? parseInteger(req.query.grade) : null;
    const classNumber = req.query.class_number && req.query.class_number !== 'all' ? parseInteger(req.query.class_number) : null;

    if (type && !['grade', 'class'].includes(type)) {
      return res.status(400).json({ error: '메세지 유형이 올바르지 않습니다.' });
    }
    if (grade !== null && (grade < 1 || grade > MAX_GRADE)) {
      return res.status(400).json({ error: '학년 값이 올바르지 않습니다.' });
    }
    if (classNumber !== null && (classNumber < 1 || classNumber > MAX_CLASS)) {
      return res.status(400).json({ error: '반 값이 올바르지 않습니다.' });
    }

    const cacheKey = getAdminMessageCacheKey({ page, pageSize, type, grade, classNumber });
    const cached = getCachedResponse(adminMessageCache, cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const conditions = [];
    const params = [];
    if (type) {
      conditions.push('m.type = ?');
      params.push(type);
    }
    if (grade !== null) {
      conditions.push('m.target_grade = ?');
      params.push(grade);
    }
    if (type === 'class' && classNumber !== null) {
      conditions.push('m.target_class = ?');
      params.push(classNumber);
    }
    const whereSql = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM messages m${whereSql}`,
      params
    );
    const [rows] = await pool.execute(
        `SELECT m.*, COALESCE(u.name, '삭제된 사용자') AS sender_name
           FROM messages m
           LEFT JOIN users u ON m.sender_id = u.user_id${whereSql}
          ORDER BY m.created_at DESC
          LIMIT ${safePageSize} OFFSET ${safeOffset}`,
        params
      );

    const payload = {
      items: rows,
      total: Number(countRow.total) || 0,
      page,
      pageSize
    };
    res.json(setCachedResponse(adminMessageCache, cacheKey, payload));
  } catch (error) {
    logApiError('GET /api/admin/messages failed', error, { query: req.query, userId: req.user?.id });
    res.json({
      items: [],
      total: 0,
      page: 1,
      pageSize: ADMIN_PAGE_SIZE_DEFAULT
    });
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
        return res.status(400).json({ error: '이름은 변경할 수 없습니다.' });
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

      const allowed = ['grade', 'class_number', 'is_alarm_enabled'];
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
    clearResponseCaches({ users: true, notifications: true });
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

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.execute('DELETE FROM user_assignments WHERE user_id = ?', [targetUserId]);
        await connection.execute('DELETE FROM user_assignments WHERE assignment_id IN (SELECT assignment_id FROM assignments WHERE created_by = ?)', [targetUserId]);
        await connection.execute('DELETE FROM assignments WHERE created_by = ?', [targetUserId]);
        await connection.execute('DELETE FROM messages WHERE sender_id = ?', [targetUserId]);
        await connection.execute('DELETE FROM users WHERE user_id = ?', [targetUserId]);

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      clearResponseCaches({ users: true, assignments: true, messages: true, notifications: true });
      res.json({ success: true });
    } catch (error) {
      logApiError('DELETE /api/admin/users/:id failed', error, { targetUserId: req.params.id, actorUserId: req.user?.id });
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  });

  app.put('/api/users/:id', authMiddleware, async (req, res) => {
    try {
      if (parseInteger(req.params.id) !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
      if (req.body.name !== undefined) {
        return res.status(400).json({ error: '이름은 변경할 수 없습니다.' });
      }
      if (req.body.is_alarm_enabled !== undefined) {
        req.body.is_alarm_enabled = normalizeBooleanFlag(req.body.is_alarm_enabled);
      }
      const allowed = ['is_alarm_enabled'];
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
          'SELECT a.*, COALESCE(u.name, \'삭제된 사용자\') AS creator_name FROM assignments a LEFT JOIN users u ON a.created_by = u.user_id ORDER BY a.due_date ASC, a.target_grade ASC, a.target_class ASC, a.created_at DESC'
        );
        return res.json(rows);
      }
      const [rows] = await pool.execute(
        'SELECT a.*, COALESCE(u.name, \'삭제된 사용자\') AS creator_name FROM assignments a LEFT JOIN users u ON a.created_by = u.user_id WHERE a.target_grade = ? AND (a.target_class = ? OR a.target_class IS NULL) ORDER BY a.due_date ASC',
        [user.grade, user.class_number]
      );
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/assignments', authMiddleware, assignmentWriteRateLimit, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const content = req.body.content === undefined || req.body.content === null ? null : String(req.body.content).trim();
    const due_date = String(req.body.due_date || '');
    if (!title || !due_date) return res.status(400).json({ error: '과제명과 마감일은 필수입니다.' });
    if (title.length > 120) return res.status(400).json({ error: '과제명은 120자 이하로 입력해주세요.' });
    if (content && content.length > MAX_ASSIGNMENT_CONTENT_LENGTH) return res.status(400).json({ error: getAssignmentContentErrorMessage() });
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

    const [result] = await pool.execute(
      'INSERT INTO assignments (title, content, due_date, target_grade, target_class, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [title, content || null, due_date, target_grade, target_class || null, req.user.id]
    );
    const assignmentId = result.insertId;
    const [students] = await pool.execute('SELECT user_id FROM users WHERE grade = ? AND class_number = ?', [target_grade, target_class]);
    for (const s of students) {
      await pool.execute('INSERT IGNORE INTO user_assignments (user_id, assignment_id, is_completed) VALUES (?, ?, 0)', [s.user_id, assignmentId]);
    }

    clearResponseCaches({ assignments: true, notifications: true });
    res.json({ assignment_id: assignmentId, success: true });
  } catch (e) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/assignments/:id', authMiddleware, assignmentWriteRateLimit, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT created_by, target_grade, target_class FROM assignments WHERE assignment_id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (rows[0].created_by !== req.user.id && !isAdminUser(user)) return res.status(403).json({ error: '권한이 없습니다.' });
    const { title, content, due_date } = req.body;
    const currentAssignment = rows[0];
    const updates = [];
    const values = [];
    let nextTargetGrade = currentAssignment.target_grade;
    let nextTargetClass = currentAssignment.target_class;

    if (title !== undefined) {
      const normalizedTitle = String(title).trim();
      if (!normalizedTitle || normalizedTitle.length > 120) return res.status(400).json({ error: '과제명은 1자 이상 120자 이하로 입력해주세요.' });
      updates.push('title = ?');
      values.push(normalizedTitle);
    }
    if (content !== undefined) {
      const normalizedContent = content === null ? null : String(content).trim();
      if (normalizedContent && normalizedContent.length > MAX_ASSIGNMENT_CONTENT_LENGTH) return res.status(400).json({ error: getAssignmentContentErrorMessage() });
      updates.push('content = ?');
      values.push(normalizedContent);
    }
    if (due_date !== undefined) {
      if (!isValidDateOnly(due_date)) return res.status(400).json({ error: '마감일 형식이 올바르지 않습니다.' });
      updates.push('due_date = ?');
      values.push(due_date);
    }
    if (isAdminUser(user)) {
      if (req.body.target_grade !== undefined) {
        nextTargetGrade = parseInteger(req.body.target_grade);
        if (!nextTargetGrade || nextTargetGrade < 1 || nextTargetGrade > MAX_GRADE) {
          return res.status(400).json({ error: '대상 학년이 올바르지 않습니다.' });
        }
        updates.push('target_grade = ?');
        values.push(nextTargetGrade);
      }
      if (req.body.target_class !== undefined) {
        nextTargetClass = parseInteger(req.body.target_class);
        if (!nextTargetClass || nextTargetClass < 1 || nextTargetClass > MAX_CLASS) {
          return res.status(400).json({ error: '대상 반이 올바르지 않습니다.' });
        }
        updates.push('target_class = ?');
        values.push(nextTargetClass);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: '수정할 내용이 없습니다.' });
    values.push(req.params.id);
    await pool.execute(`UPDATE assignments SET ${updates.join(', ')} WHERE assignment_id = ?`, values);

    if (nextTargetGrade !== currentAssignment.target_grade || nextTargetClass !== currentAssignment.target_class) {
      await pool.execute('DELETE FROM user_assignments WHERE assignment_id = ?', [req.params.id]);
      const [students] = await pool.execute(
        'SELECT user_id FROM users WHERE grade = ? AND class_number = ?',
        [nextTargetGrade, nextTargetClass]
      );
      for (const student of students) {
        await pool.execute(
          'INSERT IGNORE INTO user_assignments (user_id, assignment_id, is_completed) VALUES (?, ?, 0)',
          [student.user_id, req.params.id]
        );
      }
    }

    clearResponseCaches({ assignments: true, notifications: true });
    res.json({ success: true });
  } catch (error) {
    logApiError('PUT /api/assignments/:id failed', error, { assignmentId: req.params.id, actorUserId: req.user?.id });
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/assignments/:id/status', authMiddleware, async (req, res) => {
  try {
    const assignmentId = parseInteger(req.params.id);
    if (!assignmentId) return res.status(400).json({ error: '과제 정보가 올바르지 않습니다.' });

    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (!isAdminUser(user)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });

    const [assignmentRows] = await pool.execute(
      'SELECT assignment_id, title, target_grade, target_class FROM assignments WHERE assignment_id = ? LIMIT 1',
      [assignmentId]
    );
    if (assignmentRows.length === 0) return res.status(404).json({ error: '과제를 찾을 수 없습니다.' });

    const assignment = assignmentRows[0];
    const [students] = await pool.execute(
      `SELECT u.user_id, u.name, u.grade, u.class_number, COALESCE(ua.is_completed, 0) AS is_completed
       FROM users u
       LEFT JOIN user_assignments ua
         ON ua.user_id = u.user_id AND ua.assignment_id = ?
       WHERE u.is_admin = 0
         AND u.grade = ?
         AND (? IS NULL OR u.class_number = ?)
       ORDER BY u.class_number ASC, u.name ASC`,
      [assignmentId, assignment.target_grade, assignment.target_class, assignment.target_class]
    );

    res.json({
      assignment,
      students
    });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/assignments/:id', authMiddleware, assignmentWriteRateLimit, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT created_by FROM assignments WHERE assignment_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '과제를 찾을 수 없습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    if (rows[0].created_by !== req.user.id && !isAdminUser(user)) return res.status(403).json({ error: '권한이 없습니다.' });
    await pool.execute('DELETE FROM assignments WHERE assignment_id = ?', [req.params.id]);
    clearResponseCaches({ assignments: true, notifications: true });
    res.json({ success: true });
  } catch (error) {
    logApiError('DELETE /api/assignments/:id failed', error, { assignmentId: req.params.id, actorUserId: req.user?.id });
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
          'SELECT a.*, COALESCE(u.name, \'삭제된 사용자\') AS creator_name, 0 AS is_completed FROM assignments a LEFT JOIN users u ON a.created_by = u.user_id ORDER BY a.due_date ASC, a.target_grade ASC, a.target_class ASC, a.created_at DESC'
        );
        return res.json(rows);
      }
      const [rows] = await pool.execute(
        'SELECT a.*, COALESCE(u.name, \'삭제된 사용자\') AS creator_name, COALESCE(ua.is_completed, 0) AS is_completed FROM assignments a LEFT JOIN users u ON a.created_by = u.user_id LEFT JOIN user_assignments ua ON a.assignment_id = ua.assignment_id AND ua.user_id = ? WHERE a.target_grade = ? AND (a.target_class = ? OR a.target_class IS NULL) ORDER BY a.due_date ASC',
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
        let sql = 'SELECT m.*, COALESCE(u.name, \'삭제된 사용자\') AS sender_name FROM messages m LEFT JOIN users u ON m.sender_id = u.user_id';
      const params = [];
      if (type) {
        sql += ' WHERE m.type = ?';
        params.push(type);
      }
      sql += ' ORDER BY m.created_at DESC';
      const [rows] = await pool.execute(sql, params);
      return res.json(rows);
    }
      let sql = 'SELECT m.*, COALESCE(u.name, \'삭제된 사용자\') AS sender_name FROM messages m LEFT JOIN users u ON m.sender_id = u.user_id WHERE m.target_grade = ? AND ((m.type = ? AND m.target_class IS NULL) OR (m.type = ? AND m.target_class = ?))';
    const params = [user.grade, 'grade', 'class', user.class_number];
    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }
    sql += ' ORDER BY m.created_at DESC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (error) {
    logApiError('GET /api/messages failed', error, { query: req.query, userId: req.user?.id });
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/notifications', authMiddleware, async (req, res) => {
  try {
    const limit = 12;
    const currentUser = await getCurrentUser(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const cacheKey = getNotificationCacheKey(currentUser);
    const cached = getCachedResponse(notificationCache, cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let assignmentSql = `
        SELECT a.assignment_id, a.title, a.due_date, a.created_at, a.target_grade, a.target_class, COALESCE(u.name, '삭제된 사용자') AS creator_name
        FROM assignments a
        LEFT JOIN users u ON a.created_by = u.user_id
      `;
    let assignmentParams = [];

    let messageSql = `
        SELECT m.message_id, m.content, m.created_at, m.type, m.target_grade, m.target_class, COALESCE(u.name, '삭제된 사용자') AS sender_name
        FROM messages m
        LEFT JOIN users u ON m.sender_id = u.user_id
      `;
    let messageParams = [];

    if (!isAdminUser(currentUser)) {
      assignmentSql += ' WHERE a.target_grade = ? AND (a.target_class = ? OR a.target_class IS NULL)';
      assignmentParams = [currentUser.grade, currentUser.class_number];

      messageSql += ' WHERE m.target_grade = ? AND ((m.type = ? AND m.target_class IS NULL) OR (m.type = ? AND m.target_class = ?))';
      messageParams = [currentUser.grade, 'grade', 'class', currentUser.class_number];
    }

    assignmentSql += ` ORDER BY a.created_at DESC LIMIT ${limit}`;

    messageSql += ` ORDER BY m.created_at DESC LIMIT ${limit}`;

    const [assignmentResult, messageResult] = await Promise.all([
      pool.execute(assignmentSql, assignmentParams).catch((error) => {
        logApiError('GET /api/notifications assignments query failed', error, { userId: currentUser.user_id });
        return [[]];
      }),
      pool.execute(messageSql, messageParams).catch((error) => {
        logApiError('GET /api/notifications messages query failed', error, { userId: currentUser.user_id });
        return [[]];
      })
    ]);
    const assignmentRows = Array.isArray(assignmentResult?.[0]) ? assignmentResult[0] : [];
    const messageRows = Array.isArray(messageResult?.[0]) ? messageResult[0] : [];

    const items = [
      ...assignmentRows.map((assignment) => ({
        id: `assignment-${assignment.assignment_id}`,
        created_at: assignment.created_at,
        title: '새 과제',
        body: assignment.title,
        meta: `${assignment.creator_name || '선생님'} · 마감 ${assignment.due_date}`,
        link: 'calendar.html',
        kind: 'assignment'
      })),
      ...messageRows.map((message) => ({
        id: `message-${message.message_id}`,
        created_at: message.created_at,
        title: message.type === 'grade' ? '학년 공지' : '반 공지',
        body: message.content,
        meta: `${message.sender_name} · ${message.type === 'grade' ? `${message.target_grade}학년` : `${message.target_grade}학년 ${message.target_class}반`}`,
        link: 'messages.html',
        kind: 'message'
      }))
    ]
      .filter((item) => item.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);

    res.json(setCachedResponse(notificationCache, cacheKey, items));
  } catch (error) {
    logApiError('GET /api/notifications failed', error, { userId: req.user?.id });
    res.json([]);
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

    clearResponseCaches({ messages: true, notifications: true });
    res.json({ message_id: result.insertId, success: true });
  } catch (error) {
    logApiError('POST /api/messages failed', error, { actorUserId: req.user?.id, body: req.body });
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
    clearResponseCaches({ messages: true, notifications: true });
    res.json({ success: true });
  } catch (error) {
    logApiError('DELETE /api/messages/:id failed', error, { messageId: req.params.id, actorUserId: req.user?.id });
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/chatbot', authMiddleware, chatbotRateLimit, async (req, res) => {
  try {
    if (!gemini) {
      return res.status(503).json({ success: false, error: 'AI 챗봇이 아직 설정되지 않았습니다. 관리자에게 문의해주세요.' });
    }

    const currentUser = await getCurrentUser(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const rawMessage = String(req.body.message || '').trim();
    if (!rawMessage) return res.status(400).json({ error: '질문을 입력해주세요.' });
    if (rawMessage.length > CHATBOT_MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `질문은 ${CHATBOT_MAX_MESSAGE_LENGTH}자 이하로 입력해주세요.` });
    }

    const history = normalizeChatHistory(req.body.history);
    const cacheKey = getChatbotResponseCacheKey(currentUser.user_id, rawMessage, history);
    const cachedReply = getCachedChatbotResponse(cacheKey);
    if (cachedReply) {
      return res.json({
        success: true,
        reply: cachedReply
      });
    }

    const chatbotContext = await buildChatbotContext(currentUser);
    const messages = [
      {
        role: 'system',
        content: [
          '너는 "과제 알리미" 서비스 안에서 동작하는 한국어 챗봇이다.',
          '항상 한국어로 답하고, 짧고 실용적으로 설명한다.',
          '학교 과제 관리와 학습 계획에 도움이 되는 방향으로 답한다.',
          '아래 컨텍스트에는 사용자의 학년/반과 과제 요약만 포함되어 있다.',
          '사용자 이름, 작성자 이름, 다른 학생 정보, 공지 원문 같은 민감한 정보는 모른다고 전제한다.',
          '과제 본문은 요약본만 전달되므로 세부 지시가 더 필요하면 사용자에게 해당 부분만 직접 보내달라고 안내한다.',
          '제공된 과제 요약 범위를 넘는 정보는 추측하지 않는다.',
          '',
          chatbotContext
        ].join('\n')
      },
      ...history,
      {
        role: 'user',
        content: rawMessage
      }
    ];
    const response = await requestChatbotCompletion(messages);

    const reply = String(response.choices?.[0]?.message?.content || '').trim();
    if (!reply) {
      return res.status(502).json({ error: '챗봇 응답이 비어 있습니다. 잠시 후 다시 시도해주세요.' });
    }

    setCachedChatbotResponse(cacheKey, reply);
    res.json({
      success: true,
      reply
    });
  } catch (error) {
    logApiError('POST /api/chatbot failed', error, { userId: req.user?.id });
    if (error?.status === 401 || error?.status === 403) {
      return res.status(502).json({ success: false, error: 'AI 챗봇 설정에 문제가 있습니다. 관리자에게 문의해주세요.' });
    }
    if (error?.status === 429) {
      return res.status(503).json({ success: false, error: 'AI 사용량 한도에 잠시 걸렸습니다. 1~2분 후 다시 시도해주세요.' });
    }
    if (isChatbotTransientError(error)) {
      return res.status(503).json({ success: false, error: 'AI 서버 연결이 잠시 불안정합니다. 잠시 후 다시 시도해주세요.' });
    }
    res.json({
      success: false,
      error: '챗봇 응답을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.'
    });
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
      await fs.mkdir(ASSIGNMENT_IMAGE_DIR, { recursive: true });
      const conn = await pool.getConnection();
      await conn.ping();
        for (const statement of bootstrapSchema) {
          await conn.execute(statement);
        }
        await migrateSchema(conn);
        await cleanupOrphanedRecords(conn);
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
