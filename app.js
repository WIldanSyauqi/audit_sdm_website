const API_BASE_CANDIDATES = Array.from(new Set([
  window.location.origin,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3002'
].filter(Boolean)));
const API_BASE = API_BASE_CANDIDATES[0] || 'http://localhost:3000';

const auditItems = [
  ['Perencanaan SDM', 'Workforce planning tersedia', 'Kebutuhan tenaga kerja dan kompetensi diperhitungkan secara formal dan terdokumentasi.', 4],
  ['Perencanaan SDM', 'Struktur organisasi diperbarui', 'Job description, span of control, dan reporting line konsisten dengan organisasi saat ini.', 4],
  ['Rekrutmen', 'SOP rekrutmen terdokumentasi', 'Proses rekrutmen mencakup kebutuhan, screening, interview, dan approval yang jelas.', 4],
  ['Rekrutmen', 'Pemilihan kandidat berbasis kompetensi', 'Kriteria seleksi, assessment, dan keputusan hiring terdokumentasi dan siap ditelusuri.', 3],
  ['Onboarding', 'Onboarding dan orientasi dijalankan', 'Karyawan baru menerima pengenalan tugas, budaya kerja, dan kebijakan organisasi.', 3],
  ['Pelatihan', 'Training need analysis dilakukan', 'Pelatihan didasarkan pada gap kompetensi, kebutuhan bisnis, dan potensi pengembangan.', 3],
  ['Pelatihan', 'Evaluasi pelatihan terdokumentasi', 'Ada indikator hasil belajar dan review dampak pelatihan terhadap kinerja.', 3],
  ['Kinerja', 'KPI dan target karyawan jelas', 'Target pekerjaan terukur, realistis, dan terikat pada posisi masing-masing.', 4],
  ['Kinerja', 'Performance review berjalan tepat waktu', 'Review kinerja dilakukan rutin dan didokumentasikan dengan tindak lanjut yang jelas.', 4],
  ['Kompensasi', 'Struktur kompensasi terdokumentasi', 'Gaji, tunjangan, insentif, dan kebijakan reward memiliki dasar yang jelas serta konsisten.', 4],
  ['Kompensasi', 'Payroll dan benefit dikontrol', 'Ada verifikasi, approval, dan rekonsiliasi gaji sebelum pembayaran dilakukan.', 4],
  ['Compliance', 'Dokumen SDM dan data karyawan terjaga', 'Data karyawan, dokumen kerja, kontrak, dan arsip HR terlindungi dan mudah diakses sesuai kebutuhan.', 4]
];

let employeeSeed = [];
let employeePage = 1;
let employeeDetailState = null;
let resetPasswordTargetId = null;
const EMPLOYEE_PAGE_SIZE = 5;
const PAGE_PERMISSIONS = {
  admin: ['dashboard', 'checklist', 'findings', 'reports', 'employees', 'settings'],
  auditor: ['dashboard', 'checklist', 'findings', 'reports', 'settings'],
  manager: ['dashboard', 'checklist', 'findings', 'reports'],
  viewer: ['dashboard', 'reports']
};

let findingCache = [];
let auditCache = [];
let savedReportsCache = [];
let selectedAuditId = null;
let selectedFindingStatus = '';
let selectedReportAuditId = null;
let reportCustomization = {};

function currentUser() {
  const raw = localStorage.getItem('hrAuditSession');
  return raw ? JSON.parse(raw) : null;
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timeoutId);
  toast.timeoutId = setTimeout(() => el.classList.remove('show'), 2200);
}

function applyTheme(mode) {
  const root = document.documentElement;
  root.dataset.theme = mode === 'dark' ? 'dark' : 'light';
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = mode === 'dark' ? '☀' : '☾';
    btn.setAttribute('aria-label', mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  localStorage.setItem('audit-theme', mode);
}

function initTheme() {
  const savedTheme = localStorage.getItem('audit-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));
}

function renderAuthState() {
  const user = currentUser();
  const role = (user && user.role) || 'viewer';
  const allowedPages = PAGE_PERMISSIONS[role] || PAGE_PERMISSIONS.viewer;

  const userNameEl = document.getElementById('userName');
  const userEmailEl = document.getElementById('userEmail');
  const userMiniLabelEl = document.getElementById('userMiniLabel');
  const overlay = document.getElementById('loginOverlay');
  const navButtons = document.querySelectorAll('.nav-btn');

  if (!user) {
    if (overlay) overlay.style.display = 'flex';
    if (userNameEl) userNameEl.textContent = 'Administrator';
    if (userEmailEl) userEmailEl.textContent = 'admin@audit.local';
    if (userMiniLabelEl) userMiniLabelEl.textContent = 'ADMIN';
    return;
  }

  if (overlay) overlay.style.display = 'none';
  if (userNameEl) userNameEl.textContent = user.name;
  if (userEmailEl) userEmailEl.textContent = user.email;
  if (userMiniLabelEl) userMiniLabelEl.textContent = user.role.toUpperCase();

  navButtons.forEach((button) => {
    const page = button.dataset.page;
    const isAllowed = allowedPages.includes(page);
    button.classList.toggle('hidden', !isAllowed);
  });
}

function goToPage(pageName) {
  const user = currentUser();
  const role = (user && user.role) || 'viewer';
  const allowedPages = PAGE_PERMISSIONS[role] || PAGE_PERMISSIONS.viewer;

  if (!allowedPages.includes(pageName)) {
    toast('Anda tidak memiliki akses ke halaman ini.');
    pageName = 'dashboard';
  }

  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === pageName));
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
  const pageTitle = {
    dashboard: 'Dashboard Audit SDM',
    checklist: 'Checklist Audit SDM',
    findings: 'Temuan Audit',
    reports: 'Laporan Audit',
    employees: 'Data Karyawan',
    settings: 'Pengaturan'
  };

  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = pageTitle[pageName] || 'Audit SDM';

  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
  window.scrollTo(0, 0);
}

function renderDashboardMetrics(audits = [], findings = []) {
  const auditList = audits || [];
  const findingList = findings || [];

  const totalAudits = auditList.length;
  const totalFindings = findingList.length;
  const highFindingCount = findingList.filter((item) => (item.risk_level || '').toLowerCase() === 'high').length;
  const completedCount = auditList.filter((item) => (item.status || '') === 'completed').length;

  const averageScore = totalAudits > 0
    ? Math.round(auditList.reduce((sum, item) => sum + Number(item.score || 0), 0) / totalAudits)
    : 0;

  const completion = totalAudits > 0
    ? Math.max(0, Math.min(100, Math.round((completedCount / totalAudits) * 100)))
    : 0;

  const complianceStatus = totalAudits === 0 ? 'Draft' : averageScore >= 80 ? 'Healthy' : averageScore >= 70 ? 'Stable' : 'Needs focus';
  const complianceBadge = totalAudits === 0 ? 'neutral' : averageScore >= 80 ? 'success' : averageScore >= 70 ? 'warning' : 'fail';
  const complianceTrend = totalAudits === 0 ? '0%' : averageScore >= 80 ? '+8% MoM' : `+${Math.max(1, Math.round((averageScore - 60) / 2))}% MoM`;

  const complianceEl = document.getElementById('dashboardComplianceValue');
  const complianceStatusEl = document.getElementById('dashboardComplianceStatus');
  const complianceTrendEl = document.getElementById('dashboardComplianceTrend');
  const activeAuditValueEl = document.getElementById('dashboardActiveAuditValue');
  const activeAuditBadgeEl = document.getElementById('dashboardActiveAuditBadge');
  const activeAuditTrendEl = document.getElementById('dashboardActiveAuditTrend');
  const findingValueEl = document.getElementById('dashboardFindingValue');
  const findingBadgeEl = document.getElementById('dashboardFindingBadge');
  const findingTrendEl = document.getElementById('dashboardFindingTrend');
  const completionValueEl = document.getElementById('dashboardCompletionValue');
  const completionBadgeEl = document.getElementById('dashboardCompletionBadge');
  const completionTrendEl = document.getElementById('dashboardCompletionTrend');

  if (complianceEl) complianceEl.textContent = `${averageScore}%`;
  if (complianceStatusEl) {
    complianceStatusEl.textContent = complianceStatus;
    complianceStatusEl.className = `kpi-pill ${complianceBadge}`;
  }
  if (complianceTrendEl) complianceTrendEl.textContent = complianceTrend;

  if (activeAuditValueEl) activeAuditValueEl.textContent = String(totalAudits);
  if (activeAuditBadgeEl) activeAuditBadgeEl.textContent = String(totalAudits);
  if (activeAuditTrendEl) activeAuditTrendEl.textContent = `${completedCount} selesai`;

  if (findingValueEl) findingValueEl.textContent = String(totalFindings);
  if (findingBadgeEl) findingBadgeEl.textContent = String(totalFindings);
  if (findingTrendEl) findingTrendEl.textContent = `${highFindingCount} prioritas`;

  if (completionValueEl) completionValueEl.textContent = `${completion}%`;
  if (completionBadgeEl) completionBadgeEl.textContent = `${completion}%`;
  if (completionTrendEl) completionTrendEl.textContent = totalAudits === 0 ? 'no data' : completion >= 90 ? 'on track' : completion >= 75 ? 'watchlist' : 'needs action';

  const domains = ['Perencanaan SDM', 'Rekrutmen', 'Pelatihan', 'Kinerja', 'Kompensasi'];
  const domainBars = document.querySelectorAll('.mini-bar-group');
  if (domainBars && domainBars.length >= 5) {
    domains.forEach((domain, idx) => {
      const group = domainBars[idx];
      if (!group) return;
      const domainFindings = findingList.filter((f) => (f.area || '').toLowerCase() === domain.toLowerCase());
      const closedDomainFindings = domainFindings.filter((f) => f.status === 'closed').length;
      let pct = 100;
      if (domainFindings.length > 0) {
        pct = Math.round((closedDomainFindings / domainFindings.length) * 100);
      } else if (totalAudits > 0) {
        pct = averageScore;
      } else {
        pct = 0;
      }
      const span = group.querySelector('.mini-bar span');
      if (span) span.style.width = `${pct}%`;
    });
  }

  const riskBadge = document.querySelector('.status-stack .status-row:nth-child(1) .risk-badge');
  if (riskBadge) {
    const riskLevel = highFindingCount >= 3 ? 'High' : highFindingCount >= 1 ? 'Medium' : 'Low';
    riskBadge.textContent = riskLevel;
    riskBadge.className = `risk-badge ${riskLevel === 'High' ? 'negative' : riskLevel === 'Medium' ? 'medium' : 'positive'}`;
  }

  const coverageBadge = document.querySelector('.status-stack .status-row:nth-child(3) .risk-badge');
  if (coverageBadge) {
    coverageBadge.textContent = `${completion}%`;
  }
}

function renderChecklist() {
  const search = (document.getElementById('searchChecklist')?.value || '').toLowerCase();
  const filter = document.getElementById('areaFilter')?.value || '';
  const list = document.getElementById('auditList');
  if (!list) return;

  const filtered = auditItems.filter(([area, title, description]) => {
    const matchArea = !filter || area === filter;
    const haystack = `${area} ${title} ${description}`.toLowerCase();
    return matchArea && haystack.includes(search);
  });

  list.innerHTML = filtered.map(([area, title, description, score]) => {
    const actualIndex = auditItems.findIndex((item) => item[0] === area && item[1] === title && item[2] === description && item[3] === score);
    const scoreLabel = ['Sangat lemah', 'Lemah', 'Memadai', 'Kuat', 'Sangat kuat'][score - 1] || 'Belum dinilai';
    return `
      <div class="audit-item">
        <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div>
            <small style="color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em;">${area}</small>
            <h4 style="margin: 6px 0 4px;">${title}</h4>
            <p style="margin:0; color: var(--muted); line-height:1.6;">${description}</p>
          </div>
          <span class="status ${score >= 4 ? 'pass' : score >= 3 ? 'warn' : 'fail'}" style="white-space:nowrap;">${scoreLabel}</span>
        </div>
        <div class="rate-group" style="margin-top: 12px;">
          ${[1,2,3,4,5].map((n) => `<button class="rate-btn ${score === n ? 'selected' : ''}" onclick="setScore(${actualIndex}, ${n})">${n}</button>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function setScore(index, value) {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Anda tidak memiliki akses untuk menilai checklist.');
    return;
  }

  auditItems[index][3] = value;
  renderChecklist();
  score();
}

function score() {
  const total = auditItems.reduce((sum, item) => sum + Number(item[3] || 0), 0);
  const percentage = Math.round((total / (auditItems.length * 5)) * 100);
  const label = percentage >= 85 ? 'Sangat Baik' : percentage >= 75 ? 'Memadai' : percentage >= 60 ? 'Perlu Perbaikan' : 'Kritis';
  const box = document.getElementById('scoreOut');
  if (box) box.innerHTML = `<strong>Skor Audit Checklist: ${percentage}%</strong> — ${label} (${total} dari ${auditItems.length * 5} poin).`;
  const scoreInput = document.getElementById('auditScore');
  if (scoreInput) scoreInput.value = percentage;
}

function refreshEmployeeList() {
  employeePage = 1;
  return loadBackendData();
}

function getPasswordStrength(password) {
  if (!password) {
    return { score: 0, label: 'Belum diisi', valid: false };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: 'Lemah', valid: false };
  if (score <= 4) return { score, label: 'Cukup', valid: true };
  return { score, label: 'Kuat', valid: true };
}

function renderEmployeePasswordStrength() {
  const input = document.getElementById('empPassword');
  const target = document.getElementById('empPasswordStrength');
  if (!input || !target) return;

  const strength = getPasswordStrength(input.value);
  const colors = {
    Lemah: '#dc3545',
    Cukup: '#d99000',
    Kuat: '#159957',
    'Belum diisi': '#697586'
  };

  target.textContent = strength.valid
    ? `Kekuatan password: ${strength.label}`
    : strength.label === 'Belum diisi'
      ? 'Password minimal 8 karakter dengan huruf besar, kecil, angka, dan simbol.'
      : `Kekuatan password: ${strength.label} — gunakan kombinasi lebih kuat.`;
  target.style.color = colors[strength.label] || '#697586';
}

function renderEmployeeDetail(detail) {
  const panel = document.getElementById('employeeDetailPanel');
  if (!panel) return;

  if (!detail) {
    panel.innerHTML = '<div class="employee-detail-empty">Pilih karyawan untuk melihat detail akses, status, dan data akun.</div>';
    return;
  }

  panel.innerHTML = `
    <div class="employee-detail-card">
      <div class="employee-detail-header">
        <div>
          <small>DETAIL KARYAWAN</small>
          <h3>${detail.name || 'Karyawan'}</h3>
        </div>
        <span class="status ${detail.role === 'admin' ? 'pass' : detail.is_active ? 'pass' : 'neutral'}">${detail.is_active ? 'Aktif' : 'Nonaktif'}</span>
      </div>
      <div class="employee-detail-grid">
        <div><label>ID</label><strong>#${detail.id}</strong></div>
        <div><label>Email</label><strong>${detail.email}</strong></div>
        <div><label>Role</label><strong>${detail.role}</strong></div>
        <div><label>Divisi</label><strong>${detail.division || 'Umum'}</strong></div>
        <div><label>Dibuat</label><strong>${detail.created_at ? new Date(detail.created_at).toLocaleDateString('id-ID') : '-'}</strong></div>
      </div>
    </div>
  `;
}

function renderEmployees() {
  const search = (document.getElementById('employeeSearch')?.value || '').toLowerCase();
  const roleFilter = (document.getElementById('roleFilter')?.value || '').toLowerCase();
  const sortValue = document.getElementById('employeeSort')?.value || 'id-asc';
  const body = document.getElementById('employeeTableBody');
  const paginationEl = document.getElementById('employeePagination');
  if (!body) return;

  const filtered = employeeSeed.filter((row) => {
    const text = row.join(' ').toLowerCase();
    const roleMatch = !roleFilter || String(row[3]).toLowerCase() === roleFilter;
    return roleMatch && text.includes(search);
  });

  filtered.sort((a, b) => {
    const [key, direction] = sortValue.split('-');
    const dir = direction === 'desc' ? -1 : 1;
    const valueA = String(a[key === 'id' ? 0 : key === 'name' ? 1 : key === 'role' ? 3 : key === 'division' ? 4 : 3]).toLowerCase();
    const valueB = String(b[key === 'id' ? 0 : key === 'name' ? 1 : key === 'role' ? 3 : key === 'division' ? 4 : 3]).toLowerCase();

    if (key === 'id') {
      return (Number(a[0]) - Number(b[0])) * dir;
    }

    if (valueA < valueB) return -1 * dir;
    if (valueA > valueB) return 1 * dir;
    return (Number(a[0]) - Number(b[0])) * dir;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE));
  employeePage = Math.min(employeePage, totalPages);
  const startIndex = (employeePage - 1) * EMPLOYEE_PAGE_SIZE;
  const pageRows = filtered.slice(startIndex, startIndex + EMPLOYEE_PAGE_SIZE);

  if (!filtered.length) {
    body.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color: var(--muted); padding: 24px 10px;">
          <div style="display:flex; flex-direction:column; gap:8px; align-items:center; justify-content:center;">
            <strong style="font-size:1rem; color: var(--text);">Belum ada data karyawan</strong>
            <span>Tambahkan karyawan baru untuk mulai mengelola data personel.</span>
          </div>
        </td>
      </tr>
    `;
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  body.innerHTML = pageRows.map((row) => {
    const isAdminRow = String(row[3]).toLowerCase() === 'admin';
    return `
    <tr>
      <td class="employee-id-cell">${row[0]}</td>
      <td>${row[1]}</td>
      <td>${row[2]}</td>
      <td>${row[3]}</td>
      <td>${row[4] || 'Umum'}</td>
      <td><span class="status pass">${row[5]}</span></td>
      <td>
        <div class="employee-action-group">
          <button class="employee-action-btn primary" onclick="openEmployeeDetail('${row[0]}')">Detail</button>
          <button class="employee-action-btn" onclick="editEmployeeRow('${row[0]}')">Edit</button>
          <button class="employee-action-btn" onclick="openResetPasswordModal('${row[0]}')">Reset Password</button>
          ${isAdminRow ? '<button class="employee-action-btn delete" disabled title="Admin tidak dapat dihapus">Delete</button>' : `<button class="employee-action-btn delete" onclick="deleteEmployeeRow('${row[0]}')">Delete</button>`}
        </div>
      </td>
    </tr>
  `;
  }).join('');

  if (paginationEl) {
    const prevDisabled = employeePage === 1 ? 'disabled' : '';
    const nextDisabled = employeePage >= totalPages ? 'disabled' : '';
    const startRow = filtered.length ? startIndex + 1 : 0;
    const endRow = Math.min(startIndex + pageRows.length, filtered.length);
    paginationEl.innerHTML = `
      <div class="employee-pagination-inner">
        <button class="page-btn" ${prevDisabled} onclick="employeePage=Math.max(1, employeePage-1); renderEmployees();">Sebelumnya</button>
        <span>Halaman ${employeePage} / ${totalPages} · ${startRow}-${endRow} dari ${filtered.length}</span>
        <button class="page-btn" ${nextDisabled} onclick="employeePage=Math.min(${totalPages}, employeePage+1); renderEmployees();">Berikutnya</button>
      </div>
    `;
  }
}

async function deleteEmployeeRow(id) {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat menghapus data karyawan.');
    return;
  }

  const target = employeeSeed.find((row) => row[0] === id);
  if (target && String(target[3]).toLowerCase() === 'admin') {
    toast('Admin tidak dapat dihapus.');
    return;
  }

  if (!window.confirm('Apakah Anda yakin ingin menghapus karyawan ini?')) {
    return;
  }

  try {
    await apiRequest(`/api/users/${id}`, { method: 'DELETE' });
    toast('Karyawan berhasil dihapus.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menghapus karyawan.');
  }
}

function openResetPasswordModal(id) {
  resetPasswordTargetId = id;
  const target = employeeSeed.find((row) => row[0] === id);
  const titleEl = document.getElementById('resetPasswordTitle');
  const inputEl = document.getElementById('resetPasswordInput');
  const modal = document.getElementById('resetPasswordModal');

  if (titleEl) titleEl.textContent = target ? `Reset password untuk ${target[1]}` : 'Reset Password';
  if (inputEl) inputEl.value = '';
  if (modal) modal.classList.remove('hidden');
}

function closeResetPasswordModal() {
  const modal = document.getElementById('resetPasswordModal');
  if (modal) modal.classList.add('hidden');
  resetPasswordTargetId = null;
}

async function confirmResetPassword() {
  const passwordInput = document.getElementById('resetPasswordInput');
  const password = passwordInput ? passwordInput.value : '';
  const targetId = resetPasswordTargetId;

  if (!targetId) {
    toast('Target reset password tidak tersedia.');
    return;
  }

  if (!password) {
    toast('Password baru wajib diisi.');
    return;
  }

  const strength = getPasswordStrength(password);
  if (!strength.valid) {
    toast('Password belum memenuhi aturan keamanan minimum.');
    return;
  }

  try {
    await apiRequest(`/api/users/${targetId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    toast('Password karyawan berhasil direset.');
    closeResetPasswordModal();
  } catch (err) {
    toast(err.message || 'Gagal mereset password karyawan.');
  }
}

async function openEmployeeDetail(id) {
  const current = currentUser();
  if (!current || !current.token) {
    toast('Silakan login terlebih dahulu.');
    return;
  }

  try {
    const detail = await apiRequest(`/api/users/${id}`);
    employeeDetailState = detail;
    renderEmployeeDetail(detail);
  } catch (err) {
    toast(err.message || 'Gagal memuat detail karyawan.');
  }
}

function updateEmployeeFormIdentity() {
  const identityEl = document.getElementById('employeeFormIdentity');
  const nameEl = document.getElementById('empName');
  if (!identityEl) return;

  const editId = nameEl && nameEl.dataset.editId ? Number(nameEl.dataset.editId) : null;
  identityEl.textContent = editId ? `Edit ID #${editId}` : 'ID baru otomatis';
}

function editEmployeeRow(id) {
  const target = employeeSeed.find((row) => row[0] === id);
  if (!target) return;
  const nameEl = document.getElementById('empName');
  const emailEl = document.getElementById('empEmail');
  const roleEl = document.getElementById('empRole');
  const divisionEl = document.getElementById('empDivision');
  if (nameEl) nameEl.value = target[1];
  if (emailEl) emailEl.value = target[2];
  if (roleEl) roleEl.value = String(target[3]).toLowerCase();
  if (divisionEl) divisionEl.value = target[4] || 'Umum';
  if (nameEl) nameEl.dataset.editId = id;
  const passwordEl = document.getElementById('empPassword');
  if (passwordEl) passwordEl.value = '';
  updateEmployeeFormIdentity();
  toast('Data karyawan siap diubah.');
}

function resetEmployeeForm() {
  const formFields = ['empName', 'empEmail', 'empPassword', 'empDivision'];
  formFields.forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
  const nameEl = document.getElementById('empName');
  if (nameEl) delete nameEl.dataset.editId;
  const roleEl = document.getElementById('empRole');
  const divisionEl = document.getElementById('empDivision');
  if (roleEl) roleEl.value = 'viewer';
  if (divisionEl) divisionEl.value = 'Umum';
  updateEmployeeFormIdentity();
  renderEmployeePasswordStrength();
}

async function apiRequest(path, options = {}) {
  const session = currentUser();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let lastError = null;

  for (const base of API_BASE_CANDIDATES) {
    try {
      const res = await fetch(`${base}${path}`, { ...options, headers });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'Request failed');
      }

      const contentType = res.headers.get('content-type') || '';
      return contentType.includes('application/json') ? res.json() : null;
    } catch (error) {
      if (error && error.message && error.message !== 'Request failed') {
        const message = String(error.message || '');
        if (message.includes('Failed to fetch') || message.includes('fetch')) {
          lastError = error;
          continue;
        }
      }

      lastError = error;
      break;
    }
  }

  throw lastError || new Error('Request failed');
}

async function login() {
  const emailEl = document.getElementById('loginEmail');
  const passwordEl = document.getElementById('loginPassword');
  const email = emailEl?.value.trim();
  const password = passwordEl?.value.trim();

  try {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    localStorage.setItem('hrAuditSession', JSON.stringify({ email: data.user.email, role: data.user.role, name: data.user.name, token: data.token }));
    renderAuthState();
    toast('Login berhasil.');
    await loadBackendData();
    return;
  } catch (err) {
    toast(err.message || 'Email atau password tidak valid.');
  }
}

function logout() {
  localStorage.removeItem('hrAuditSession');
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.style.display = 'flex';
  toast('Anda telah logout.');
}

async function saveAudit() {
  const user = currentUser();
  if (!user || !user.token) {
    toast('Silakan login terlebih dahulu.');
    return;
  }

  const title = document.getElementById('auditTitle')?.value.trim();
  const department = document.getElementById('auditDepartment')?.value.trim();
  const status = document.getElementById('auditStatus')?.value || 'draft';
  const score = Number(document.getElementById('auditScore')?.value || 0);
  const id = document.getElementById('auditTitle')?.dataset.editId;

  if (!title) {
    toast('Judul audit wajib diisi.');
    return;
  }

  try {
    let savedAudit;
    if (id) {
      savedAudit = await apiRequest(`/api/audits/${id}`, { method: 'PUT', body: JSON.stringify({ title, department, status, score }) });
      toast('Audit berhasil diperbarui.');
    } else {
      savedAudit = await apiRequest('/api/audits', { method: 'POST', body: JSON.stringify({ title, department, status, score }) });
      toast('Audit berhasil ditambahkan.');
    }

    if (savedAudit && savedAudit.id) {
      selectedAuditId = String(savedAudit.id);
    }

    const titleField = document.getElementById('auditTitle');
    if (titleField) {
      titleField.value = title;
      titleField.dataset.editId = id || savedAudit?.id;
    }
    const departmentField = document.getElementById('auditDepartment');
    if (departmentField) departmentField.value = department || '';
    const statusField = document.getElementById('auditStatus');
    if (statusField) statusField.value = status || 'draft';
    const scoreField = document.getElementById('auditScore');
    if (scoreField) scoreField.value = score;
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menyimpan audit.');
  }
}

function populateFindingAuditSelector() {
  const selector = document.getElementById('findingAuditId');
  if (!selector) return;

  const previousValue = selectedAuditId || (document.getElementById('auditTitle')?.dataset.editId || '');
  selector.innerHTML = '<option value="">Pilih audit</option>' + auditCache.map((audit) => {
    const label = `${audit.title || 'Audit'}${audit.department ? ` — ${audit.department}` : ''}`;
    return `<option value="${audit.id}">${label}</option>`;
  }).join('');

  const validSelection = auditCache.some((audit) => String(audit.id) === String(previousValue)) ? previousValue : '';
  selectedAuditId = validSelection || (auditCache[0] ? String(auditCache[0].id) : '');
  selector.value = selectedAuditId || '';
}

function renderSavedAuditList() {
  const body = document.getElementById('savedAuditTableBody');
  if (!body) return;

  if (!auditCache.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--muted);">Belum ada audit tersimpan.</td></tr>';
    return;
  }

  body.innerHTML = auditCache.map((audit) => {
    const linkedFindingCount = (findingCache || []).filter((finding) => String(finding.audit_id) === String(audit.id)).length;
    const auditScore = Number(audit.score || 0);
    const scoreClass = auditScore >= 80 ? 'pass' : auditScore >= 60 ? 'warn' : 'fail';
    return `
      <tr>
        <td>${audit.title || 'Audit tanpa judul'}</td>
        <td>${audit.department || '-'}</td>
        <td><span class="status ${scoreClass}">${auditScore}%</span></td>
        <td><span class="status ${audit.status === 'completed' ? 'pass' : audit.status === 'in_progress' ? 'warn' : 'neutral'}">${audit.status || 'draft'}</span></td>
        <td>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn ghost" onclick="selectAuditForFinding(${audit.id})">Pilih</button>
            <button class="btn ghost" onclick="editAuditRecord(${audit.id})">Edit</button>
            <button class="btn ghost" onclick="deleteAuditRecord(${audit.id}, ${linkedFindingCount})">Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function selectAuditForFinding(id) {
  selectedAuditId = String(id);
  const selector = document.getElementById('findingAuditId');
  if (selector) selector.value = String(id);
  loadBackendData();
}

function editAuditRecord(id) {
  const target = auditCache.find((item) => String(item.id) === String(id));
  if (!target) return;

  const titleField = document.getElementById('auditTitle');
  const departmentField = document.getElementById('auditDepartment');
  const statusField = document.getElementById('auditStatus');
  const scoreField = document.getElementById('auditScore');

  if (titleField) {
    titleField.value = target.title || '';
    titleField.dataset.editId = id;
  }
  if (departmentField) departmentField.value = target.department || '';
  if (statusField) statusField.value = target.status || 'draft';
  if (scoreField) scoreField.value = Number(target.score || 0);

  const checklistPage = document.getElementById('checklist');
  if (checklistPage) checklistPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Audit siap diubah.');
}

async function deleteAuditRecord(id, linkedFindingCount = 0) {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Anda tidak memiliki akses untuk menghapus audit.');
    return;
  }

  const message = linkedFindingCount > 0
    ? `Audit ini terhubung ke ${linkedFindingCount} temuan. Apakah Anda yakin ingin menghapus audit ini beserta temuan terkait?`
    : 'Apakah Anda yakin ingin menghapus audit ini?';

  if (!window.confirm(message)) {
    return;
  }

  try {
    await apiRequest(`/api/audits/${id}`, { method: 'DELETE' });
    if (selectedAuditId === String(id)) {
      selectedAuditId = null;
    }
    toast('Audit berhasil dihapus.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menghapus audit.');
  }
}

function populateReportAuditSelector() {
  const selector = document.getElementById('reportAuditSelect');
  if (!selector) return;

  const currentValue = selectedReportAuditId || (auditCache[0] ? String(auditCache[0].id) : '');
  selector.innerHTML = '<option value="">Pilih audit...</option>' + auditCache.map((audit) => {
    const label = `${audit.title || 'Audit'}${audit.department ? ` (${audit.department})` : ''}`;
    return `<option value="${audit.id}">${label}</option>`;
  }).join('');

  if (auditCache.some((audit) => String(audit.id) === String(currentValue))) {
    selectedReportAuditId = currentValue;
    selector.value = currentValue;
  } else {
    selectedReportAuditId = auditCache[0] ? String(auditCache[0].id) : null;
    selector.value = selectedReportAuditId || '';
  }
}

function onReportAuditSelectChange() {
  const selector = document.getElementById('reportAuditSelect');
  selectedReportAuditId = selector ? selector.value || null : null;
  reportCustomization = {};
  renderReportView();
}

function applyReportCustomization() {
  const summary = document.getElementById('reportExecutiveSummary')?.value.trim();
  const recs = document.getElementById('reportRecommendations')?.value.trim();
  const period = document.getElementById('reportPeriod')?.value;
  const dept = document.getElementById('reportDepartment')?.value.trim();
  const auditor = document.getElementById('reportAuditorName')?.value.trim();

  reportCustomization = {
    summary: summary || null,
    recommendations: recs ? recs.split('\n').filter((item) => item.trim()) : null,
    period: period || null,
    department: dept || null,
    auditor: auditor || null
  };

  renderReportView();
  toast('Laporan audit berhasil diperbarui.');
}

function resetReportForm() {
  reportCustomization = {};
  const fields = ['reportExecutiveSummary', 'reportRecommendations', 'reportPeriod', 'reportDepartment', 'reportAuditorName'];
  fields.forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = '';
  });
  renderReportView();
  toast('Form laporan di-reset ke data default.');
}

async function saveReportToDatabase() {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Akses dibatasi hanya untuk admin/auditor.');
    return;
  }

  const targetAudit = auditCache.find((audit) => String(audit.id) === String(selectedReportAuditId)) || auditCache[0] || null;
  const title = targetAudit ? `Laporan Audit: ${targetAudit.title}` : 'Laporan Audit SDM';
  const department = document.getElementById('reportDepartment')?.value.trim() || targetAudit?.department || 'General';
  const auditorName = document.getElementById('reportAuditorName')?.value.trim() || user?.name || 'Auditor SDM';
  const period = document.getElementById('reportPeriod')?.value || new Date().toISOString().slice(0, 10);
  const executiveSummary = document.getElementById('reportExecutiveSummary')?.value.trim() || (document.getElementById('reportSummaryContent')?.textContent || '');
  const recsElement = document.getElementById('reportRecommendations');
  const recommendations = recsElement?.value.trim() || Array.from(document.querySelectorAll('#reportRecommendationsList li')).map((li) => li.textContent).join('\n');
  const score = targetAudit ? Number(targetAudit.score || 0) : 78;

  try {
    await apiRequest('/api/reports', {
      method: 'POST',
      body: JSON.stringify({
        audit_id: targetAudit ? targetAudit.id : null,
        title,
        department,
        auditor_name: auditorName,
        period,
        executive_summary: executiveSummary,
        recommendations,
        score
      })
    });
    toast('Laporan audit berhasil disimpan ke database.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menyimpan laporan audit.');
  }
}

function renderSavedReports() {
  const body = document.getElementById('savedReportTableBody');
  const countBadge = document.getElementById('savedReportCount');
  if (countBadge) countBadge.textContent = `${savedReportsCache.length} Laporan`;
  if (!body) return;

  if (!savedReportsCache.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--muted);">Belum ada laporan tersimpan di database.</td></tr>';
    return;
  }

  body.innerHTML = savedReportsCache.map((report) => `
    <tr>
      <td><strong>${report.title || 'Laporan tanpa judul'}</strong></td>
      <td>${report.audit_title || 'Umum'}</td>
      <td>${report.department || '-'}</td>
      <td>${report.auditor_name || '-'}</td>
      <td><span class="status ${report.score >= 80 ? 'pass' : report.score >= 70 ? 'warn' : 'fail'}">${report.score || 0}%</span></td>
      <td>${report.period || (report.created_at ? report.created_at.slice(0, 10) : '-')}</td>
      <td>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn ghost" onclick="loadSavedReport(${report.id})">Buka</button>
          <button class="btn ghost" onclick="deleteReportRecord(${report.id})">Hapus</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function loadSavedReport(id) {
  const report = savedReportsCache.find((r) => String(r.id) === String(id));
  if (!report) return;

  if (report.audit_id) {
    selectedReportAuditId = String(report.audit_id);
    const select = document.getElementById('reportAuditSelect');
    if (select) select.value = String(report.audit_id);
  }

  reportCustomization = {
    summary: report.executive_summary || null,
    recommendations: report.recommendations ? report.recommendations.split('\n').filter((x) => x.trim()) : null,
    period: report.period || null,
    department: report.department || null,
    auditor: report.auditor_name || null
  };

  const summaryInput = document.getElementById('reportExecutiveSummary');
  const recInput = document.getElementById('reportRecommendations');
  const periodInput = document.getElementById('reportPeriod');
  const deptInput = document.getElementById('reportDepartment');
  const auditorInput = document.getElementById('reportAuditorName');

  if (summaryInput) summaryInput.value = report.executive_summary || '';
  if (recInput) recInput.value = report.recommendations || '';
  if (periodInput) periodInput.value = report.period || '';
  if (deptInput) deptInput.value = report.department || '';
  if (auditorInput) auditorInput.value = report.auditor_name || '';

  renderReportView();
  toast(`Laporan "${report.title}" dimuat.`);
}

async function deleteReportRecord(id) {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Anda tidak memiliki akses untuk menghapus laporan.');
    return;
  }

  if (!window.confirm('Apakah Anda yakin ingin menghapus laporan audit ini dari database?')) {
    return;
  }

  try {
    await apiRequest(`/api/reports/${id}`, { method: 'DELETE' });
    toast('Laporan audit berhasil dihapus.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menghapus laporan audit.');
  }
}

function renderReportView() {
  const targetAudit = auditCache.find((audit) => String(audit.id) === String(selectedReportAuditId)) || auditCache[0] || null;
  const user = currentUser();

  const titleEl = document.getElementById('reportActiveTitle');
  const deptEl = document.getElementById('reportActiveDept');
  const auditorEl = document.getElementById('reportActiveAuditor');
  const dateEl = document.getElementById('reportActiveDate');
  const statusBadge = document.getElementById('reportActiveStatusBadge');

  if (!targetAudit) {
    if (titleEl) titleEl.textContent = 'Belum ada data audit';
    if (deptEl) deptEl.textContent = '-';
    if (auditorEl) auditorEl.textContent = user?.name || 'Auditor';
    if (dateEl) dateEl.textContent = '-';
    if (statusBadge) {
      statusBadge.textContent = 'Draft';
      statusBadge.className = 'status neutral';
    }
  } else {
    if (titleEl) titleEl.textContent = targetAudit.title || 'Audit SDM';
    if (deptEl) deptEl.textContent = reportCustomization.department || targetAudit.department || 'General';
    if (auditorEl) auditorEl.textContent = reportCustomization.auditor || targetAudit.auditor_name || user?.name || 'Auditor SDM';
    if (dateEl) dateEl.textContent = reportCustomization.period || (targetAudit.created_at ? targetAudit.created_at.slice(0, 10) : 'Terbaru');
    if (statusBadge) {
      const statusVal = targetAudit.status || 'draft';
      statusBadge.textContent = statusVal.replace('_', ' ').toUpperCase();
      statusBadge.className = `status ${statusVal === 'completed' ? 'pass' : statusVal === 'in_progress' ? 'warn' : 'neutral'}`;
    }
  }

  const linkedFindings = targetAudit
    ? findingCache.filter((finding) => String(finding.audit_id) === String(targetAudit.id))
    : findingCache;

  const score = targetAudit
    ? Number(targetAudit.score || 0)
    : (auditCache.length ? Math.round(auditCache.reduce((sum, item) => sum + Number(item.score || 0), 0) / auditCache.length) : 0);
  const scoreLabel = score >= 85 ? 'Sangat Baik' : score >= 75 ? 'Memadai' : score >= 60 ? 'Perlu Perbaikan' : score > 0 ? 'Kritis' : 'Belum Ada Data';

  const scoreDisplay = document.getElementById('reportScoreDisplay');
  const scorePill = document.getElementById('reportScorePill');
  const scoreStatusText = document.getElementById('reportScoreStatusText');
  const summaryScoreBadge = document.getElementById('reportSummaryScoreBadge');

  if (scoreDisplay) scoreDisplay.textContent = `${score}%`;
  if (scorePill) {
    scorePill.textContent = scoreLabel;
    scorePill.className = `kpi-pill ${score >= 80 ? 'success' : score >= 60 ? 'warning' : score > 0 ? 'fail' : 'neutral'}`;
  }
  if (scoreStatusText) scoreStatusText.textContent = `Status: ${scoreLabel}`;
  if (summaryScoreBadge) summaryScoreBadge.textContent = `${score}%`;

  const totalCount = linkedFindings.length;
  const highCount = linkedFindings.filter((item) => (item.risk_level || 'medium').toLowerCase() === 'high').length;
  const closedCount = linkedFindings.filter((item) => (item.status || 'open') === 'closed').length;

  const totalBadge = document.getElementById('reportTotalFindingsBadge');
  const totalVal = document.getElementById('reportTotalFindingsVal');
  const highBadge = document.getElementById('reportHighFindingsBadge');
  const highVal = document.getElementById('reportHighFindingsVal');
  const closedBadge = document.getElementById('reportClosedFindingsBadge');
  const closedVal = document.getElementById('reportClosedFindingsVal');

  if (totalBadge) totalBadge.textContent = String(totalCount);
  if (totalVal) totalVal.textContent = String(totalCount);
  if (highBadge) highBadge.textContent = String(highCount);
  if (highVal) highVal.textContent = String(highCount);
  if (closedBadge) closedBadge.textContent = String(closedCount);
  if (closedVal) closedVal.textContent = String(closedCount);

  const summaryContent = document.getElementById('reportSummaryContent');
  if (summaryContent) {
    if (reportCustomization.summary) {
      summaryContent.textContent = reportCustomization.summary;
    } else if (targetAudit) {
      summaryContent.textContent = `Audit "${targetAudit.title}" untuk departemen ${targetAudit.department || 'General'} memperoleh skor kepatuhan ${score}% (${scoreLabel}). Terdeteksi total ${totalCount} temuan operasional dengan ${highCount} temuan berisiko tinggi yang membutuhkan penanganan prioritas.`;
    } else {
      summaryContent.textContent = 'Secara umum pengelolaan SDM berada pada tingkat memadai. Area dengan skor terendah adalah Pelatihan dan Pengembangan serta Pengelolaan Rekrutmen.';
    }
  }

  const recList = document.getElementById('reportRecommendationsList');
  if (recList) {
    const recommendations = reportCustomization.recommendations || (linkedFindings.length
      ? linkedFindings.map((item, idx) => `${idx + 1}. [${(item.area || 'Umum').toUpperCase()}] ${item.description} (PIC: ${item.pic || 'TBD'})`)
      : [
          'Standarisasi dokumen rekrutmen dan form evaluasi kandidat.',
          'Evaluasi efektivitas pelatihan berkala sesuai kebutuhan kompetensi.',
          'Tetapkan kalender review KPI dan pemantauan tindak lanjut bulanan.'
        ]);

    recList.innerHTML = recommendations.map((rec) => `<li>${rec.replace(/^\d+\.\s*/, '')}</li>`).join('');
  }

  const actionBody = document.getElementById('reportActionPlanBody');
  const actionPlanCount = document.getElementById('reportActionPlanCount');
  if (actionPlanCount) actionPlanCount.textContent = `${linkedFindings.length} Temuan`;

  if (actionBody) {
    if (!linkedFindings.length) {
      actionBody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">Belum ada temuan untuk audit yang dipilih.</td></tr>';
    } else {
      actionBody.innerHTML = linkedFindings.map((item, index) => {
        const risk = (item.risk_level || 'medium').toLowerCase();
        const className = risk === 'high' ? 'fail' : risk === 'low' ? 'pass' : 'warn';
        const statusValue = item.status || 'open';
        const statusLabel = formatFindingStatus(statusValue);
        return `
          <tr>
            <td>F-${String(item.id || index + 1).padStart(3, '0')}</td>
            <td>${item.area || 'Umum'}</td>
            <td>${item.description || '-'}</td>
            <td><span class="status ${className}">${(item.risk_level || 'medium').toUpperCase()}</span></td>
            <td>${item.pic || 'Belum ditentukan'}</td>
            <td><span class="status ${getFindingStatusClass(statusValue)}">${statusLabel}</span></td>
          </tr>
        `;
      }).join('');
    }
  }
}

function formatFindingStatus(status) {
  if (!status) return 'Open';
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getFindingStatusClass(status) {
  if (status === 'closed') return 'pass';
  if (status === 'on_progress') return 'warn';
  return 'warn';
}

function applyFindingStatusFilter() {
  const filter = document.getElementById('findingStatusFilter');
  selectedFindingStatus = filter ? filter.value : '';
  loadBackendData();
}

function renderFindingSummary(items = []) {
  const dataset = items.length ? items : findingCache;
  const high = dataset.filter((item) => (item.risk_level || 'medium').toLowerCase() === 'high').length;
  const medium = dataset.filter((item) => (item.risk_level || 'medium').toLowerCase() === 'medium').length;
  const closed = dataset.filter((item) => (item.status || 'open') === 'closed').length;

  const highEl = document.getElementById('findingHighCount');
  const mediumEl = document.getElementById('findingMediumCount');
  const closedEl = document.getElementById('findingClosedCount');

  if (highEl) highEl.textContent = String(high);
  if (mediumEl) mediumEl.textContent = String(medium);
  if (closedEl) closedEl.textContent = String(closed);
}

function resetFindingForm() {
  const formFields = ['findingDescription', 'findingPic', 'findingDate'];
  formFields.forEach((id) => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });

  const areaField = document.getElementById('findingArea');
  const riskField = document.getElementById('findingRisk');
  const statusField = document.getElementById('findingStatus');
  const submitBtn = document.getElementById('findingSubmitBtn');

  if (areaField) areaField.value = 'Perencanaan SDM';
  if (riskField) riskField.value = 'medium';
  if (statusField) statusField.value = 'open';
  if (submitBtn) submitBtn.textContent = 'Tambah Temuan';

  const descriptionField = document.getElementById('findingDescription');
  if (descriptionField) delete descriptionField.dataset.editId;
}

function editFindingRow(id) {
  const target = findingCache.find((item) => String(item.id) === String(id));
  if (!target) return;

  const descriptionField = document.getElementById('findingDescription');
  const picField = document.getElementById('findingPic');
  const areaField = document.getElementById('findingArea');
  const riskField = document.getElementById('findingRisk');
  const statusField = document.getElementById('findingStatus');
  const submitBtn = document.getElementById('findingSubmitBtn');

  if (descriptionField) {
    descriptionField.value = target.description || '';
    descriptionField.dataset.editId = id;
  }
  if (picField) picField.value = target.pic || '';
  if (areaField) areaField.value = target.area || 'Umum';
  if (riskField) riskField.value = target.risk_level || 'medium';
  if (statusField) statusField.value = target.status || 'open';
  if (submitBtn) submitBtn.textContent = 'Update Temuan';

  const findingsPage = document.getElementById('findings');
  if (findingsPage) findingsPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Data temuan siap diubah.');
}

async function addFinding() {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Akses dibatasi hanya untuk admin/auditor.');
    return;
  }

  const description = document.getElementById('findingDescription')?.value.trim();
  const pic = document.getElementById('findingPic')?.value.trim();
  const area = document.getElementById('findingArea')?.value || 'Umum';
  const riskLevel = document.getElementById('findingRisk')?.value || 'medium';
  const status = document.getElementById('findingStatus')?.value || 'open';
  const id = document.getElementById('findingDescription')?.dataset.editId;

  if (!description || !pic) {
    toast('Isi deskripsi dan PIC.');
    return;
  }

  try {
    const auditId = document.getElementById('findingAuditId')?.value || selectedAuditId || document.getElementById('auditTitle')?.dataset.editId || null;
    const payload = { audit_id: auditId ? Number(auditId) : null, area, description, risk_level: riskLevel, pic, status };

    if (id) {
      await apiRequest(`/api/findings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast('Temuan berhasil diperbarui.');
    } else {
      await apiRequest('/api/findings', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('Temuan ditambahkan.');
    }

    resetFindingForm();
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Temuan gagal disimpan.');
  }
}

async function saveEmployee() {
  const user = currentUser();
  if (!user || !user.token || user.role !== 'admin') {
    toast('Hanya admin yang dapat menyimpan data karyawan.');
    return;
  }

  const name = document.getElementById('empName')?.value.trim();
  const email = document.getElementById('empEmail')?.value.trim();
  const role = document.getElementById('empRole')?.value || 'viewer';
  const division = document.getElementById('empDivision')?.value.trim() || 'Umum';
  const password = document.getElementById('empPassword')?.value || '';
  const id = document.getElementById('empName')?.dataset.editId;

  if (!name) {
    toast('Nama karyawan wajib diisi.');
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Format email tidak valid.');
    return;
  }

  if (!id) {
    const strength = getPasswordStrength(password);
    if (!password || !strength.valid) {
      toast('Password minimal 8 karakter, kombinasi huruf besar/kecil, angka, dan simbol.');
      renderEmployeePasswordStrength();
      return;
    }
  }

  try {
    if (id) {
      await apiRequest(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify({ name, email, role, division, is_active: true }) });
      toast('Karyawan berhasil diperbarui.');
    } else {
      await apiRequest('/api/users', { method: 'POST', body: JSON.stringify({ name, email, role, division, password }) });
      toast('Karyawan berhasil ditambahkan.');
    }
    resetEmployeeForm();
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menyimpan karyawan.');
  }
}

function exportEmployeeCsv() {
  const rows = employeeSeed.slice().sort((a, b) => Number(a[0]) - Number(b[0]));
  const header = ['ID', 'Nama', 'Email', 'Role', 'Status'];
  const csvRows = [header, ...rows.map((row) => [row[0], row[1], row[2], row[3], row[4] || 'Umum', row[5]])]
    .map((values) => values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'data-karyawan.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast('CSV karyawan berhasil diunduh.');
}

async function deleteFindingRow(id) {
  const user = currentUser();
  if (!user || !['admin', 'auditor'].includes(user.role)) {
    toast('Anda tidak memiliki akses untuk menghapus temuan.');
    return;
  }

  if (!window.confirm('Apakah Anda yakin ingin menghapus temuan ini?')) {
    return;
  }

  try {
    await apiRequest(`/api/findings/${id}`, { method: 'DELETE' });
    toast('Temuan berhasil dihapus.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal menghapus temuan.');
  }
}

async function loadBackendData() {
  const user = currentUser();
  if (!user || !user.token) return;

  try {
    const findingsQuery = selectedFindingStatus ? `?status=${encodeURIComponent(selectedFindingStatus)}` : '';
    const [auditsResult, findingsResult, usersResult, logsResult, savedReportsResult] = await Promise.allSettled([
      apiRequest('/api/audits'),
      apiRequest(`/api/findings${findingsQuery}`),
      apiRequest('/api/users'),
      apiRequest('/api/audit-logs'),
      apiRequest('/api/reports/saved')
    ]);

    if (auditsResult.status === 'fulfilled') {
      auditCache = auditsResult.value || [];
      populateFindingAuditSelector();
      populateReportAuditSelector();
      renderSavedAuditList();
      renderDashboardMetrics(auditCache, findingCache);
      renderReportView();

      if (auditCache.length) {
        const total = auditCache.reduce((sum, item) => sum + Number(item.score || 0), 0);
        const average = Math.round(total / auditCache.length);
        const label = average >= 85 ? 'Sangat Baik' : average >= 75 ? 'Memadai' : average >= 60 ? 'Perlu Perbaikan' : 'Kritis';
        const box = document.getElementById('scoreOut');
        if (box) box.innerHTML = `<strong>Skor Kepatuhan Audit DB: ${average}% (${label})</strong> — Rata-rata dari ${auditCache.length} audit tersimpan.`;
      } else {
        const box = document.getElementById('scoreOut');
        if (box) box.innerHTML = `<strong>Skor Kepatuhan Audit DB: 0%</strong> — Belum ada audit tersimpan di database.`;
      }
    }

    if (savedReportsResult.status === 'fulfilled') {
      savedReportsCache = savedReportsResult.value || [];
      renderSavedReports();
    }

    if (findingsResult.status === 'fulfilled') {
      findingCache = findingsResult.value || [];
      renderDashboardMetrics(auditCache, findingCache);
      renderReportView();
      const tbody = document.getElementById('findingTableBody');
      const activeFindings = selectedAuditId ? findingCache.filter((item) => String(item.audit_id || '') === String(selectedAuditId)) : findingCache;
      const visibleFindings = selectedFindingStatus ? activeFindings.filter((item) => (item.status || 'open') === selectedFindingStatus) : activeFindings;
      renderFindingSummary(visibleFindings);
      if (tbody) {
        if (!visibleFindings.length) {
          tbody.innerHTML = `
            <tr>
              <td colspan="8" style="text-align:center; color: var(--muted);">Belum ada temuan untuk filter ini.</td>
            </tr>
          `;
        } else {
          tbody.innerHTML = visibleFindings.map((item, index) => {
            const risk = (item.risk_level || 'medium').toLowerCase();
            const className = risk === 'high' ? 'fail' : risk === 'low' ? 'pass' : 'warn';
            const statusValue = item.status || 'open';
            const statusLabel = formatFindingStatus(statusValue);
            const relatedAudit = auditCache.find((audit) => String(audit.id) === String(item.audit_id));
            const auditLabel = relatedAudit ? relatedAudit.title || 'Audit' : 'Audit umum';
            return `
              <tr>
                <td>F-${String(item.id || index + 1).padStart(3, '0')}</td>
                <td title="${auditLabel}">${auditLabel.length > 24 ? `${auditLabel.slice(0, 24)}...` : auditLabel}</td>
                <td>${item.area || 'Umum'}</td>
                <td>${item.description || '-'}</td>
                <td><span class="status ${className}">${item.risk_level || 'Medium'}</span></td>
                <td>${item.pic || 'Belum ditentukan'}</td>
                <td><span class="status ${getFindingStatusClass(statusValue)}">${statusLabel}</span></td>
                <td>
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn ghost" onclick="editFindingRow(${item.id})">Edit</button>
                    <button class="btn ghost" onclick="deleteFindingRow(${item.id})">Delete</button>
                  </div>
                </td>
              </tr>`;
          }).join('');
        }
      }
    }

    if (usersResult.status === 'fulfilled' && usersResult.value?.length) {
      const adminUsers = usersResult.value;
      employeeSeed = adminUsers.map((user) => [
        String(user.id),
        user.name,
        user.email,
        user.role,
        user.division || 'Umum',
        user.is_active === 0 ? 'Nonaktif' : 'Aktif'
      ]);
      renderEmployees();
    } else if (usersResult.status === 'fulfilled') {
      employeeSeed = [];
      renderEmployees();
    }

    if (!employeeDetailState && employeeSeed.length) {
      renderEmployeeDetail(employeeSeed[0] ? null : null);
    }

    if (logsResult.status === 'fulfilled' && logsResult.value?.length) {
      const list = document.getElementById('auditTrailList');
      if (list) {
        list.innerHTML = logsResult.value.slice(0, 6).map((log) => `<li>${log.action || 'Aktivitas'} — ${log.entity || 'sistem'} — ${log.created_at || new Date().toISOString()}</li>`).join('');
      }
    }
  } catch (err) {
    console.warn('Backend data load failed:', err.message);
  }
}

function saveSettings() {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat mengubah pengaturan.');
    return;
  }
  toast('Pengaturan tersimpan.');
}

function openResetDatabaseModal() {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat mereset database.');
    return;
  }

  const modal = document.getElementById('resetDatabaseModal');
  const input = document.getElementById('resetDatabaseConfirmInput');
  if (modal) modal.classList.remove('hidden');
  if (input) input.value = '';
}

function closeResetDatabaseModal() {
  const modal = document.getElementById('resetDatabaseModal');
  if (modal) modal.classList.add('hidden');
  const input = document.getElementById('resetDatabaseConfirmInput');
  if (input) input.value = '';
}

async function confirmResetDatabase() {
  const input = document.getElementById('resetDatabaseConfirmInput');
  const confirmedText = (input ? input.value.trim().toLowerCase() : '');

  if (confirmedText !== 'reset database') {
    toast('Ketik "reset database" untuk melanjutkan.');
    return;
  }

  try {
    await apiRequest('/api/admin/reset-database', { method: 'POST' });
    employeeSeed = [];
    employeeDetailState = null;
    renderEmployeeDetail(null);
    renderEmployees();
    closeResetDatabaseModal();
    toast('Database berhasil direset. Hanya admin yang tersisa.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal mereset database.');
  }
}

function openClearEmployeeDataModal() {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat menghapus data karyawan.');
    return;
  }

  const modal = document.getElementById('clearEmployeeDataModal');
  const input = document.getElementById('clearEmployeeDataConfirmInput');
  if (modal) modal.classList.remove('hidden');
  if (input) input.value = '';
}

function closeClearEmployeeDataModal() {
  const modal = document.getElementById('clearEmployeeDataModal');
  if (modal) modal.classList.add('hidden');
  const input = document.getElementById('clearEmployeeDataConfirmInput');
  if (input) input.value = '';
}

async function clearEmployeeDataSafely() {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat menghapus data karyawan.');
    return;
  }

  openClearEmployeeDataModal();
}

async function confirmClearEmployeeData() {
  const input = document.getElementById('clearEmployeeDataConfirmInput');
  const confirmedText = (input ? input.value.trim().toLowerCase() : '');

  if (confirmedText !== 'hapus semua data karyawan') {
    toast('Ketik "hapus semua data karyawan" untuk melanjutkan.');
    return;
  }

  try {
    await apiRequest('/api/admin/reset-database', { method: 'POST' });
    employeeSeed = [];
    employeeDetailState = null;
    renderEmployeeDetail(null);
    renderEmployees();
    closeClearEmployeeDataModal();
    toast('Data karyawan berhasil dikosongkan.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal mengosongkan data karyawan.');
  }
}

function openResetEmployeeIdsModal() {
  const user = currentUser();
  if (!user || user.role !== 'admin') {
    toast('Hanya admin yang dapat mereset ID karyawan.');
    return;
  }

  const modal = document.getElementById('resetEmployeeIdsModal');
  const input = document.getElementById('resetEmployeeIdsConfirmInput');
  if (modal) modal.classList.remove('hidden');
  if (input) input.value = '';
}

function closeResetEmployeeIdsModal() {
  const modal = document.getElementById('resetEmployeeIdsModal');
  if (modal) modal.classList.add('hidden');
  const input = document.getElementById('resetEmployeeIdsConfirmInput');
  if (input) input.value = '';
}

async function confirmResetEmployeeIds() {
  const input = document.getElementById('resetEmployeeIdsConfirmInput');
  const confirmedText = (input ? input.value.trim().toLowerCase() : '');

  if (confirmedText !== 'reset employee ids') {
    toast('Ketik "reset employee ids" untuk melanjutkan.');
    return;
  }

  try {
    await apiRequest('/api/admin/reset-employee-ids', { method: 'POST' });
    employeeSeed = [];
    employeeDetailState = null;
    renderEmployeeDetail(null);
    renderEmployees();
    closeResetEmployeeIdsModal();
    toast('ID karyawan telah direset. Karyawan berikutnya akan dimulai dari ID yang rapi sesuai database.');
    await loadBackendData();
  } catch (err) {
    toast(err.message || 'Gagal mereset ID karyawan.');
  }
}

async function seedEmployeeData() {
  toast('Fitur seed karyawan telah dinonaktifkan.');
}

document.getElementById('menuToggle')?.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
});

document.getElementById('themeToggle')?.addEventListener('click', () => {
  const currentTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

document.getElementById('confirmResetPasswordBtn')?.addEventListener('click', confirmResetPassword);
document.getElementById('closeResetPasswordModalBtn')?.addEventListener('click', closeResetPasswordModal);
document.getElementById('resetPasswordModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'resetPasswordModal') closeResetPasswordModal();
});
document.getElementById('resetPasswordInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmResetPassword();
});

document.getElementById('confirmResetEmployeeIdsBtn')?.addEventListener('click', confirmResetEmployeeIds);
document.getElementById('closeResetEmployeeIdsModalBtn')?.addEventListener('click', closeResetEmployeeIdsModal);
document.getElementById('resetEmployeeIdsModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'resetEmployeeIdsModal') closeResetEmployeeIdsModal();
});
document.getElementById('resetEmployeeIdsConfirmInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmResetEmployeeIds();
});

document.getElementById('confirmClearEmployeeDataBtn')?.addEventListener('click', confirmClearEmployeeData);
document.getElementById('closeClearEmployeeDataModalBtn')?.addEventListener('click', closeClearEmployeeDataModal);
document.getElementById('clearEmployeeDataModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'clearEmployeeDataModal') closeClearEmployeeDataModal();
});
document.getElementById('clearEmployeeDataConfirmInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmClearEmployeeData();
});

document.getElementById('confirmResetDatabaseBtn')?.addEventListener('click', confirmResetDatabase);
document.getElementById('closeResetDatabaseModalBtn')?.addEventListener('click', closeResetDatabaseModal);
document.getElementById('resetDatabaseModal')?.addEventListener('click', (event) => {
  if (event.target.id === 'resetDatabaseModal') closeResetDatabaseModal();
});
document.getElementById('resetDatabaseConfirmInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') confirmResetDatabase();
});

document.getElementById('findingAuditId')?.addEventListener('change', (event) => {
  selectedAuditId = event.target.value || null;
  loadBackendData();
});

document.getElementById('findingStatusFilter')?.addEventListener('change', () => {
  applyFindingStatusFilter();
});

document.querySelectorAll('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => goToPage(button.dataset.page));
});

initTheme();
renderChecklist();
renderEmployeeDetail(null);
renderEmployees();
score();
renderDashboardMetrics([], []);
renderAuthState();
loadBackendData();
