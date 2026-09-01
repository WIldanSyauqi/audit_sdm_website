const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputDir = path.join(__dirname, '..', 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(outputDir, `audit-sdm-backup-${timestamp}.sql`);

fs.mkdirSync(outputDir, { recursive: true });

const dbUrl = process.env.DATABASE_URL || '';

try {
  if (!dbUrl) {
    const sqliteFile = path.join(__dirname, '..', 'database.sqlite');
    fs.copyFileSync(sqliteFile, backupFile);
    console.log(`SQLite backup created: ${backupFile}`);
    process.exit(0);
  }

  const pgDump = `pg_dump "${dbUrl}" > "${backupFile}"`;
  execSync(pgDump, { stdio: 'inherit', shell: true });
  console.log(`PostgreSQL backup created: ${backupFile}`);
} catch (error) {
  console.error('Backup failed:', error.message);
  process.exit(1);
}
