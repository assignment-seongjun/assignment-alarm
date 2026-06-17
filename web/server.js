const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 80;
const JWT_SECRET = process.env.JWT_SECRET || 'assignment-alarm-secret-key-2024';

const dbConfig = {
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'mysql',
  port: Number(process.env.MYSQLPORT || process.env.DB_PORT) || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || 'user',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || 'userpassword',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'assignment_alarm',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true
};

const pool = mysql.createPool(dbConfig);

const bootstrapSchema = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL UNIQUE,
    grade INT NOT NULL,
    class_number INT NOT NULL,
    profile_image_url VARCHAR(500) DEFAULT NULL,
    is_alarm_enabled TINYINT(1) DEFAULT 1,
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'src'), { maxAge: 0, etag: false, lastModified: false }));

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '토큰이 만료되었습니다.' });
  }
}

async function getCurrentUser(userId) {
  const [rows] = await pool.execute('SELECT user_id, name, grade, class_number FROM users WHERE user_id = ?', [userId]);
  return rows[0] || null;
}

async function migrateSchema(conn) {
  const [emailColumns] = await conn.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'users'
       AND COLUMN_NAME = 'email'`
  );

  if (emailColumns.length > 0) {
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
}

// Auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const { password, grade, class_number } = req.body;
    if (!password || !name || !grade || !class_number) return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    const [exists] = await pool.execute('SELECT user_id FROM users WHERE name = ? LIMIT 1', [name]);
    if (exists.length > 0) return res.status(409).json({ error: '이미 사용 중인 이름입니다.' });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute('INSERT INTO users (password, name, grade, class_number) VALUES (?, ?, ?, ?)', [hash, name, grade, class_number]);
    const token = jwt.sign({ id: result.insertId, name, grade, class_number }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.insertId, name, grade, class_number } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '이미 사용 중인 이름입니다.' });
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const { password } = req.body;
    if (!name || !password) return res.status(400).json({ error: '이름과 비밀번호를 입력해주세요.' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE name = ? LIMIT 1', [name]);
    if (rows.length === 0) return res.status(401).json({ error: '이름 또는 비밀번호가 일치하지 않습니다.' });
    const user = rows[0];
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: '이름 또는 비밀번호가 일치하지 않습니다.' });
    const token = jwt.sign({ id: user.user_id, name: user.name, grade: user.grade, class_number: user.class_number }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.user_id, name: user.name, grade: user.grade, class_number: user.class_number, profile_image_url: user.profile_image_url, is_alarm_enabled: user.is_alarm_enabled } });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled FROM users WHERE user_id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Users
app.get('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT user_id, name, grade, class_number, profile_image_url, is_alarm_enabled FROM users WHERE user_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    if (parseInt(req.params.id) !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: '이름을 입력해주세요.' });
      const [exists] = await pool.execute('SELECT user_id FROM users WHERE name = ? AND user_id <> ? LIMIT 1', [name, req.params.id]);
      if (exists.length > 0) return res.status(409).json({ error: '이미 사용 중인 이름입니다.' });
      req.body.name = name;
    }
    const allowed = ['name', 'profile_image_url', 'is_alarm_enabled'];
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
    const { grade, class: cls } = req.query;
    let sql = 'SELECT a.*, u.name AS creator_name FROM assignments a JOIN users u ON a.created_by = u.user_id WHERE 1=1';
    const params = [];
    if (grade) { sql += ' AND a.target_grade = ?'; params.push(grade); }
    if (cls) { sql += ' AND (a.target_class = ? OR a.target_class IS NULL)'; params.push(cls); }
    sql += ' ORDER BY a.due_date ASC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/assignments', authMiddleware, async (req, res) => {
  try {
    const { title, content, due_date } = req.body;
    if (!title || !due_date) return res.status(400).json({ error: '과제명과 마감일은 필수입니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const target_grade = user.grade;
    const target_class = user.class_number;
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
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (content !== undefined) { updates.push('content = ?'); values.push(content); }
    if (due_date !== undefined) { updates.push('due_date = ?'); values.push(due_date); }
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
    if (rows[0].created_by !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
    await pool.execute('DELETE FROM assignments WHERE assignment_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// User Assignments (completion status)
app.get('/api/user-assignments/:userId', authMiddleware, async (req, res) => {
  try {
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
    const { assignment_id, is_completed } = req.body;
    await pool.execute('INSERT INTO user_assignments (user_id, assignment_id, is_completed) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE is_completed = ?', [req.user.id, assignment_id, is_completed ? 1 : 0, is_completed ? 1 : 0]);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/users/:userId/assignments', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    const { grade, class: cls } = req.query;
    let sql = 'SELECT a.*, u.name AS creator_name, COALESCE(ua.is_completed, 0) AS is_completed FROM assignments a JOIN users u ON a.created_by = u.user_id LEFT JOIN user_assignments ua ON a.assignment_id = ua.assignment_id AND ua.user_id = ? WHERE (a.target_grade = (SELECT grade FROM users WHERE user_id = ?) OR a.target_grade IS NULL)';
    const params = [userId, userId];
    if (grade) { sql += ' AND a.target_grade = ?'; params.push(grade); }
    if (cls) { sql += ' AND (a.target_class = ? OR a.target_class IS NULL)'; params.push(cls); }
    sql += ' ORDER BY a.due_date ASC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Messages
app.get('/api/messages', authMiddleware, async (req, res) => {
  try {
    const { grade, class: cls, type } = req.query;
    let sql = 'SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON m.sender_id = u.user_id WHERE 1=1';
    const params = [];
    if (grade) { sql += ' AND m.target_grade = ?'; params.push(grade); }
    if (cls) { sql += ' AND (m.target_class = ? OR (m.type = ? AND m.target_class IS NULL))'; params.push(cls, 'grade'); }
    if (type) { sql += ' AND m.type = ?'; params.push(type); }
    sql += ' ORDER BY m.created_at DESC';
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const { content, type } = req.body;
    if (!content || !type) return res.status(400).json({ error: '내용과 유형은 필수입니다.' });
    if (!['grade', 'class'].includes(type)) return res.status(400).json({ error: '메세지 유형이 올바르지 않습니다.' });
    const user = await getCurrentUser(req.user.id);
    if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const target_grade = user.grade;
    const target_class = type === 'class' ? user.class_number : null;
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
    if (rows[0].sender_id !== req.user.id) return res.status(403).json({ error: '권한이 없습니다.' });
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
