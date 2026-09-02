require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

let sqlite3;
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DB_PATH = path.join(__dirname, 'database.sqlite');
const DB_CLIENT = (process.env.DB_CLIENT || (process.env.DATABASE_URL ? 'postgres' : 'sqlite')).toLowerCase();
const PORTFOLIO_VIEW_ONLY = process.env.PORTFOLIO_VIEW_ONLY === 'true';
const PORTFOLIO_DEMO_MODE = process.env.PORTFOLIO_DEMO_MODE === 'true';
const ADMIN_EMAIL = 'admin@audit.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEFAULT_ROLE_USERS = [
  { name: 'Auditor SDM', email: 'auditor@audit.local', password: process.env.AUDITOR_PASSWORD || 'auditor123', role: 'auditor' },
  { name: 'Manager HR', email: 'manager@audit.local', password: process.env.MANAGER_PASSWORD || 'manager123', role: 'manager' },
  { name: 'Viewer Audit', email: 'viewer@audit.local', password: process.env.VIEWER_PASSWORD || 'viewer123', role: 'viewer' }
];
const VALID_ROLES = ['admin', 'auditor', 'manager', 'viewer'];
const BACKUP_DIR = path.join(__dirname, 'backups');

if (NODE_ENV === 'production') {
  const allowDemoDefaults = PORTFOLIO_DEMO_MODE === true;

  if (!allowDemoDefaults && JWT_SECRET === 'dev-secret-change-me') throw new Error('JWT_SECRET must be set in production.');
  if (!allowDemoDefaults && !process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production.');
  if (!allowDemoDefaults && DB_CLIENT !== 'postgres') throw new Error('DB_CLIENT must be postgres in production.');
  if (!allowDemoDefaults && ADMIN_PASSWORD === 'admin123') throw new Error('ADMIN_PASSWORD must be changed in production.');
}

app.use(cors());
app.use(express.json());
const BLOCKED_STATIC_PATHS = new Set(['/server.js', '/package.json', '/package-lock.json', '/vercel.json', '/database.sqlite', '/.env']);
app.use((req, res, next) => {
  if (BLOCKED_STATIC_PATHS.has(req.path) || req.path.startsWith('/backups/') || req.path.startsWith('/.git/')) return res.status(404).end();
  return next();
});
app.use(express.static(__dirname, { index: false, dotfiles: 'deny' }));

app.use((req, res, next) => {
  const destructiveMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const destructivePaths = [
    '/api/admin/',
    '/api/backup/create',
    '/api/backup/restore',
    '/api/users',
    '/api/reports',
    '/api/audits',
    '/api/findings'
  ];

  const isDestructiveMutation = destructiveMethods.has(req.method) && destructivePaths.some((path) => {
    if (path === '/api/users') return req.path.startsWith('/api/users');
    if (path === '/api/reports') return req.path.startsWith('/api/reports');
    if (path === '/api/audits') return req.path.startsWith('/api/audits');
    if (path === '/api/findings') return req.path.startsWith('/api/findings');
    return req.path.startsWith(path);
  });

  if (PORTFOLIO_VIEW_ONLY && isDestructiveMutation) {
    return res.status(403).json({ error: 'Portfolio view only: this action is disabled in read-only mode.' });
  }

  return next();
});

app.use(async (req, res, next) => {
  try {
    if (!dbReady) await initializeDatabase();
    return next();
  } catch (err) {
    console.error('Database init error:', err);
    return res.status(503).json({
      error: 'Database unavailable',
      message: NODE_ENV === 'production' ? 'Check DATABASE_URL and DB_CLIENT environment variables.' : err.message
    });
  }
});

let db;
let pgClient = null;
let dbReady = false;
let databaseInitPromise = null;

function getSqliteDriver() {
  if (!sqlite3) {
    sqlite3 = require('sqlite3').verbose();
  }
  return sqlite3;
}

function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function activeFlagValue(value) {
  const normalized = normalizeBooleanValue(value);
  return DB_CLIENT === 'postgres' ? normalized : normalized ? 1 : 0;
}

async function connectDatabase() {
  if (DB_CLIENT === 'postgres') {
    pgClient = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });

    pgClient.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });

    try {
      await pgClient.query('SELECT 1');
      db = pgClient;
      console.log('Connected to PostgreSQL database');
      return;
    } catch (err) {
      console.error('PostgreSQL connection error:', err.message);
      throw err;
    }
  }

  const SqliteDriver = getSqliteDriver();
  db = new SqliteDriver.Database(DB_PATH, (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite database');
  });
}


function toPostgresSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function run(sql, params = []) {
  if (DB_CLIENT === 'postgres') {
    let postgresSql = sql;
    if (/^\s*INSERT\s/i.test(postgresSql) && !/\bRETURNING\b/i.test(postgresSql)) {
      postgresSql = postgresSql.replace(/;\s*$/, '') + ' RETURNING id';
    }

    return pgClient.query(toPostgresSql(postgresSql), params).then((result) => ({
      id: result.rows[0] && result.rows[0].id ? result.rows[0].id : result.rowCount,
      changes: result.rowCount || 0,
      rows: result.rows
    }));
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }

      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function all(sql, params = []) {
  if (DB_CLIENT === 'postgres') {
    return pgClient.query(toPostgresSql(sql), params).then((result) => result.rows);
  }

  const SqliteDriver = getSqliteDriver();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  if (DB_CLIENT === 'postgres') {
    return pgClient.query(toPostgresSql(sql), params).then((result) => result.rows[0] || null);
  }

  const SqliteDriver = getSqliteDriver();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

const TABLE_SQL = {
  postgres: [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'auditor', 'manager', 'viewer')),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS audits (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      department VARCHAR(120),
      auditor_id INT REFERENCES users(id),
      status VARCHAR(30) DEFAULT 'draft',
      score INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS findings (
      id SERIAL PRIMARY KEY,
      audit_id INT REFERENCES audits(id),
      area VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('high', 'medium', 'low')),
      pic VARCHAR(120),
      status VARCHAR(30) DEFAULT 'open',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id),
      action VARCHAR(80) NOT NULL,
      entity VARCHAR(80) NOT NULL,
      details TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE TABLE IF NOT EXISTS backups (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(200) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      size_kb INT DEFAULT 0,
      status VARCHAR(30) DEFAULT 'completed'
    );`,
    `CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      audit_id INT REFERENCES audits(id),
      title VARCHAR(200) NOT NULL,
      department VARCHAR(120),
      auditor_name VARCHAR(120),
      period VARCHAR(50),
      executive_summary TEXT,
      recommendations TEXT,
      score INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`
  ],
  sqlite: [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','auditor','manager','viewer')),
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      department TEXT,
      auditor_id INTEGER,
      status TEXT DEFAULT 'draft',
      score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (auditor_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER,
      area TEXT NOT NULL,
      description TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      pic TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (audit_id) REFERENCES audits(id)
    )`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      size_kb INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed'
    )`,
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER,
      title TEXT NOT NULL,
      department TEXT,
      auditor_name TEXT,
      period TEXT,
      executive_summary TEXT,
      recommendations TEXT,
      score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (audit_id) REFERENCES audits(id)
    )`
  ]
};

async function ensureAdminUser() {
  const adminExists = await get('SELECT id, password_hash FROM users WHERE email = ?', [ADMIN_EMAIL]);
  if (!adminExists) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await run(
      'INSERT INTO users (name, email, password_hash, role, is_active, division) VALUES (?, ?, ?, ?, ?, ?)',
      ['System Administrator', ADMIN_EMAIL, hash, 'admin', activeFlagValue(true), 'Umum']
    );
    return;
  }

  const adminPasswordMatches = await bcrypt.compare(ADMIN_PASSWORD, adminExists.password_hash);
  if (!adminPasswordMatches) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await run('UPDATE users SET password_hash = ?, role = ?, is_active = 1, division = ? WHERE email = ?', [hash, 'admin', 'Umum', ADMIN_EMAIL]);
  }
}

async function ensureDemoRoleUsers() {
  for (const user of DEFAULT_ROLE_USERS) {
    const existingUser = await get('SELECT id, password_hash, role, is_active FROM users WHERE email = ?', [user.email]);
    const hash = await bcrypt.hash(user.password, 10);

    if (!existingUser) {
      await run(
        'INSERT INTO users (name, email, password_hash, role, is_active, division) VALUES (?, ?, ?, ?, ?, ?)',
        [user.name, user.email, hash, user.role, activeFlagValue(true), 'Umum']
      );
      continue;
    }

    const passwordMatches = await bcrypt.compare(user.password, existingUser.password_hash);
    if (!passwordMatches || existingUser.role !== user.role || !normalizeBooleanValue(existingUser.is_active)) {
      await run(
        'UPDATE users SET name = ?, password_hash = ?, role = ?, is_active = ?, division = ? WHERE email = ?',
        [user.name, hash, user.role, activeFlagValue(true), 'Umum', user.email]
      );
    }
  }
}

async function ensureUserSchemaColumns() {
  if (DB_CLIENT === 'sqlite') {
    const columns = await all('PRAGMA table_info(users)');
    if (!columns.some((column) => column.name === 'division')) {
      await run("ALTER TABLE users ADD COLUMN division TEXT DEFAULT 'Umum'");
    }
    return;
  }

  await run("ALTER TABLE users ADD COLUMN IF NOT EXISTS division VARCHAR(120) DEFAULT 'Umum'");
}

async function reindexUserIds() {
  if (DB_CLIENT !== 'sqlite') return;

  const remainingEmployees = await all(
    'SELECT * FROM users WHERE email != ? ORDER BY id ASC',
    [ADMIN_EMAIL]
  );

  if (!remainingEmployees.length) {
    await run('DELETE FROM sqlite_sequence WHERE name = ?', ['users']);
    return;
  }

  const hasGaps = remainingEmployees.some((user, index) => Number(user.id) !== index + 2);
  if (!hasGaps) {
    await run('DELETE FROM sqlite_sequence WHERE name = ?', ['users']);
    return;
  }

  const rowsToReinsert = remainingEmployees.map((user) => ({
    ...user,
    created_at: user.created_at || new Date().toISOString(),
    updated_at: user.updated_at || user.created_at || new Date().toISOString(),
    division: user.division || 'Umum',
    is_active: user.is_active === 1 || user.is_active === true ? 1 : 0
  }));

  await run('DELETE FROM users WHERE email != ?', [ADMIN_EMAIL]);

  for (let index = 0; index < rowsToReinsert.length; index += 1) {
    const user = rowsToReinsert[index];
    await run(
      'INSERT INTO users (id, name, email, password_hash, role, is_active, division, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [index + 2, user.name, user.email, user.password_hash, user.role, user.is_active, user.division, user.created_at, user.updated_at]
    );
  }

  await run('DELETE FROM sqlite_sequence WHERE name = ?', ['users']);
}

async function getNextEmployeeId() {
  if (DB_CLIENT !== 'sqlite') {
    return null;
  }

  const currentMax = await get('SELECT COALESCE(MAX(id), 1) AS max_id FROM users WHERE email != ?', [ADMIN_EMAIL]);
  return Number(currentMax?.max_id || 1) + 1;
}

async function resetSqliteSequence(tableName) {
  if (DB_CLIENT !== 'sqlite') return;
  await run('DELETE FROM sqlite_sequence WHERE name = ?', [tableName]);
}

async function initializeDatabase() {
  if (dbReady) return;
  if (databaseInitPromise) return databaseInitPromise;

  databaseInitPromise = (async () => {
    if (!db && !pgClient) {
      await connectDatabase();
    }

    const tableDefinitions = TABLE_SQL[DB_CLIENT] || TABLE_SQL.sqlite;
    for (const statement of tableDefinitions) await run(statement);

    await ensureUserSchemaColumns();
    await ensureAdminUser();
    await ensureDemoRoleUsers();
    await reindexUserIds();
    dbReady = true;
  })();

  try {
    await databaseInitPromise;
  } catch (err) {
    databaseInitPromise = null;
    throw err;
  }
}

async function logAudit(userId, action, entity, details = '') {
  await run(
    'INSERT INTO audit_logs (user_id, action, entity, details) VALUES (?, ?, ?, ?)',
    [userId, action, entity, details]
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: token missing' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }

    return next();
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), db: DB_CLIENT });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body;
  const portfolioRole = typeof role === 'string' ? role.trim().toLowerCase() : '';

  if (PORTFOLIO_DEMO_MODE && portfolioRole && ['admin', 'auditor', 'manager', 'viewer'].includes(portfolioRole)) {
    const demoUser = {
      id: 0,
      name: `${portfolioRole.charAt(0).toUpperCase()}${portfolioRole.slice(1)} Demo`,
      email: `${portfolioRole}@portfolio.local`,
      role: portfolioRole
    };

    const token = jwt.sign({ id: demoUser.id, email: demoUser.email, role: demoUser.role }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({
      token,
      user: { id: demoUser.id, name: demoUser.name, email: demoUser.email, role: demoUser.role }
    });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
  }

  if (!normalizeBooleanValue(user.is_active)) {
    return res.status(403).json({ error: 'User is inactive' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  await logAudit(user.id, 'login', 'auth', 'User logged in');

  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

app.get('/api/audits', authMiddleware, requireRole('admin', 'auditor', 'manager'), async (req, res) => {
  const { search = '', department = '', status = '' } = req.query;
  let query = 'SELECT a.*, u.name as auditor_name FROM audits a LEFT JOIN users u ON u.id = a.auditor_id WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (a.title LIKE ? OR a.department LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (department) {
    query += ' AND a.department = ?';
    params.push(department);
  }

  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY a.created_at DESC';
  const audits = await all(query, params);
  return res.json(audits);
});

app.post('/api/audits', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  const { title, department, auditor_id, status, score } = req.body;
  const result = await run(
    'INSERT INTO audits (title, department, auditor_id, status, score) VALUES (?, ?, ?, ?, ?)',
    [title, department || 'General', auditor_id || req.user.id, status || 'draft', score || 0]
  );

  await logAudit(req.user.id, 'create', 'audit', JSON.stringify({ id: result.id, title }));
  return res.status(201).json({ id: result.id, message: 'Audit created' });
});

app.get('/api/audits/:id', authMiddleware, requireRole('admin', 'auditor', 'manager'), async (req, res) => {
  const audit = await get('SELECT * FROM audits WHERE id = ?', [req.params.id]);
  if (!audit) {
    return res.status(404).json({ error: 'Audit not found' });
  }

  return res.json(audit);
});

app.put('/api/audits/:id', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  const { title, department, status, score } = req.body;
  await run(
    'UPDATE audits SET title = ?, department = ?, status = ?, score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [title, department, status, score, req.params.id]
  );
  await logAudit(req.user.id, 'update', 'audit', `Updated audit ${req.params.id}`);
  return res.json({ message: 'Audit updated' });
});

app.delete('/api/audits/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  await run('DELETE FROM findings WHERE audit_id = ?', [req.params.id]);
  await run('DELETE FROM audits WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'delete', 'audit', `Deleted audit ${req.params.id} and linked findings`);
  return res.json({ message: 'Audit deleted' });
});

app.get('/api/findings', authMiddleware, requireRole('admin', 'auditor', 'manager'), async (req, res) => {
  const { search = '', risk = '', status = '', audit_id = '' } = req.query;
  let query = 'SELECT * FROM findings WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (area LIKE ? OR description LIKE ? OR pic LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (risk) {
    query += ' AND risk_level = ?';
    params.push(risk);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (audit_id) {
    query += ' AND audit_id = ?';
    params.push(audit_id);
  }

  query += ' ORDER BY created_at DESC';
  const findings = await all(query, params);
  return res.json(findings);
});

app.post('/api/findings', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  const { audit_id, area, description, risk_level, pic, status } = req.body;
  const result = await run(
    'INSERT INTO findings (audit_id, area, description, risk_level, pic, status) VALUES (?, ?, ?, ?, ?, ?)',
    [audit_id || null, area, description, risk_level || 'medium', pic || '', status || 'open']
  );

  await logAudit(req.user.id, 'create', 'finding', JSON.stringify({ id: result.id, area }));
  return res.status(201).json({ id: result.id, message: 'Finding created' });
});

app.put('/api/findings/:id', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  const { area, description, risk_level, pic, status } = req.body;
  await run(
    'UPDATE findings SET area = ?, description = ?, risk_level = ?, pic = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [area, description, risk_level, pic || '', status || 'open', req.params.id]
  );
  await logAudit(req.user.id, 'update', 'finding', `Updated finding ${req.params.id}`);
  return res.json({ message: 'Finding updated' });
});

app.delete('/api/findings/:id', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  await run('DELETE FROM findings WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'delete', 'finding', `Deleted finding ${req.params.id}`);
  return res.json({ message: 'Finding deleted' });
});

app.get('/api/audit-logs', authMiddleware, requireRole('admin'), async (req, res) => {
  const logs = await all('SELECT l.*, u.name as user_name FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 100');
  return res.json(logs);
});

app.get('/api/reports', authMiddleware, requireRole('admin', 'auditor', 'manager', 'viewer'), async (req, res) => {
  const audits = await all('SELECT a.*, u.name as auditor_name FROM audits a LEFT JOIN users u ON u.id = a.auditor_id ORDER BY a.created_at DESC');
  const findings = await all('SELECT * FROM findings');
  const reports = audits.map((audit) => {
    const auditFindings = findings.filter((f) => String(f.audit_id) === String(audit.id));
    return {
      ...audit,
      total_findings: auditFindings.length,
      high_findings: auditFindings.filter((f) => f.risk_level === 'high').length,
      medium_findings: auditFindings.filter((f) => f.risk_level === 'medium').length,
      low_findings: auditFindings.filter((f) => f.risk_level === 'low').length,
      closed_findings: auditFindings.filter((f) => f.status === 'closed').length,
      open_findings: auditFindings.filter((f) => f.status === 'open').length,
      on_progress_findings: auditFindings.filter((f) => f.status === 'on_progress').length
    };
  });
  return res.json(reports);
});

app.get('/api/reports/saved', authMiddleware, requireRole('admin', 'auditor', 'manager', 'viewer'), async (req, res) => {
  const reports = await all('SELECT r.*, a.title as audit_title FROM reports r LEFT JOIN audits a ON a.id = r.audit_id ORDER BY r.created_at DESC');
  return res.json(reports);
});

app.post('/api/reports', authMiddleware, requireRole('admin'), async (req, res) => {
  const { audit_id, title, department, auditor_name, period, executive_summary, recommendations, score } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Judul laporan wajib diisi' });
  }

  const result = await run(
    'INSERT INTO reports (audit_id, title, department, auditor_name, period, executive_summary, recommendations, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [audit_id || null, title, department || 'General', auditor_name || req.user.email, period || new Date().toISOString().slice(0, 10), executive_summary || '', recommendations || '', score || 0]
  );

  await logAudit(req.user.id, 'create', 'report', JSON.stringify({ id: result.id, title }));
  return res.status(201).json({ id: result.id, message: 'Laporan audit berhasil disimpan ke database' });
});

app.delete('/api/reports/:id', authMiddleware, requireRole('admin', 'auditor'), async (req, res) => {
  await run('DELETE FROM reports WHERE id = ?', [req.params.id]);
  await logAudit(req.user.id, 'delete', 'report', `Deleted report ${req.params.id}`);
  return res.json({ message: 'Laporan audit berhasil dihapus' });
});

app.get('/api/reports/:id', authMiddleware, requireRole('admin', 'auditor', 'manager', 'viewer'), async (req, res) => {
  const audit = await get('SELECT a.*, u.name as auditor_name FROM audits a LEFT JOIN users u ON u.id = a.auditor_id WHERE a.id = ?', [req.params.id]);
  if (!audit) {
    return res.status(404).json({ error: 'Audit not found' });
  }
  const findings = await all('SELECT * FROM findings WHERE audit_id = ? ORDER BY created_at DESC', [req.params.id]);
  return res.json({ audit, findings });
});

app.get('/api/backup-status', authMiddleware, requireRole('admin'), async (req, res) => {
  const backups = await all('SELECT * FROM backups ORDER BY created_at DESC LIMIT 10');
  return res.json({ backups, message: 'Backup retention configured for 30-90 days' });
});

app.post('/api/backup/create', authMiddleware, requireRole('admin'), async (req, res) => {
  if (DB_CLIENT !== 'sqlite') {
    return res.status(400).json({ error: 'Backup creation is available only for SQLite databases.' });
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `backup-${Date.now()}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, filename);
  fs.copyFileSync(DB_PATH, backupPath);

  const sizeKb = Math.max(1, Math.ceil(fs.statSync(backupPath).size / 1024));
  const result = await run('INSERT INTO backups (filename, size_kb, status) VALUES (?, ?, ?)', [filename, sizeKb, 'completed']);
  await logAudit(req.user.id, 'backup', 'system', `Created ${filename}`);

  return res.status(201).json({ id: result.id, message: 'Backup created successfully', filename, size_kb: sizeKb });
});

app.post('/api/backup/restore', authMiddleware, requireRole('admin'), async (req, res) => {
  if (DB_CLIENT !== 'sqlite') {
    return res.status(400).json({ error: 'Database restore is supported only for SQLite.' });
  }

  const { backupId, confirm } = req.body || {};
  if (!confirm) {
    return res.status(400).json({ error: 'Restore confirmation is required.' });
  }

  const backup = await get('SELECT id, filename FROM backups WHERE id = ?', [backupId]);
  if (!backup) {
    return res.status(404).json({ error: 'Backup not found.' });
  }

  const backupPath = path.join(BACKUP_DIR, backup.filename);
  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Backup file not found on disk.' });
  }

  if (db) {
    await new Promise((resolve, reject) => {
      db.close((err) => (err ? reject(err) : resolve()));
    });
  }

  fs.copyFileSync(backupPath, DB_PATH);
  connectDatabase();
  await initializeDatabase();
  await logAudit(req.user.id, 'restore', 'system', `Restored backup ${backup.filename}`);

  return res.json({ message: `Backup ${backup.filename} restored successfully.` });
});

app.post('/api/admin/reset-database', authMiddleware, requireRole('admin'), async (req, res) => {
  await run('DELETE FROM findings');
  await run('DELETE FROM reports');
  await run('DELETE FROM audits');
  await run('DELETE FROM audit_logs');
  await run('DELETE FROM backups');
  await run('DELETE FROM users WHERE email != ?', [ADMIN_EMAIL]);
  await ensureAdminUser();
  await resetSqliteSequence('users');
  await logAudit(req.user.id, 'reset', 'database', 'Database reset to clean state (admin retained)');
  return res.json({ message: 'Database reset successfully. Only admin user retained.' });
});

app.post('/api/admin/reset-employee-ids', authMiddleware, requireRole('admin'), async (req, res) => {
  if (DB_CLIENT !== 'sqlite') {
    return res.status(400).json({ error: 'This action is only supported for SQLite databases.' });
  }

  await run('DELETE FROM users WHERE email != ?', [ADMIN_EMAIL]);
  await run('DELETE FROM sqlite_sequence WHERE name = ?', ['users']);
  await ensureAdminUser();
  await logAudit(req.user.id, 'reset_ids', 'user', 'Reset employee IDs to start from the beginning while keeping admin safe.');
  return res.json({ message: 'Employee IDs reset successfully. Admin remains protected and employee IDs restart from the start.' });
});

app.get('/api/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { search = '', role = '' } = req.query;
  let query = "SELECT id, name, email, role, COALESCE(division, 'Umum') AS division, is_active, created_at FROM users WHERE 1=1";
  const params = [];

  if (search) {
    query += " AND (name LIKE ? OR email LIKE ? OR COALESCE(division, 'Umum') LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (role) {
    query += ' AND role = ?';
    params.push(role);
  }

  query += ' ORDER BY id ASC';
  const users = await all(query, params);
  return res.json(users);
});

app.get('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const user = await get(
    "SELECT id, name, email, role, COALESCE(division, 'Umum') AS division, is_active, created_at, updated_at FROM users WHERE id = ?",
    [req.params.id]
  );

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.json({
    ...user,
    is_active: normalizeBooleanValue(user.is_active)
  });
});

app.post('/api/users', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, email, role, password, division } = req.body;
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: 'name, email, role and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedDivision = String(division || 'Umum').trim() || 'Umum';
  const existingUser = await get('SELECT id FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
  if (existingUser) {
    return res.status(400).json({ error: 'Email sudah terdaftar. Gunakan email lain.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const nextId = DB_CLIENT === 'sqlite' ? await getNextEmployeeId() : null;
  const result = await run(
    DB_CLIENT === 'sqlite'
      ? 'INSERT INTO users (id, name, email, password_hash, role, division) VALUES (?, ?, ?, ?, ?, ?)'
      : 'INSERT INTO users (name, email, password_hash, role, division) VALUES (?, ?, ?, ?, ?)',
    DB_CLIENT === 'sqlite'
      ? [nextId, name.trim(), normalizedEmail, hash, role, normalizedDivision]
      : [name.trim(), normalizedEmail, hash, role, normalizedDivision]
  );

  if (DB_CLIENT === 'sqlite') {
    await reindexUserIds();
  }

  await logAudit(req.user.id, 'create', 'user', `Created user ${normalizedEmail}`);
  return res.status(201).json({ id: result.id || nextId, message: 'User created' });
});

app.put('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { name, email, role, division, is_active } = req.body;
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedDivision = String(division || 'Umum').trim() || 'Umum';
  const targetUser = await get('SELECT id, email FROM users WHERE id = ?', [req.params.id]);

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (targetUser.email !== normalizedEmail) {
    const existingUser = await get('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?', [normalizedEmail, req.params.id]);
    if (existingUser) {
      return res.status(400).json({ error: 'Email sudah terdaftar. Gunakan email lain.' });
    }
  }

  await run(
    'UPDATE users SET name = ?, email = ?, role = ?, division = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name.trim(), normalizedEmail, role, normalizedDivision, activeFlagValue(is_active), req.params.id]
  );
  await logAudit(req.user.id, 'update', 'user', `Updated user ${req.params.id}`);
  return res.json({ message: 'User updated' });
});

app.post('/api/users/:id/reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
  const { password } = req.body;
  const targetUser = await get('SELECT id, email, role FROM users WHERE id = ?', [req.params.id]);

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (targetUser.email === ADMIN_EMAIL || targetUser.role === 'admin') {
    return res.status(400).json({ error: 'Admin password cannot be reset from this endpoint.' });
  }

  if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 chars and include uppercase, lowercase, number, and symbol.' });
  }

  const hash = await bcrypt.hash(password, 10);
  await run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hash, req.params.id]);
  await logAudit(req.user.id, 'reset_password', 'user', `Reset password for user ${req.params.id}`);
  return res.json({ message: 'Password updated successfully.' });
});

app.delete('/api/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const targetUser = await get('SELECT id, email, role FROM users WHERE id = ?', [req.params.id]);

  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (targetUser.email === ADMIN_EMAIL || targetUser.role === 'admin') {
    return res.status(400).json({ error: 'Admin user cannot be deleted.' });
  }

  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  await reindexUserIds();
  await logAudit(req.user.id, 'delete', 'user', `Deleted user ${req.params.id}`);
  return res.json({ message: 'User deleted' });
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }

  return res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  await initializeDatabase();

  return new Promise((resolve, reject) => {
    const ports = Array.from(new Set([
      Number(process.env.PORT) || 3000,
      3000,
      3001,
      3002,
      3003,
      3004,
      3005,
      3006,
      3007,
      3008,
      3009
    ])).filter((port) => Number.isInteger(port) && port > 0);

    const tryListen = (index) => {
      const port = ports[index];
      const server = app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
        resolve(server);
      });

      server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && index < ports.length - 1) {
          tryListen(index + 1);
          return;
        }

        reject(err);
      });
    };

    tryListen(0);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;
module.exports.db = db;
module.exports.DB_CLIENT = DB_CLIENT;
module.exports.initializeDatabase = initializeDatabase;
