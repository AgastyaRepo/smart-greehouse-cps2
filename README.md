# Smart Greenhouse Dashboard V2 (CPS)

> **Monitoring & Evaluation Dashboard untuk Sistem Siber Fisis (CPS) Smart Greenhouse**  
> Didesain dengan estetika modern dark emerald/teal studio mengacu pada referensi visual, terintegrasi penuh dengan broker MQTT, backend Node.js + SQLite, REST API, dan streaming real-time Server-Sent Events (SSE).

---

## 🏛️ Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                   ESP32 / Simulator (Node.js)                │
│  - Sensor: DHT22 (temp, hum), Soil Moisture (soil)          │
│  - Aktuator: Dual Relay (Fan DC & Submersible Pump)         │
│  - Logika: Closed-Loop Histeresis & E-Stop Interlock        │
└──────────────────────────────┬──────────────────────────────┘
                               │ MQTT Publish (QoS 1)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Mosquitto MQTT Broker                       │
│  - Port 1883 (TCP MQTT) / Port 9001 (WebSocket)             │
│  - LWT: greenhouse/system/status -> {"state":"offline"}     │
└──────────────────────────────┬──────────────────────────────┘
                               │ MQTT Subscribe (QoS 1)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Backend Service (server.js)                 │
│  - Validasi ketat payload sesuai docs/SPEC.md               │
│  - Kalkulasi packet loss, restart counter, estimasi latensi │
│  - Database SQLite (WAL Mode)                               │
│  - Streaming Real-time SSE (/api/stream) + REST API         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / SSE
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           Frontend Dashboard (HTML5 + Vanilla CSS + JS)     │
│  - Halaman 1: Overview (Sensor cards, trends, actuators)    │
│  - Halaman 2: Sensor Analytics (Agregasi Min/Avg/Max, CSV)  │
│  - Halaman 3: System Health (Diagnostik evaluasi W13-W14)   │
│  - Halaman 4: Alerts & Logs (Audit trail & peringatan)      │
│  - Slide-out Right Drawer: Live activity feed               │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Struktur Folder `dashboardv2`

```
/dashboardv2
├── Brief/                  → Dokumen panduan & prompt fase
├── node_modules/           → Dependensi (express, mqtt, better-sqlite3)
├── public/                 → Antarmuka web frontend
│   ├── css/
│   │   └── style.css       → Sistem desain dark emerald studio & responsif
│   ├── js/
│   │   ├── api.js          → Lapisan komunikasi REST API & SSE
│   │   ├── charts.js       → Visualisasi grafik SVG interaktif & threshold
│   │   └── app.js          → State management, navigasi, dan logika UI
│   └── index.html          → Struktur dokumen HTML5 semantik
├── .env                    → Konfigurasi environment lokal (aktif)
├── .env.example            → Template environment variables
├── greenhouse.db           → Database SQLite lokal (dibuat otomatis)
├── package.json            → Metadata proyek dan skrip npm
├── server.js               → Server Express, MQTT Subscriber, dan REST/SSE API
├── simulator.js            → Simulator ESP32 dengan 10 skenario pengujian
└── README.md               → Dokumentasi ini
```

---

## 🚀 Cara Menjalankan

### 1. Prasyarat
- **Node.js**: Versi 18 atau lebih baru (direkomendasikan v20+).
- **MQTT Broker**: Broker Mosquitto lokal (port 1883) atau broker publik `broker.emqx.io`.

### 2. Menjalankan Dashboard Server
Buka terminal pada direktori `dashboardv2`:

```bash
cd C:\Users\fatho\Downloads\Semeseter5Manage\CPS\dashboardv2
npm start
```

Server akan aktif pada:
👉 **http://localhost:3000**

### 3. Menguji dengan Simulator ESP32
Buka terminal kedua pada direktori `dashboardv2`:

```bash
cd C:\Users\fatho\Downloads\Semeseter5Manage\CPS\dashboardv2

# Jalankan simulator skenario normal
npm run sim -- normal

# Atau pilih skenario pengujian spesifik lainnya:
npm run sim -- hot          # Menguji suhu > 35°C (kipas otomatis ON & alert TEMP_CRITICAL)
npm run sim -- dry          # Menguji tanah < 30% (pompa otomatis ON & alert SOIL_DRY)
npm run sim -- sensor-fault # Menguji sensor DHT22 rusak (nilai null & banner oranye)
npm run sim -- estop        # Menguji tombol darurat aktif (aktuator mati & banner merah)
npm run sim -- disconnect   # Menguji pemutusan koneksi mendadak (LWT state: offline)
npm run sim -- packet-loss  # Menguji lonjakan sequence number untuk evaluasi loss
npm run sim -- restart      # Menguji reset sequence saat mikrokontroler reboot
npm run sim -- no-ntp       # Menguji penanganan timestamp ts = 0
npm run sim -- hang         # Menguji deteksi data sensor basi (stale > 7 detik)
```

---

## 📡 Dokumentasi Endpoint Backend

| Method | Endpoint | Keterangan |
|---|---|---|
| `GET` | `/api/latest` | Snapshot telemetri terkini (`sensor`, `actuator`, `system`, `stats`) |
| `GET` | `/api/readings?range=1h\|6h\|24h\|7d` | Riwayat pembacaan sensor dengan downsampling (maks 500 titik) |
| `GET` | `/api/alerts?limit=50` | Riwayat log peringatan sistem |
| `GET` | `/api/events?limit=50` | Audit trail transisi status dan kejadian sistem |
| `GET` | `/api/config` | Ambang batas histeresis dan konfigurasi publik |
| `GET` | `/api/health` | Status uptime backend dan koneksi subscriber MQTT |
| `GET` | `/api/stream` | Stream real-time berbasis Server-Sent Events (SSE) |
