require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const ADMIN_EMAIL = 'admin@audit.local';
const ADMIN_PASSWORD = 'admin123';

const db = new sqlite3.Database(DB_PATH, async (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
    process.exit(1);
  }

  console.log('Clearing database tables while retaining admin user...');

  db.serialize(async () => {
    db.run('DELETE FROM findings');
    db.run('DELETE FROM reports');
    db.run('DELETE FROM audits');
    db.run('DELETE FROM audit_logs');
    db.run('DELETE FROM backups');
    db.run('DELETE FROM users WHERE email != ?', [ADMIN_EMAIL], async function(err) {
      if (err) {
        console.error('Error deleting non-admin users:', err.message);
      }
    });

    db.get('SELECT id FROM users WHERE email = ?', [ADMIN_EMAIL], async (err, row) => {
      if (!row) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
        db.run(
          'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)',
          ['System Administrator', ADMIN_EMAIL, hash, 'admin'],
          (err) => {
            if (err) console.error('Error creating admin user:', err.message);
            else console.log('Admin user recreated successfully.');
            db.close();
          }
        );
      } else {
        console.log('Admin user retained.');
        db.close();
      }
    });
  });
});
