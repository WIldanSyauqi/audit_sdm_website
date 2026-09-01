-- Audit SDM production schema
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('admin', 'auditor', 'manager', 'viewer')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audits (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  department VARCHAR(120),
  auditor_id INT REFERENCES users(id),
  status VARCHAR(30) DEFAULT 'draft',
  score INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE findings (
  id SERIAL PRIMARY KEY,
  audit_id INT REFERENCES audits(id),
  area VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('high', 'medium', 'low')),
  pic VARCHAR(120),
  status VARCHAR(30) DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE backups (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  size_kb INT DEFAULT 0,
  status VARCHAR(30) DEFAULT 'completed'
);

CREATE TABLE permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(30) NOT NULL,
  module_name VARCHAR(80) NOT NULL,
  can_read BOOLEAN DEFAULT FALSE,
  can_write BOOLEAN DEFAULT FALSE,
  can_approve BOOLEAN DEFAULT FALSE,
  can_export BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO permissions (role, module_name, can_read, can_write, can_approve, can_export) VALUES
('admin', 'audit_checklist', TRUE, TRUE, TRUE, TRUE),
('admin', 'finding', TRUE, TRUE, TRUE, TRUE),
('admin', 'report', TRUE, TRUE, TRUE, TRUE),
('admin', 'settings', TRUE, TRUE, TRUE, TRUE),
('auditor', 'audit_checklist', TRUE, TRUE, FALSE, TRUE),
('auditor', 'finding', TRUE, TRUE, FALSE, TRUE),
('auditor', 'report', TRUE, FALSE, FALSE, TRUE),
('auditor', 'settings', TRUE, FALSE, FALSE, FALSE),
('manager', 'audit_checklist', TRUE, FALSE, FALSE, FALSE),
('manager', 'finding', TRUE, FALSE, TRUE, TRUE),
('manager', 'report', TRUE, FALSE, FALSE, TRUE),
('manager', 'settings', FALSE, FALSE, FALSE, FALSE),
('viewer', 'audit_checklist', TRUE, FALSE, FALSE, FALSE),
('viewer', 'finding', TRUE, FALSE, FALSE, FALSE),
('viewer', 'report', TRUE, FALSE, FALSE, TRUE),
('viewer', 'settings', FALSE, FALSE, FALSE, FALSE);
