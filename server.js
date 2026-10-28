// server.js - Backend Smart Greenhouse CPS V2
// Subscribe MQTT -> Validasi payload (SPEC.md) -> Simpan SQLite -> REST API & SSE Real-time -> Sajikan Dashboard

import express from 'express';
import mqtt from 'mqtt';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Konfigurasi dari Environment Variables (.env) ----
const {
  PORT = 3000,
  MQTT_URL = 'mqtt://localhost:1883',
  MQTT_USER = '',
  MQTT_PASS = '',
  MQTT_WS_URL = '',
  DB_FILE = 'greenhouse.db',
  FAN_ON = 35,
  FAN_OFF = 28,
  PUMP_ON = 30,
  PUMP_OFF = 60
} = process.env;

// ---- Inisialisasi Database SQLite dengan mode WAL ----
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    rx INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    temp REAL,
    hum REAL,
    soil INTEGER NOT NULL,
    seq INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_readings_rx ON readings(rx);

  CREATE TABLE IF NOT EXISTS alerts (
    rx INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    code TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_alerts_rx ON alerts(rx);

  CREATE TABLE IF NOT EXISTS events (
    rx INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_events_rx ON events(rx);
`);

const insReading = db.prepare('INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?)');
const insAlert = db.prepare('INSERT INTO alerts VALUES (?, ?, ?, ?, ?)');
const insEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?)');

// ---- Validator Payload MQTT sesuai SPEC.md ----
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNumOrNull = (v, min, max) => v === null || (typeof v === 'number' && v >= min && v <= max);

const validator = {
  'greenhouse/sensor/data': (p) => {
    if (!isNumOrNull(p.temp, -40, 80)) return 'temp di luar rentang valid (-40..80) atau bukan number/null';
    if (!isNumOrNull(p.hum, 0, 100)) return 'hum di luar rentang valid (0..100) atau bukan number/null';
    if (!isInt(p.soil, 0, 100)) return 'soil bukan integer rentang 0-100';
    if (!isInt(p.seq, 0, 4294967295)) return 'seq bukan integer positif (0-4294967295)';
    if (!isInt(p.ts, 0, 4e9)) return 'ts bukan timestamp valid';
    return null;
  },
  'greenhouse/actuator/status': (p) => {
    if (typeof p.fan !== 'boolean') return 'fan harus bernilai boolean';
    if (typeof p.pump !== 'boolean') return 'pump harus bernilai boolean';
    if (typeof p.estop !== 'boolean') return 'estop harus bernilai boolean';
    if (!['auto', 'offline', 'emergency'].includes(p.mode)) return 'mode tidak dikenal (harus auto, offline, atau emergency)';
    if (!isInt(p.ts, 0, 4e9)) return 'ts bukan timestamp valid';
    return null;
  },
  'greenhouse/system/status': (p) => {
    if (!['online', 'offline'].includes(p.state)) return 'state harus online atau offline';
    if (typeof p.sensor_fault !== 'boolean') return 'sensor_fault harus boolean';
    return null;
  },
  'greenhouse/alert': (p) => {
    if (!['warning', 'critical'].includes(p.level)) return 'level harus warning atau critical';
    if (typeof p.code !== 'string' || !p.code.trim()) return 'code harus berupa string valid';
    if (typeof p.message !== 'string') return 'message harus string';
    if (!isInt(p.ts, 0, 4e9)) return 'ts bukan timestamp valid';
    return null;
  }
};

// ---- State Memory & Kalkulasi Metrik Komunikasi CPS ----
const currentState = {
  sensor: null,
  actuator: null,
  system: null
};

const metrics = {
  received: 0,
  lost: 0,
  lastSeq: null,
  restarts: 0,
  rejected: 0,
  latencies: []
};

// Koleksi klien Server-Sent Events (SSE) aktif
const sseClients = new Set();

function broadcastSSE(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Logika pemrosesan data sensor & kalkulasi packet loss / latensi
function handleSensorData(payload, rxTime) {
  // Aturan validitas timestamp NTP: ts > 0 dan selisih <= 60 detik dari server
  const isTsTrusted = payload.ts > 0 && Math.abs(payload.ts - rxTime / 1000) <= 60;

  // Deteksi reset sequence saat boot ulang ESP32 vs celah packet loss
  if (metrics.lastSeq !== null && payload.seq <= metrics.lastSeq) {
    if (payload.seq < metrics.lastSeq && payload.seq <= 10) {
      // Seq turun ke awal menandakan ESP32 reboot
      metrics.restarts++;
      metrics.received = 0;
      metrics.lost = 0;
      insEvent.run(rxTime, 'restart', JSON.stringify({ from: metrics.lastSeq, to: payload.seq }));
      broadcastSSE('event', { rx: rxTime, kind: 'restart', data: { from: metrics.lastSeq, to: payload.seq } });
    } else {
      // Duplikat atau paket terlambat (out-of-order QoS 1)
      return;
    }
  } else if (metrics.lastSeq !== null) {
    // Selisih seq > 1 berarti ada paket yang hilang
    metrics.lost += (payload.seq - metrics.lastSeq - 1);
  }

  metrics.lastSeq = payload.seq;
  metrics.received++;

  // Simpan sampel latensi jika NTP terpercaya
  if (isTsTrusted) {
    const latMs = Math.max(0, rxTime - (payload.ts * 1000));
    metrics.latencies.push(latMs);
    if (metrics.latencies.length > 500) metrics.latencies.shift();
  }

  // Simpan ke SQLite
  insReading.run(rxTime, payload.ts, payload.temp, payload.hum, payload.soil, payload.seq);

  // Update memori state & kirim ke SSE
  currentState.sensor = { ...payload, rx: rxTime, isTsTrusted };
  broadcastSSE('sensor', currentState.sensor);
  broadcastSSE('stats', getStats());
}

function getStats() {
  const total = metrics.received + metrics.lost;
  const l = metrics.latencies;
  return {
    received: metrics.received,
    lost: metrics.lost,
    lossPct: total > 0 ? Number(((metrics.lost / total) * 100).toFixed(2)) : 0,
    restarts: metrics.restarts,
    rejected: metrics.rejected,
    latAvgMs: l.length > 0 ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null,
    latMaxMs: l.length > 0 ? Math.max(...l) : null,
    note: 'ts beresolusi 1 detik, estimasi latensi memiliki ketelitian kasar ±1 detik'
  };
}

// ---- Koneksi Subscriber MQTT ----
const mqttOptions = {
  clientId: `greenhouse-sub-${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  reconnectPeriod: 2500
};
if (MQTT_USER) mqttOptions.username = MQTT_USER;
if (MQTT_PASS) mqttOptions.password = MQTT_PASS;

const mqttClient = mqtt.connect(MQTT_URL, mqttOptions);

mqttClient.on('connect', () => {
  console.log(`[MQTT] Terhubung ke broker: ${MQTT_URL}`);
  mqttClient.subscribe('greenhouse/#', { qos: 1 }, (err) => {
    if (err) console.error('[MQTT] Gagal subscribe greenhouse/#:', err.message);
    else console.log('[MQTT] Berhasil subscribe topic: greenhouse/# (QoS 1)');
  });
});

mqttClient.on('close', () => {
  console.warn('[MQTT] Koneksi broker terputus, mencoba menyambung ulang...');
});

mqttClient.on('error', (err) => {
  console.error('[MQTT] Error:', err.message);
});

// Listener pesan MQTT masuk
mqttClient.on('message', (topic, buffer) => {
  const rxTime = Date.now();
  let payload;
  try {
    payload = JSON.parse(buffer.toString());
  } catch {
    metrics.rejected++;
    console.warn(`[MQTT] Ditolak: Bukan format JSON valid pada topic ${topic}`);
    return;
  }

  const check = validator[topic];
  const validationError = !payload || typeof payload !== 'object'
    ? 'Payload bukan objek'
    : (check ? check(payload) : 'Topic tidak dikenal');

  if (validationError) {
    metrics.rejected++;
    console.warn(`[MQTT] Ditolak pada ${topic}: ${validationError}`);
    return;
  }

  // Routing pemrosesan berdasarkan topik
  if (topic === 'greenhouse/sensor/data') {
    handleSensorData(payload, rxTime);
  } else if (topic === 'greenhouse/actuator/status') {
    currentState.actuator = { ...payload, rx: rxTime };
    insEvent.run(rxTime, 'actuator', JSON.stringify(payload));
    broadcastSSE('actuator', currentState.actuator);
    broadcastSSE('event', { rx: rxTime, kind: 'actuator', data: payload });
  } else if (topic === 'greenhouse/system/status') {
    currentState.system = { ...payload, rx: rxTime };
    insEvent.run(rxTime, 'system', JSON.stringify(payload));
    broadcastSSE('system', currentState.system);
    broadcastSSE('event', { rx: rxTime, kind: 'system', data: payload });
  } else if (topic === 'greenhouse/alert') {
    insAlert.run(rxTime, payload.ts, payload.level, payload.code, payload.message);
    const alertData = { rx: rxTime, ...payload };
    broadcastSSE('alert', alertData);
  }
});

// ---- Express Application ----
const app = express();

// Sajikan folder public untuk frontend statis
app.use(express.static(path.join(__dirname, 'public')));

// Middleware parsing JSON
app.use(express.json());

// 1. Endpoint status terkini
app.get('/api/latest', (req, res) => {
  res.json({
    sensor: currentState.sensor,
    actuator: currentState.actuator,
    system: currentState.system,
    stats: getStats()
  });
});

// 2. Endpoint riwayat sensor dengan rentang waktu & downsampling pintar
const TIME_RANGES = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

app.get('/api/readings', (req, res) => {
  const rangeParam = req.query.range || '1h';
  const duration = TIME_RANGES[rangeParam] || TIME_RANGES['1h'];
  const since = Date.now() - duration;

  let rows = db.prepare('SELECT rx, ts, temp, hum, soil, seq FROM readings WHERE rx > ? ORDER BY rx ASC').all(since);

  // Downsampling maksimal ~500 titik agar transfer data ringan & visual grafik tetap mulus
  const maxPoints = 500;
  if (rows.length > maxPoints) {
    const step = Math.ceil(rows.length / maxPoints);
    rows = rows.filter((_, idx) => idx % step === 0);
  }

  res.json(rows);
});

// 3. Endpoint riwayat alerts
app.get('/api/alerts', (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
  const rows = db.prepare('SELECT rx, ts, level, code, message FROM alerts ORDER BY rx DESC LIMIT ?').all(limit);
  res.json(rows);
});

// 4. Endpoint riwayat event sistem
app.get('/api/events', (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
  const rows = db.prepare('SELECT rx, kind, data FROM events ORDER BY rx DESC LIMIT ?').all(limit);
  // Parse data JSON string jika memungkinkan
  const parsed = rows.map(r => {
    try {
      return { rx: r.rx, kind: r.kind, data: JSON.parse(r.data) };
    } catch {
      return r;
    }
  });
  res.json(parsed);
});

// 5. Endpoint konfigurasi client
app.get('/api/config', (req, res) => {
  res.json({
    wsUrl: MQTT_WS_URL,
    username: MQTT_USER,
    password: MQTT_PASS,
    fanOn: Number(FAN_ON),
    fanOff: Number(FAN_OFF),
    pumpOn: Number(PUMP_ON),
    pumpOff: Number(PUMP_OFF)
  });
});

// 6. Endpoint health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mqtt: mqttClient.connected,
    uptimeSeconds: Math.floor(process.uptime()),
    activeSseClients: sseClients.size
  });
});

// 7. Endpoint Server-Sent Events (SSE) untuk live streaming ke browser
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(': connected\n\n');

  // Kirim snapshot state awal saat klien baru terhubung
  res.write(`event: snapshot\ndata: ${JSON.stringify({
    sensor: currentState.sensor,
    actuator: currentState.actuator,
    system: currentState.system,
    stats: getStats()
  })}\n\n`);

  sseClients.add(res);

  // Heartbeat interval agar koneksi tetap hidup (15 detik)
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Jalankan Server
app.listen(PORT, () => {
  console.log(`[Dashboard V2] Server berjalan pada: http://localhost:${PORT}`);
  console.log(`[Dashboard V2] API Endpoint: http://localhost:${PORT}/api/latest`);
  console.log(`[Dashboard V2] SSE Stream: http://localhost:${PORT}/api/stream`);
});
