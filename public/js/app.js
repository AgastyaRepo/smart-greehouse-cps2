// app.js - Controller Utama Smart Greenhouse CPS V2 Dashboard
// Menghubungkan API, SSE Real-time, Visualisasi Chart, State Management, & Interaksi UI

const State = {
  sensor: null,
  actuator: null,
  system: null,
  stats: null,
  config: { fanOn: 35, fanOff: 28, pumpOn: 30, pumpOff: 60 },
  readings: [],
  alerts: [],
  events: [],
  currentRange: '1h',
  currentView: 'overview',
  streamStatus: 'connecting',
  lastRxTime: 0,
  staleMs: 7000
};

// Helper Format Waktu
const formatTime = (epochMs) => new Date(epochMs).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const formatDateTime = (epochMs) => new Date(epochMs).toLocaleString('id-ID');

// Helper Sanitasi Teks
const escapeHtml = (str) => String(str).replace(/[&<>'"]/g, (tag) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[tag] || tag));

// Inisialisasi Aplikasi Saat Halaman Dimuat
document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupTimeRangeFilter();
  setupDrawer();
  setupShortcuts();

  // 1. Muat Konfigurasi Awal
  try {
    const cfg = await API.getConfig();
    State.config = { ...State.config, ...cfg };
  } catch (err) {
    console.warn('[App] Gagal memuat config, menggunakan default:', err);
  }

  // 2. Muat Data Awal dari Backend REST API
  await loadInitialData();

  // 3. Hubungkan Live Stream (SSE)
  connectRealtimeStream();

  // 4. Timer Periodik: Cek Kesegaran Data (Stale Check setiap 1 detik)
  setInterval(checkStaleData, 1000);

  // 5. Polling Historis & Metrik berkala (setiap 10 detik sebagai sinkronisasi cadangan)
  setInterval(refreshHistoricalData, 10000);
});

// Setup Navigasi Sidebar
function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  const viewContents = document.querySelectorAll('.view-content');
  const pageTitle = document.getElementById('pageTitle');
  const pageHeading = document.getElementById('pageHeading');

  const viewHeadings = {
    overview: { title: 'Overview', heading: 'Kondisi Greenhouse & Operasi' },
    analytics: { title: 'Sensor Analytics', heading: 'Analisis Historis & Agregasi Sensor' },
    health: { title: 'System Health', heading: 'Diagnostik & Evaluasi Performa CPS' },
    alerts: { title: 'Alerts & Logs', heading: 'Riwayat Peringatan & Log Transisi Sistem' }
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (!targetView) return;

      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      viewContents.forEach(view => {
        view.classList.toggle('active', view.id === `view-${targetView}`);
      });

      State.currentView = targetView;

      if (viewHeadings[targetView]) {
        pageTitle.textContent = viewHeadings[targetView].title;
        pageHeading.textContent = viewHeadings[targetView].heading;
      }

      // Render ulang chart jika masuk tab analytics
      if (targetView === 'analytics' || targetView === 'overview') {
        renderCharts();
      }
    });
  });

  // Tombol Lihat Semua Alerts di card overview
  const btnViewAll = document.getElementById('btnViewAllAlerts');
  if (btnViewAll) {
    btnViewAll.addEventListener('click', () => {
      const alertsNavBtn = document.getElementById('nav-alerts');
      if (alertsNavBtn) alertsNavBtn.click();
    });
  }
}

// Setup Filter Rentang Waktu (1h, 6h, 24h, 7d)
function setupTimeRangeFilter() {
  const timeBtns = document.querySelectorAll('.time-btn');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      timeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.currentRange = btn.dataset.range;
      await refreshHistoricalData();
    });
  });

  // Tombol Refresh manual
  const btnRefresh = document.getElementById('btnRefresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      btnRefresh.style.transform = 'rotate(180deg)';
      setTimeout(() => { btnRefresh.style.transform = 'none'; }, 300);
      await loadInitialData();
    });
  }

  // Tombol Ekspor CSV
  const btnExport = document.getElementById('btnExportCSV');
  if (btnExport) {
    btnExport.addEventListener('click', exportToCSV);
  }
}

// Setup Slide-out Right Drawer
function setupDrawer() {
  const drawer = document.getElementById('rightDrawer');
  const btnToggle = document.getElementById('btnToggleDrawer');
  const btnClose = document.getElementById('btnCloseDrawer');

  if (btnToggle && drawer) {
    btnToggle.addEventListener('click', () => {
      drawer.classList.toggle('open');
      const badgeDot = document.getElementById('drawerBadge');
      if (badgeDot) badgeDot.classList.remove('show');
    });
  }

  if (btnClose && drawer) {
    btnClose.addEventListener('click', () => {
      drawer.classList.remove('open');
    });
  }

  // Tab di dalam drawer
  const drawerTabs = document.querySelectorAll('.drawer-tab');
  const drawerContents = document.querySelectorAll('.drawer-tab-content');

  drawerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      drawerTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetTab = tab.dataset.tab;
      drawerContents.forEach(c => {
        c.classList.toggle('active', c.id === `tab-${targetTab}`);
      });
    });
  });
}

// Shortcut Keyboard (Ctrl+K untuk fokus pencarian)
function setupShortcuts() {
  const searchInput = document.getElementById('quickSearch');
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (searchInput) searchInput.focus();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      filterLogsAndAlerts(query);
    });
  }
}

function filterLogsAndAlerts(query) {
  if (!query) {
    renderAlertsTable();
    return;
  }
  const filtered = State.alerts.filter(a =>
    a.code.toLowerCase().includes(query) ||
    a.message.toLowerCase().includes(query) ||
    a.level.toLowerCase().includes(query)
  );
  renderAlertsTable(filtered);
}

// ==========================================================================
// PENGAMBILAN DATA
// ==========================================================================

async function loadInitialData() {
  try {
    const [latest, readings, alerts, events] = await Promise.all([
      API.getLatest(),
      API.getReadings(State.currentRange),
      API.getAlerts(50),
      API.getEvents(50)
    ]);

    if (latest) {
      State.sensor = latest.sensor;
      State.actuator = latest.actuator;
      State.system = latest.system;
      State.stats = latest.stats;
      if (latest.sensor && latest.sensor.rx) {
        State.lastRxTime = latest.sensor.rx;
      }
    }

    State.readings = readings || [];
    State.alerts = alerts || [];
    State.events = events || [];

    updateUI();
  } catch (err) {
    console.error('[App] Gagal memuat data awal:', err);
  }
}

async function refreshHistoricalData() {
  try {
    const readings = await API.getReadings(State.currentRange);
    State.readings = readings || [];
    renderCharts();
    renderAnalyticsTable();
  } catch (err) {
    console.warn('[App] Gagal memperbarui data historis:', err);
  }
}

// Hubungkan Server-Sent Events (SSE)
function connectRealtimeStream() {
  API.initStream({
    onConnectionChange: (status) => {
      State.streamStatus = status;
      updateSyncStatusUI();
      evaluateBanner();
    },
    onSnapshot: (snapshot) => {
      State.sensor = snapshot.sensor;
      State.actuator = snapshot.actuator;
      State.system = snapshot.system;
      State.stats = snapshot.stats;
      if (snapshot.sensor?.rx) State.lastRxTime = snapshot.sensor.rx;
      updateUI();
    },
    onSensor: (sensorData) => {
      State.sensor = sensorData;
      State.lastRxTime = sensorData.rx || Date.now();

      // Tambahkan ke array historis lokal agar grafik terupdate mulus real-time
      State.readings.push({
        rx: State.lastRxTime,
        ts: sensorData.ts,
        temp: sensorData.temp,
        hum: sensorData.hum,
        soil: sensorData.soil,
        seq: sensorData.seq
      });
      if (State.readings.length > 500) State.readings.shift();

      updateSensorCards();
      renderCharts();
      evaluateBanner();
    },
    onActuator: (actuatorData) => {
      State.actuator = actuatorData;
      updateActuatorUI();
      evaluateBanner();
    },
    onSystem: (systemData) => {
      State.system = systemData;
      updateSystemUI();
      evaluateBanner();
    },
    onAlert: (alertData) => {
      State.alerts.unshift(alertData);
      if (State.alerts.length > 50) State.alerts.pop();
      renderAlertsTable();
      addDrawerAlert(alertData);

      // Munculkan badge merah notifikasi
      const badgeDot = document.getElementById('drawerBadge');
      if (badgeDot) badgeDot.classList.add('show');
    },
    onStats: (statsData) => {
      State.stats = statsData;
      updateHealthUI();
    },
    onEvent: (eventData) => {
      State.events.unshift(eventData);
      if (State.events.length > 50) State.events.pop();
      renderEventsTable();
      addDrawerEvent(eventData);
    }
  });
}

// ==========================================================================
// UPDATE ELEMEN UI
// ==========================================================================

function updateUI() {
  updateSyncStatusUI();
  updateSensorCards();
  updateActuatorUI();
  updateSystemUI();
  updateHealthUI();
  renderCharts();
  renderAlertsTable();
  renderEventsTable();
  renderAnalyticsTable();
  evaluateBanner();
}

function updateSyncStatusUI() {
  const syncText = document.getElementById('syncText');
  const syncDot = document.querySelector('.sync-dot');

  if (!syncText || !syncDot) return;

  if (State.streamStatus === 'connected') {
    syncText.textContent = 'Live Stream (SSE)';
    syncDot.className = 'sync-dot live';
  } else if (State.streamStatus === 'connecting') {
    syncText.textContent = 'Menghubungkan...';
    syncDot.className = 'sync-dot stale';
  } else {
    syncText.textContent = 'Terputus';
    syncDot.className = 'sync-dot stale';
  }
}

// Update Kartu Sensor
function updateSensorCards() {
  const s = State.sensor;
  const sys = State.system;
  const cfg = State.config;

  const isSensorFault = sys && sys.sensor_fault;
  const isStale = (Date.now() - State.lastRxTime) > State.staleMs;

  const cardTemp = document.getElementById('card-temp');
  const cardHum = document.getElementById('card-hum');
  const cardSoil = document.getElementById('card-soil');

  // Toggle class stale
  [cardTemp, cardHum, cardSoil].forEach(card => {
    if (card) card.classList.toggle('stale', isStale);
  });

  // 1. Suhu Udara
  const valTemp = document.getElementById('val-temp');
  const badgeTemp = document.getElementById('badge-temp');
  const updateTemp = document.getElementById('update-temp');

  if (isSensorFault || !s || s.temp === null) {
    valTemp.textContent = '--';
    badgeTemp.className = 'card-badge fault';
    badgeTemp.textContent = isSensorFault ? 'Sensor Fault' : 'Tidak Tersedia';
  } else {
    valTemp.textContent = s.temp.toFixed(1);
    if (s.temp > cfg.fanOn) {
      badgeTemp.className = 'card-badge crit';
      badgeTemp.textContent = 'Kritis (Tinggi)';
    } else if (s.temp > cfg.fanOff) {
      badgeTemp.className = 'card-badge warn';
      badgeTemp.textContent = 'Waspada';
    } else {
      badgeTemp.className = 'card-badge';
      badgeTemp.textContent = 'Normal';
    }
  }
  if (updateTemp) updateTemp.textContent = s ? `Update: ${formatTime(s.rx)}` : 'Update: --';

  // 2. Kelembapan Udara
  const valHum = document.getElementById('val-hum');
  const badgeHum = document.getElementById('badge-hum');

  if (isSensorFault || !s || s.hum === null) {
    valHum.textContent = '--';
    badgeHum.className = 'card-badge fault';
    badgeHum.textContent = isSensorFault ? 'Sensor Fault' : 'Tidak Tersedia';
  } else {
    valHum.textContent = s.hum.toFixed(1);
    if (s.hum < 40 || s.hum > 80) {
      badgeHum.className = 'card-badge warn';
      badgeHum.textContent = 'Di Luar Optimal';
    } else {
      badgeHum.className = 'card-badge';
      badgeHum.textContent = 'Normal';
    }
  }

  // 3. Kelembapan Tanah (Soil Moisture tidak terpengaruh DHT22 fault)
  const valSoil = document.getElementById('val-soil');
  const badgeSoil = document.getElementById('badge-soil');

  if (!s || s.soil === null || s.soil === undefined) {
    valSoil.textContent = '--';
    badgeSoil.className = 'card-badge';
    badgeSoil.textContent = '--';
  } else {
    valSoil.textContent = s.soil;
    if (s.soil < cfg.pumpOn) {
      badgeSoil.className = 'card-badge crit';
      badgeSoil.textContent = 'Kritis (Kering)';
    } else if (s.soil < cfg.pumpOff) {
      badgeSoil.className = 'card-badge warn';
      badgeSoil.textContent = 'Waspada';
    } else {
      badgeSoil.className = 'card-badge';
      badgeSoil.textContent = 'Optimal';
    }
  }

  // 4. Card Mode Operasi & Sequence
  const valMode = document.getElementById('val-mode');
  const badgeMode = document.getElementById('badge-mode');
  const estopIndicator = document.getElementById('estopIndicator');
  const updateSeq = document.getElementById('update-seq');

  const act = State.actuator;
  if (act) {
    valMode.textContent = act.mode.toUpperCase();
    badgeMode.textContent = act.mode.toUpperCase();

    if (act.mode === 'emergency' || act.estop) {
      valMode.style.color = '#dc2626';
      badgeMode.className = 'card-badge crit';
      estopIndicator.className = 'estop-indicator active';
      estopIndicator.textContent = '⛔ E-Stop: AKTIF';
    } else if (act.mode === 'offline') {
      valMode.style.color = '#d97706';
      badgeMode.className = 'card-badge warn';
      estopIndicator.className = 'estop-indicator';
      estopIndicator.textContent = 'E-Stop: Tidak Aktif';
    } else {
      valMode.style.color = 'var(--text-main)';
      badgeMode.className = 'card-badge';
      estopIndicator.className = 'estop-indicator';
      estopIndicator.textContent = 'E-Stop: Tidak Aktif';
    }
  }

  if (s && updateSeq) {
    updateSeq.textContent = `Sequence: #${s.seq || 0}`;
  }
}

// Update Status Aktuator
function updateActuatorUI() {
  const act = State.actuator;
  const sys = State.system;

  const fanPill = document.getElementById('fanStatusPill');
  const fanIconWrap = document.getElementById('fanIconWrap');
  const pumpPill = document.getElementById('pumpStatusPill');
  const pumpIconWrap = document.getElementById('pumpIconWrap');

  const safetyEstop = document.getElementById('safetyEstop');
  const safetySensor = document.getElementById('safetySensor');
  const safetyBadge = document.getElementById('safetyBadge');

  if (!act) return;

  // Status Kipas
  if (act.fan) {
    fanPill.className = 'act-pill on';
    fanPill.textContent = 'ON';
    if (fanIconWrap) fanIconWrap.classList.add('active');
  } else {
    fanPill.className = 'act-pill';
    fanPill.textContent = 'OFF';
    if (fanIconWrap) fanIconWrap.classList.remove('active');
  }

  // Status Pompa
  if (act.pump) {
    pumpPill.className = 'act-pill on';
    pumpPill.textContent = 'ON';
    if (pumpIconWrap) pumpIconWrap.classList.add('active');
  } else {
    pumpPill.className = 'act-pill';
    pumpPill.textContent = 'OFF';
    if (pumpIconWrap) pumpIconWrap.classList.remove('active');
  }

  // Safety Interlocks
  const isEstop = act.estop || act.mode === 'emergency';
  const isFault = sys && sys.sensor_fault;

  if (safetyEstop) {
    safetyEstop.textContent = isEstop ? 'AKTIF (Terputus)' : 'Nonaktif';
    safetyEstop.style.color = isEstop ? '#dc2626' : 'var(--text-main)';
  }

  if (safetySensor) {
    safetySensor.textContent = isFault ? 'Fault (Terputus)' : 'Normal';
    safetySensor.style.color = isFault ? '#ea580c' : 'var(--text-main)';
  }

  if (safetyBadge) {
    if (isEstop || isFault) {
      safetyBadge.className = 'interlock-badge warn';
      safetyBadge.textContent = 'Interlock Aktif';
      safetyBadge.style.background = 'rgba(239, 68, 68, 0.2)';
      safetyBadge.style.color = '#ef4444';
    } else {
      safetyBadge.className = 'interlock-badge';
      safetyBadge.textContent = 'Normal';
      safetyBadge.style.background = 'rgba(34, 197, 94, 0.15)';
      safetyBadge.style.color = '#22c55e';
    }
  }
}

// Update Status Sistem & Koneksi
function updateSystemUI() {
  const sys = State.system;
  const dot = document.getElementById('deviceDot');
  const statusText = document.getElementById('deviceStatusText');

  if (!dot || !statusText) return;

  if (sys && sys.state === 'online') {
    dot.className = 'status-dot online';
    statusText.textContent = 'ESP32 Online';
  } else if (sys && sys.state === 'offline') {
    dot.className = 'status-dot offline';
    statusText.textContent = 'ESP32 Offline (LWT)';
  } else {
    dot.className = 'status-dot';
    statusText.textContent = 'Menghubungkan...';
  }
}

// Update Metrik Kesehatan & Evaluasi Komunikasi CPS
function updateHealthUI() {
  const stats = State.stats;
  if (!stats) return;

  // Quick summary cards di bawah halaman overview
  const quickRx = document.getElementById('quickRx');
  const quickLoss = document.getElementById('quickLoss');
  const quickLossCount = document.getElementById('quickLossCount');
  const quickLat = document.getElementById('quickLat');
  const quickRestarts = document.getElementById('quickRestarts');

  if (quickRx) quickRx.textContent = stats.received;
  if (quickLoss) quickLoss.textContent = `${stats.lossPct}%`;
  if (quickLossCount) quickLossCount.textContent = `(${stats.lost} hilang)`;
  if (quickLat) quickLat.textContent = stats.latAvgMs !== null ? `${stats.latAvgMs} ms` : '-- ms';
  if (quickRestarts) quickRestarts.textContent = `${stats.restarts} kali`;

  // Halaman System Health lengkap
  const healthRx = document.getElementById('healthRx');
  const healthLossPct = document.getElementById('healthLossPct');
  const healthLossCount = document.getElementById('healthLossCount');
  const healthRestarts = document.getElementById('healthRestarts');
  const healthRejected = document.getElementById('healthRejected');
  const healthLatAvg = document.getElementById('healthLatAvg');
  const healthLatMax = document.getElementById('healthLatMax');

  if (healthRx) healthRx.textContent = stats.received;
  if (healthLossPct) healthLossPct.textContent = `${stats.lossPct}%`;
  if (healthLossCount) healthLossCount.textContent = `${stats.lost} nomor urut terlewat`;
  if (healthRestarts) healthRestarts.textContent = stats.restarts;
  if (healthRejected) healthRejected.textContent = stats.rejected;
  if (healthLatAvg) healthLatAvg.textContent = stats.latAvgMs !== null ? `${stats.latAvgMs} ms` : '-- ms';
  if (healthLatMax) healthLatMax.textContent = stats.latMaxMs !== null ? `${stats.latMaxMs} ms` : '-- ms';
}

// ==========================================================================
// EVALUASI PRIORITAS BANNER SISTEM (CPS SAFETY)
// ==========================================================================

function evaluateBanner() {
  const banner = document.getElementById('systemBanner');
  const bannerTitle = document.getElementById('bannerTitle');
  const bannerDesc = document.getElementById('bannerDesc');
  const bannerTime = document.getElementById('bannerTime');

  if (!banner) return;

  const act = State.actuator;
  const sys = State.system;
  const ageMs = Date.now() - State.lastRxTime;
  const isStale = State.lastRxTime > 0 && ageMs > State.staleMs;
  const isDisconnected = State.streamStatus === 'disconnected';
  const isEstop = act && (act.estop || act.mode === 'emergency');
  const isFault = sys && sys.sensor_fault;
  const isEspOffline = sys && sys.state === 'offline';

  banner.classList.remove('hidden', 'crit', 'warn', 'fault', 'ok');

  // Prioritas 1: Koneksi Backend / SSE Terputus
  if (isDisconnected) {
    banner.classList.add('crit');
    bannerTitle.textContent = '⛔ KONEKSI SERVER TERPUTUS';
    bannerDesc.textContent = 'Dashboard tidak dapat menjangkau backend. Data di layar bukan telemetri real-time.';
    bannerTime.textContent = '';
    return;
  }

  // Prioritas 2: Emergency Stop Aktif
  if (isEstop) {
    banner.classList.add('crit');
    bannerTitle.textContent = '⛔ EMERGENCY STOP DIAKTIFKAN';
    bannerDesc.textContent = 'Daya relay aktuator diputus secara mekanis. Kipas dan pompa dinonaktifkan.';
    bannerTime.textContent = act.ts ? formatTime(act.ts * 1000) : '';
    return;
  }

  // Prioritas 3: Kerusakan Sensor (Sensor Fault)
  if (isFault) {
    banner.classList.add('fault');
    bannerTitle.textContent = '⚠ SENSOR FAULT TERDETEKSI';
    bannerDesc.textContent = 'Pembacaan DHT22 gagal atau kabel sensor terputus. Aktuator diputus otomatis demi keselamatan.';
    bannerTime.textContent = '';
    return;
  }

  // Prioritas 4: ESP32 Terputus dari Broker (Last Will)
  if (isEspOffline) {
    banner.classList.add('warn');
    bannerTitle.textContent = '📡 ESP32 OFFLINE (LAST WILL)';
    bannerDesc.textContent = 'Koneksi MQTT perangkat terputus mendadak. Mikrokontroler beroperasi dalam mode fail-safe mandiri.';
    bannerTime.textContent = '';
    return;
  }

  // Prioritas 5: Data Sensor Basi (Stale > 7 detik)
  if (isStale) {
    banner.classList.add('warn');
    bannerTitle.textContent = '⏱ DATA SENSOR BASI (STALE)';
    bannerDesc.textContent = `Tidak ada transmisi pesan sensor baru selama ${Math.round(ageMs / 1000)} detik terakhir.`;
    bannerTime.textContent = formatTime(State.lastRxTime);
    return;
  }

  // Prioritas 6: Kondisi Normal
  banner.classList.add('ok');
  bannerTitle.textContent = '✔ SISTEM BEROPERASI NORMAL';
  bannerDesc.textContent = 'Loop kontrol tertutup (closed-loop) berjalan dengan baik. Komunikasi broker stabil.';
  bannerTime.textContent = State.lastRxTime ? `Update: ${formatTime(State.lastRxTime)}` : '';
}

function checkStaleData() {
  evaluateBanner();
  updateSensorCards();
}

// ==========================================================================
// RENDER GRAFIK & TABEL
// ==========================================================================

function renderCharts() {
  if (State.currentView === 'overview') {
    Charts.renderDualChart('chart-overview-container', State.readings, {
      fanOn: State.config.fanOn,
      fanOff: State.config.fanOff,
      pumpOn: State.config.pumpOn,
      pumpOff: State.config.pumpOff
    });
  } else if (State.currentView === 'analytics') {
    Charts.renderBarChart('chart-bar-analytics-container', State.readings);
    Charts.renderDualChart('chart-analytics-container', State.readings, {
      fanOn: State.config.fanOn,
      fanOff: State.config.fanOff,
      pumpOn: State.config.pumpOn,
      pumpOff: State.config.pumpOff
    });
  }
}

function renderAlertsTable(list = State.alerts) {
  // Update tabel ringkas overview
  const quickBody = document.getElementById('quickAlertsBody');
  if (quickBody) {
    if (list.length === 0) {
      quickBody.innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada peringatan sistem.</td></tr>';
    } else {
      quickBody.innerHTML = list.slice(0, 5).map(a => `
        <tr>
          <td><span class="level-tag ${escapeHtml(a.level)}">${escapeHtml(a.level.toUpperCase())}</span></td>
          <td>${formatTime(a.rx)}</td>
          <td><strong>${escapeHtml(a.code)}</strong></td>
          <td>${escapeHtml(a.message)}</td>
        </tr>
      `).join('');
    }
  }

  // Update tabel lengkap di view-alerts
  const fullBody = document.getElementById('fullAlertsBody');
  if (fullBody) {
    if (list.length === 0) {
      fullBody.innerHTML = '<tr><td colspan="5" class="empty-state">Belum ada peringatan sistem.</td></tr>';
    } else {
      fullBody.innerHTML = list.map(a => `
        <tr>
          <td>${formatDateTime(a.rx)}</td>
          <td>${a.ts ? formatDateTime(a.ts * 1000) : '--'}</td>
          <td><span class="level-tag ${escapeHtml(a.level)}">${escapeHtml(a.level.toUpperCase())}</span></td>
          <td><code>${escapeHtml(a.code)}</code></td>
          <td>${escapeHtml(a.message)}</td>
        </tr>
      `).join('');
    }
  }

  // Update counter di sidebar
  const navCount = document.getElementById('navAlertCount');
  if (navCount) navCount.textContent = list.length;
}

function renderEventsTable() {
  const fullBody = document.getElementById('fullEventsTable');
  if (!fullBody) return;

  const tbody = fullBody.querySelector('tbody') || fullBody;
  if (State.events.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Belum ada event sistem.</td></tr>';
  } else {
    tbody.innerHTML = State.events.map(e => `
      <tr>
        <td>${formatDateTime(e.rx)}</td>
        <td><span class="level-tag info">${escapeHtml(e.kind.toUpperCase())}</span></td>
        <td><code>${escapeHtml(typeof e.data === 'object' ? JSON.stringify(e.data) : e.data)}</code></td>
      </tr>
    `).join('');
  }
}

function renderAnalyticsTable() {
  // Hitung Agregasi (Min, Max, Avg)
  const r = State.readings;
  const countEl = document.getElementById('statCount');
  const statTemp = document.getElementById('statTemp');
  const statHum = document.getElementById('statHum');
  const statSoil = document.getElementById('statSoil');

  if (countEl) countEl.textContent = `${r.length} Sampel Data`;

  const validTemps = r.map(x => x.temp).filter(v => v !== null && v !== undefined);
  const validHums = r.map(x => x.hum).filter(v => v !== null && v !== undefined);
  const validSoils = r.map(x => x.soil).filter(v => v !== null && v !== undefined);

  if (validTemps.length > 0) {
    const min = Math.min(...validTemps).toFixed(1);
    const max = Math.max(...validTemps).toFixed(1);
    const avg = (validTemps.reduce((a, b) => a + b, 0) / validTemps.length).toFixed(1);
    if (statTemp) statTemp.textContent = `${min} / ${avg} / ${max} °C`;
  }

  if (validHums.length > 0) {
    const min = Math.min(...validHums).toFixed(1);
    const max = Math.max(...validHums).toFixed(1);
    const avg = (validHums.reduce((a, b) => a + b, 0) / validHums.length).toFixed(1);
    if (statHum) statHum.textContent = `${min} / ${avg} / ${max} %`;
  }

  if (validSoils.length > 0) {
    const min = Math.min(...validSoils);
    const max = Math.max(...validSoils);
    const avg = Math.round(validSoils.reduce((a, b) => a + b, 0) / validSoils.length);
    if (statSoil) statSoil.textContent = `${min} / ${avg} / ${max} %`;
  }

  // Render Tabel Log
  const tbody = document.getElementById('readingsTableBody');
  if (tbody) {
    if (r.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Belum ada data pada rentang ini.</td></tr>';
    } else {
      tbody.innerHTML = r.slice(-50).reverse().map(row => `
        <tr>
          <td>${formatDateTime(row.rx)}</td>
          <td>${row.ts ? formatTime(row.ts * 1000) : '--'}</td>
          <td><strong>${row.temp !== null ? row.temp.toFixed(1) : '<span style="color:#f97316">Fault (null)</span>'}</strong></td>
          <td>${row.hum !== null ? row.hum.toFixed(1) : '--'}</td>
          <td>${row.soil !== null ? row.soil : '--'}</td>
          <td>#${row.seq || 0}</td>
        </tr>
      `).join('');
    }
  }
}

// Drawer Activity Feed
function addDrawerAlert(a) {
  const list = document.getElementById('drawerAlertsList');
  if (!list) return;

  const empty = list.querySelector('.feed-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = `feed-item ${a.level === 'critical' ? 'crit' : 'warn'}`;
  item.innerHTML = `
    <span class="feed-time">${formatTime(a.rx)}</span>
    <span class="feed-title">${escapeHtml(a.code)}</span>
    <span class="feed-msg">${escapeHtml(a.message)}</span>
  `;
  list.prepend(item);
  if (list.children.length > 30) list.lastElementChild.remove();
}

function addDrawerEvent(e) {
  const list = document.getElementById('drawerEventsList');
  if (!list) return;

  const empty = list.querySelector('.feed-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'feed-item info';
  item.innerHTML = `
    <span class="feed-time">${formatTime(e.rx)}</span>
    <span class="feed-title">${escapeHtml(e.kind.toUpperCase())}</span>
    <span class="feed-msg">${escapeHtml(typeof e.data === 'object' ? JSON.stringify(e.data) : e.data)}</span>
  `;
  list.prepend(item);
  if (list.children.length > 30) list.lastElementChild.remove();
}

// Ekspor Data ke Format CSV
function exportToCSV() {
  if (!State.readings || State.readings.length === 0) {
    alert('Tidak ada data historis untuk diekspor.');
    return;
  }

  const headers = ['Waktu_Server', 'Timestamp_Sensor', 'Suhu_C', 'Kelembapan_Udara_Persen', 'Kelembapan_Tanah_Persen', 'Sequence_Number'];
  const rows = State.readings.map(d => [
    new Date(d.rx).toISOString(),
    d.ts || '',
    d.temp !== null ? d.temp : '',
    d.hum !== null ? d.hum : '',
    d.soil !== null ? d.soil : '',
    d.seq || 0
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' +
    [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `greenhouse_readings_${State.currentRange}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
