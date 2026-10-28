// api.js - Lapisan Pengambilan Data & Real-Time SSE
// Terhubung dengan REST API Backend & Server-Sent Events (/api/stream)

const API = {
  // Ambil snapshot kondisi terkini & metrik komunikasi
  async getLatest() {
    const res = await fetch('/api/latest');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Ambil data pembacaan historis dengan rentang waktu
  async getReadings(range = '1h') {
    const res = await fetch(`/api/readings?range=${encodeURIComponent(range)}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Ambil riwayat alerts
  async getAlerts(limit = 50) {
    const res = await fetch(`/api/alerts?limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Ambil riwayat audit event sistem
  async getEvents(limit = 50) {
    const res = await fetch(`/api/events?limit=${limit}`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Ambil konfigurasi & ambang batas sistem
  async getConfig() {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Cek kesehatan backend
  async getHealth() {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  },

  // Inisialisasi Real-time Server-Sent Events (SSE)
  initStream(callbacks = {}) {
    let evtSource = null;
    let reconnectTimeout = null;

    function connect() {
      if (callbacks.onConnectionChange) callbacks.onConnectionChange('connecting');

      evtSource = new EventSource('/api/stream');

      evtSource.onopen = () => {
        if (callbacks.onConnectionChange) callbacks.onConnectionChange('connected');
      };

      // Handler untuk snapshot awal
      evtSource.addEventListener('snapshot', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onSnapshot) callbacks.onSnapshot(data);
        } catch (err) {
          console.error('[SSE] Error parsing snapshot:', err);
        }
      });

      // Handler data sensor live
      evtSource.addEventListener('sensor', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onSensor) callbacks.onSensor(data);
        } catch (err) {
          console.error('[SSE] Error parsing sensor:', err);
        }
      });

      // Handler status aktuator
      evtSource.addEventListener('actuator', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onActuator) callbacks.onActuator(data);
        } catch (err) {
          console.error('[SSE] Error parsing actuator:', err);
        }
      });

      // Handler status sistem & LWT
      evtSource.addEventListener('system', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onSystem) callbacks.onSystem(data);
        } catch (err) {
          console.error('[SSE] Error parsing system:', err);
        }
      });

      // Handler alert darurat
      evtSource.addEventListener('alert', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onAlert) callbacks.onAlert(data);
        } catch (err) {
          console.error('[SSE] Error parsing alert:', err);
        }
      });

      // Handler metrik performa komunikasi
      evtSource.addEventListener('stats', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onStats) callbacks.onStats(data);
        } catch (err) {
          console.error('[SSE] Error parsing stats:', err);
        }
      });

      // Handler event sistem
      evtSource.addEventListener('event', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (callbacks.onEvent) callbacks.onEvent(data);
        } catch (err) {
          console.error('[SSE] Error parsing event:', err);
        }
      });

      evtSource.onerror = () => {
        if (callbacks.onConnectionChange) callbacks.onConnectionChange('disconnected');
        evtSource.close();
        // Rekoneksi otomatis setelah 3 detik
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return {
      close: () => {
        clearTimeout(reconnectTimeout);
        if (evtSource) evtSource.close();
      }
    };
  }
};
