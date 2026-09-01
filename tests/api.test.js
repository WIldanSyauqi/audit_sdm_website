const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../server.js');

test('GET /api/health returns OK', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('POST /api/auth/login authenticates admin user', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.role, 'admin');
});

test('POST /api/auth/login authenticates seeded role users', async () => {
  const credentials = [
    ['auditor@audit.local', 'auditor123', 'auditor'],
    ['manager@audit.local', 'manager123', 'manager'],
    ['viewer@audit.local', 'viewer123', 'viewer']
  ];

  for (const [email, password, role] of credentials) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    assert.equal(res.status, 200, `${email} should login successfully`);
    assert.equal(res.body.user.role, role, `${email} role should match`);
    assert.ok(res.body.token, `${email} should return token`);
  }
});

test('GET /api/audits requires authentication', async () => {
  const res = await request(app).get('/api/audits');
  assert.equal(res.status, 401);
});

test('GET /api/reports returns audit summary list when authenticated', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const res = await request(app)
    .get('/api/reports')
    .set('Authorization', `Bearer ${loginRes.body.token}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('POST /api/reports creates a report and GET /api/reports/saved retrieves it', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const createRes = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Laporan Test Audit SDM',
      department: 'Human Resources',
      auditor_name: 'System Administrator',
      score: 85
    });

  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.id);

  const getRes = await request(app)
    .get('/api/reports/saved')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(getRes.status, 200);
  assert.ok(Array.isArray(getRes.body));
  assert.ok(getRes.body.some((r) => r.title === 'Laporan Test Audit SDM'));
});

test('DELETE /api/users/:id preserves the admin account and deletes other users', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const createRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Tester Karyawan',
      email: 'tester.karyawan@audit.local',
      role: 'viewer',
      password: 'tester123'
    });

  assert.equal(createRes.status, 201);

  const listRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const adminUser = listRes.body.find((user) => user.email === 'admin@audit.local');
  const createdUser = listRes.body.find((user) => user.email === 'tester.karyawan@audit.local');

  assert.ok(adminUser);
  assert.ok(createdUser);

  const deleteAdminRes = await request(app)
    .delete(`/api/users/${adminUser.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(deleteAdminRes.status, 400);
  assert.equal(deleteAdminRes.body.error, 'Admin user cannot be deleted.');

  const deleteCreatedRes = await request(app)
    .delete(`/api/users/${createdUser.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(deleteCreatedRes.status, 200);

  const remainingUsers = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  assert.ok(remainingUsers.body.some((user) => user.email === 'admin@audit.local'));
  assert.equal(remainingUsers.body.some((user) => user.email === 'tester.karyawan@audit.local'), false);
});

test('GET /api/users returns rows in database ID order', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const res = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  const sortedById = [...res.body].sort((a, b) => Number(a.id) - Number(b.id));
  assert.deepEqual(res.body.map((user) => user.id), sortedById.map((user) => user.id));
});

test('DELETE /api/users/:id reindexes remaining employees to contiguous IDs', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Delete Reindex A',
      email: 'delete.reindex.a@audit.local',
      role: 'viewer',
      password: 'DeleteReindexA!1'
    });

  await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Delete Reindex B',
      email: 'delete.reindex.b@audit.local',
      role: 'auditor',
      password: 'DeleteReindexB!1'
    });

  const beforeDelete = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const userToDelete = beforeDelete.body.find((user) => user.email === 'delete.reindex.a@audit.local');
  assert.ok(userToDelete, 'target employee should exist before delete');

  const deleteRes = await request(app)
    .delete(`/api/users/${userToDelete.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(deleteRes.status, 200);

  const remaining = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const ids = remaining.body.map((user) => Number(user.id));
  const expectedIds = Array.from({ length: ids.length }, (_, index) => index + 1);

  assert.deepEqual(ids, expectedIds, 'remaining user IDs should be contiguous after deletion');
});

test('DELETE and re-create users keep database-ordered IDs and valid creation flow', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const tempUser = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Sequence Tester',
      email: 'sequence.tester@audit.local',
      role: 'viewer',
      password: 'SequencePass!123'
    });

  assert.equal(tempUser.status, 201);

  const beforeDelete = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const userToDelete = beforeDelete.body.find((user) => user.email === 'sequence.tester@audit.local');
  assert.ok(userToDelete);

  const deleteRes = await request(app)
    .delete(`/api/users/${userToDelete.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(deleteRes.status, 200);

  const recreatedUser = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Sequence Recreated',
      email: 'sequence.recreated@audit.local',
      role: 'auditor',
      password: 'SequencePass!456'
    });

  assert.equal(recreatedUser.status, 201);
  assert.ok(recreatedUser.body.id);

  const listRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const ids = listRes.body.map((user) => Number(user.id));
  const sortedIds = [...ids].sort((a, b) => a - b);
  assert.deepEqual(ids, sortedIds);
  assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
  assert.ok(recreatedUser.body.id > userToDelete.id || recreatedUser.body.id > Math.max(...ids.slice(0, -1)));
});

test('POST /api/users/:id/reset-password resets employee password and keeps admin protected', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const createRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Reset Password Tester',
      email: 'reset.password.tester@audit.local',
      role: 'viewer',
      password: 'ResetPass!123'
    });

  assert.equal(createRes.status, 201);

  const usersRes = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const user = usersRes.body.find((row) => row.email === 'reset.password.tester@audit.local');
  assert.ok(user);

  const resetRes = await request(app)
    .post(`/api/users/${user.id}/reset-password`)
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'NewStrongPass!456' });

  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.body.message, 'Password updated successfully.');

  const adminResetRes = await request(app)
    .post(`/api/users/${loginRes.body.user.id}/reset-password`)
    .set('Authorization', `Bearer ${token}`)
    .send({ password: 'AnotherPass!789' });

  assert.equal(adminResetRes.status, 400);
  assert.equal(adminResetRes.body.error, 'Admin password cannot be reset from this endpoint.');
});

test('POST /api/admin/reset-database resets database and retains admin user', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const resetRes = await request(app)
    .post('/api/admin/reset-database')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.body.message, 'Database reset successfully. Only admin user retained.');

  const auditsRes = await request(app)
    .get('/api/audits')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(auditsRes.status, 200);
  assert.equal(auditsRes.body.length, 0);
});

test('GET /api/users/:id returns employee detail and backup restore endpoint is safe and admin-only', async () => {
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  const token = loginRes.body.token;

  const createRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Detail User Tester',
      email: 'detail.user.tester@audit.local',
      role: 'auditor',
      password: 'DetailUser!123'
    });

  assert.equal(createRes.status, 201);

  const userList = await request(app)
    .get('/api/users')
    .set('Authorization', `Bearer ${token}`);

  const createdUser = userList.body.find((user) => user.email === 'detail.user.tester@audit.local');
  assert.ok(createdUser);

  const detailRes = await request(app)
    .get(`/api/users/${createdUser.id}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.name, 'Detail User Tester');
  assert.equal(detailRes.body.role, 'auditor');

  const backupRes = await request(app)
    .post('/api/backup/create')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(backupRes.status, 201);
  assert.ok(backupRes.body.filename);

  const latestBackup = await request(app)
    .get('/api/backup-status')
    .set('Authorization', `Bearer ${token}`);

  const backupId = latestBackup.body.backups[0]?.id;
  assert.ok(backupId);

  const restoreRes = await request(app)
    .post('/api/backup/restore')
    .set('Authorization', `Bearer ${token}`)
    .send({ backupId, confirm: true });

  assert.equal(restoreRes.status, 200);
  assert.match(restoreRes.body.message, /restored/i);

  const restoreWithoutConfirm = await request(app)
    .post('/api/backup/restore')
    .set('Authorization', `Bearer ${token}`)
    .send({ backupId, confirm: false });

  assert.equal(restoreWithoutConfirm.status, 400);
  assert.match(restoreWithoutConfirm.body.error, /confirm/i);
});

test('PUBLIC_DEMO blocks destructive admin endpoints', async () => {
  process.env.PUBLIC_DEMO = 'true';
  delete require.cache[require.resolve('../server.js')];
  const { app: demoApp } = require('../server.js');

  const loginRes = await request(demoApp)
    .post('/api/auth/login')
    .send({ email: 'admin@audit.local', password: 'admin123' });

  assert.equal(loginRes.status, 200);

  const resetRes = await request(demoApp)
    .post('/api/admin/reset-database')
    .set('Authorization', `Bearer ${loginRes.body.token}`);

  assert.equal(resetRes.status, 403);
  assert.match(resetRes.body.error, /demo mode/i);

  const deleteRes = await request(demoApp)
    .delete('/api/users/2')
    .set('Authorization', `Bearer ${loginRes.body.token}`);

  assert.equal(deleteRes.status, 403);
  assert.match(deleteRes.body.error, /demo mode/i);

  delete process.env.PUBLIC_DEMO;
  delete require.cache[require.resolve('../server.js')];
  const { app: resetApp } = require('../server.js');
  await request(resetApp).get('/api/health');
});

test('DB_CLIENT prefers PostgreSQL when DATABASE_URL is available', async () => {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/audit_sdm';
  delete require.cache[require.resolve('../server.js')];
  const serverModule = require('../server.js');

  assert.equal(serverModule.DB_CLIENT, 'postgres');

  delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('../server.js')];
  require('../server.js');
});

