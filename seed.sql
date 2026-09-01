-- Default seed data for audit SDM
INSERT INTO users (name, email, password_hash, role, is_active) VALUES
('System Administrator', 'admin@audit.local', '$2a$10$0SDC1Q1P7Ih8aYQ1fo7xXe7MCKbC6n0N7fJfZjC0gP8z3vTPmQXXC', 'admin', TRUE),
('Auditor SDM', 'auditor@audit.local', '$2a$10$0SDC1Q1P7Ih8aYQ1fo7xXe7MCKbC6n0N7fJfZjC0gP8z3vTPmQXXC', 'auditor', TRUE),
('Manager HR', 'manager@audit.local', '$2a$10$0SDC1Q1P7Ih8aYQ1fo7xXe7MCKbC6n0N7fJfZjC0gP8z3vTPmQXXC', 'manager', TRUE),
('Viewer Audit', 'viewer@audit.local', '$2a$10$0SDC1Q1P7Ih8aYQ1fo7xXe7MCKbC6n0N7fJfZjC0gP8z3vTPmQXXC', 'viewer', TRUE);

INSERT INTO audits (title, department, auditor_id, status, score) VALUES
('Audit SDM Q3 2026', 'Human Resources', 1, 'in_progress', 78),
('Audit Rekrutmen & Seleksi', 'Recruitment', 2, 'draft', 76);

INSERT INTO findings (audit_id, area, description, risk_level, pic, status) VALUES
(1, 'Rekrutmen', 'Dokumentasi interview belum seragam', 'high', 'HR Manager', 'open'),
(1, 'Pelatihan', 'Evaluasi efektivitas training belum konsisten', 'medium', 'L&D', 'open');

INSERT INTO audit_logs (user_id, action, entity, details) VALUES
(1, 'login', 'auth', 'Admin login berhasil'),
(2, 'update', 'checklist', 'Checklist audit diperbarui'),
(1, 'backup', 'system', 'Backup otomatis dibuat');
