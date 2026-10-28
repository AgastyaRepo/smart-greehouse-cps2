// simulator.js - Simulator ESP32 Smart Greenhouse CPS
// Mensimulasikan pengiriman data sensor, aktuator, LWT, dan alert sesuai docs/SPEC.md
// Penggunaan: node --env-file=.env simulator.js <skenario>
// Skenario: normal | hot | dry | sensor-fault | estop | disconnect | packet-loss | restart | no-ntp | hang

import mqtt from 'mqtt';

const scenario = process.argv[2] || 'normal';

const {
  MQTT_URL = 'mqtt://localhost:1883',
  MQTT_USER = '',
  MQTT_PASS = '',
  PUBLISH_INTERVAL_MS = 2000,
  FAN_ON = 35,
  FAN_OFF = 28,
  PUMP_ON = 30,
  PUMP_OFF = 60
} = process.env;

const TOPICS = {
  sensor: 'greenhouse/sensor/data',
  actuator: 'greenhouse/actuator/status',
  system: 'greenhouse/system/status',
  alert: 'greenhouse/alert'
};

const fanThresholdOn = Number(FAN_ON);
const fanThresholdOff = Number(FAN_OFF);
const pumpThresholdOn = Number(PUMP_ON);
const pumpThresholdOff = Number(PUMP_OFF);

// Konfigurasi koneksi MQTT dengan Last Will and Testament (LWT)
const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USER || undefined,
  password: MQTT_PASS || undefined,
  clientId: `simulator-esp32-${Math.random().toString(16).substring(2, 6)}`,
  will: {
    topic: TOPICS.system,
    payload: JSON.stringify({ state: 'offline', sensor_fault: false }),
    qos: 1,
    retain: true
  }
});

const pub = (topic, payloadObj, retain = false) => {
  const jsonStr = JSON.stringify(payloadObj);
  client.publish(topic, jsonStr, { qos: 1, retain });
  console.log(`[PUB] ${topic.padEnd(28)} -> ${jsonStr}`);
};

const nowEpochSeconds = () => Math.floor(Date.now() / 1000);

// Variabel status awal dinamika fisik greenhouse
let temp = scenario === 'hot' ? 33.0 : 27.5;
let soil = scenario === 'dry' ? 32 : 55;
let hum = 65.0;
let fan = false;
let pump = false;
let fault = false;
let estop = false;
let seq = 0;
let tickCount = 0;
let lastActuatorSig = '';
let faultReported = false;

// Cooldown tracker untuk alert agar tidak spam
const alertActiveMap = {};
function triggerAlertOnce(code, level, message, condition) {
  if (condition && !alertActiveMap[code]) {
    alertActiveMap[code] = true;
    pub(TOPICS.alert, { level, code, message, ts: nowEpochSeconds() });
  } else if (!condition) {
    alertActiveMap[code] = false;
  }
}

function simulationTick() {
  tickCount++;

  // Skenario Hang: berhenti mengirimkan data tapi tetap terhubung
  if (scenario === 'hang' && tickCount > 10) {
    console.log('[SIM] Skenario HANG aktif: Berhenti mengirim pesan data sensor...');
    return;
  }

  // Skenario Disconnect paksa: putus koneksi mendadak tanpa disconnect bersih (uji LWT)
  if (scenario === 'disconnect' && tickCount > 8) {
    console.log('[SIM] Skenario DISCONNECT aktif: Memutuskan koneksi soket paksa untuk menguji LWT...');
    client.options.reconnectPeriod = 0;
    client.stream.destroy();
    setTimeout(() => process.exit(0), 400);
    return;
  }

  // Dinamika fisik greenhouse:
  // Kipas aktif mendinginkan suhu; suhu lingkungan alami naik perlahan
  temp += (fan ? -0.7 : scenario === 'hot' ? 0.9 : 0.15) + ((Math.random() - 0.5) * 0.25);
  // Pompa aktif menambah kelembapan tanah; pengeringan alami mengurangi kelembapan
  soil = Math.max(0, Math.min(100, Math.round(soil + (pump ? 3 : scenario === 'dry' ? -1.8 : -0.4))));
  // Kelembapan udara berkorelasi dengan suhu dan penguapan
  hum = Math.max(30, Math.min(95, Number((hum + (fan ? -0.8 : 0.2) + ((Math.random() - 0.5) * 1.2)).toFixed(1))));

  // Pemicuan skenario spesifik berdasarkan waktu berjalan
  if (scenario === 'sensor-fault' && tickCount > 6) fault = true;
  if (scenario === 'estop' && tickCount > 6) estop = true;

  // Logika interlock aktuator:
  if (fault || estop) {
    // Jika sensor rusak atau E-Stop ditekan, aktuator langsung dimatikan
    fan = false;
    pump = false;
  } else {
    // Kontrol histeresis closed-loop firmware
    if (!fan && temp > fanThresholdOn) fan = true;
    else if (fan && temp <= fanThresholdOff) fan = false;

    if (!pump && soil < pumpThresholdOn) pump = true;
    else if (pump && soil >= pumpThresholdOff) pump = false;
  }

  // Timestamp simulasi (jika no-ntp, kirim ts = 0 untuk 12 pesan pertama)
  const ts = (scenario === 'no-ntp' && tickCount <= 12) ? 0 : nowEpochSeconds();
  const mode = estop ? 'emergency' : 'auto';

  // Publikasi status aktuator HANYA saat ada perubahan (retained)
  const currentActuatorSig = `${fan},${pump},${mode},${estop}`;
  if (currentActuatorSig !== lastActuatorSig) {
    lastActuatorSig = currentActuatorSig;
    pub(TOPICS.actuator, { fan, pump, mode, estop, ts }, true);
  }

  // Publikasi perubahan status sensor_fault
  if (fault && !faultReported) {
    faultReported = true;
    pub(TOPICS.system, { state: 'online', sensor_fault: true }, true);
  }

  // Evaluasi pemicuan alert
  triggerAlertOnce('TEMP_CRITICAL', 'critical', `Suhu ${temp.toFixed(1)}°C melebihi batas kritis ${fanThresholdOn}°C`, !fault && temp > fanThresholdOn);
  triggerAlertOnce('SOIL_DRY', 'warning', `Kelembapan tanah ${soil}% di bawah ambang ${pumpThresholdOn}%`, !fault && !estop && soil < pumpThresholdOn);
  triggerAlertOnce('SENSOR_FAULT', 'critical', 'Sensor DHT22 gagal membaca / kabel putus', fault);
  triggerAlertOnce('ESTOP', 'critical', 'Emergency Stop diaktifkan oleh operator', estop);

  // Skenario Reboot / Restart ESP32 (seq reset ke 0)
  if (scenario === 'restart' && tickCount === 10) {
    console.log('[SIM] Skenario REBOOT aktif: Sequence reset ke 0 (meniru boot ulang ESP32)...');
    seq = 0;
  }

  // Skenario Packet Loss (melompati 2 nomor urut seq)
  if (scenario === 'packet-loss' && tickCount % 4 === 0) {
    console.log('[SIM] Skenario PACKET LOSS aktif: Sengaja melompati nomor sequence...');
    seq += 2;
  }

  // Publikasi data sensor periodik
  pub(TOPICS.sensor, {
    temp: fault ? null : Number(temp.toFixed(1)),
    hum: fault ? null : Number(hum.toFixed(1)),
    soil: soil,
    seq: seq,
    ts: ts
  });

  seq++;
}

client.on('connect', () => {
  console.log(`=======================================================`);
  console.log(`[SIMULATOR ESP32] Terhubung ke ${MQTT_URL}`);
  console.log(`[SIMULATOR ESP32] Skenario aktif: [${scenario.toUpperCase()}]`);
  console.log(`=======================================================`);

  // Kirim status awal online
  pub(TOPICS.system, { state: 'online', sensor_fault: false }, true);

  // Kirim status aktuator awal
  pub(TOPICS.actuator, { fan: false, pump: false, mode: 'auto', estop: false, ts: nowEpochSeconds() }, true);

  // Jalankan interval pengiriman
  setInterval(simulationTick, Number(PUBLISH_INTERVAL_MS));
});

// Penanganan sinyal keluar bersih
process.on('SIGINT', () => {
  console.log('\n[SIMULATOR ESP32] Mengirim status offline & menutup koneksi...');
  pub(TOPICS.system, { state: 'offline', sensor_fault: false }, true);
  client.end(false, {}, () => process.exit(0));
});
