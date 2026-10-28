// charts.js - Modul Visualisasi Grafik SVG Interaktif Smart Greenhouse CPS
// Mendukung Dual Trend Line Chart & Grouped Capsule Bar Chart untuk Analisis Statistik

const Charts = {
  // 1. Render Dual Trend Line Chart (Suhu Udara & Kelembapan Tanah)
  renderDualChart(containerId, dataPoints, config = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!dataPoints || dataPoints.length === 0) {
      container.innerHTML = '<div class="chart-loading">Belum ada data historis pada rentang ini.</div>';
      return;
    }

    const {
      fanOn = 35,
      fanOff = 28,
      pumpOn = 30,
      pumpOff = 60,
      showGuidelines = true
    } = config;

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 260;
    const padding = { top: 20, right: 20, bottom: 30, left: 45 };

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Rentang Skala Sumbu Y:
    // Suhu: 15°C s/d 45°C
    const minTemp = 15;
    const maxTemp = 45;
    // Kelembapan Tanah: 0% s/d 100%
    const minSoil = 0;
    const maxSoil = 100;

    const n = dataPoints.length;
    const xCoord = (idx) => padding.left + (n < 2 ? plotW / 2 : (idx / (n - 1)) * plotW);
    const yTemp = (v) => padding.top + plotH - Math.max(0, Math.min(plotH, ((v - minTemp) / (maxTemp - minTemp)) * plotH));
    const ySoil = (v) => padding.top + plotH - Math.max(0, Math.min(plotH, ((v - minSoil) / (maxSoil - minSoil)) * plotH));

    // Bangun jalur SVG (Path)
    let pathTemp = '';
    let pathSoil = '';
    let penTemp = false;
    let penSoil = false;

    dataPoints.forEach((d, idx) => {
      const x = xCoord(idx).toFixed(1);
      
      // Suhu: Jika null (sensor fault), putus garis
      if (d.temp === null || d.temp === undefined) {
        penTemp = false;
      } else {
        const y = yTemp(d.temp).toFixed(1);
        pathTemp += (penTemp ? ` L ${x} ${y}` : ` M ${x} ${y}`);
        penTemp = true;
      }

      // Soil: 0-100%
      if (d.soil === null || d.soil === undefined) {
        penSoil = false;
      } else {
        const y = ySoil(d.soil).toFixed(1);
        pathSoil += (penSoil ? ` L ${x} ${y}` : ` M ${x} ${y}`);
        penSoil = true;
      }
    });

    // Garis Panduan Ambang Batas Histeresis
    let guidelinesSvg = '';
    if (showGuidelines) {
      guidelinesSvg = `
        <!-- Fan ON: 35°C (Merah) -->
        <line x1="${padding.left}" y1="${yTemp(fanOn)}" x2="${width - padding.right}" y2="${yTemp(fanOn)}" 
              stroke="#dc2626" stroke-dasharray="4,4" stroke-width="1.2" opacity="0.8" />
        <text x="${width - padding.right - 2}" y="${yTemp(fanOn) - 4}" fill="#dc2626" font-size="10" text-anchor="end" font-weight="700">Fan ON: ${fanOn}°C</text>

        <!-- Fan OFF: 28°C (Kuning) -->
        <line x1="${padding.left}" y1="${yTemp(fanOff)}" x2="${width - padding.right}" y2="${yTemp(fanOff)}" 
              stroke="#d97706" stroke-dasharray="4,4" stroke-width="1" opacity="0.7" />
        <text x="${width - padding.right - 2}" y="${yTemp(fanOff) - 4}" fill="#d97706" font-size="10" text-anchor="end" font-weight="700">Fan OFF: ${fanOff}°C</text>

        <!-- Pump ON: 30% (Oranye) -->
        <line x1="${padding.left}" y1="${ySoil(pumpOn)}" x2="${width - padding.right}" y2="${ySoil(pumpOn)}" 
              stroke="#ea580c" stroke-dasharray="3,3" stroke-width="1.2" opacity="0.8" />
        <text x="${padding.left + 4}" y="${ySoil(pumpOn) - 4}" fill="#ea580c" font-size="10" text-anchor="start" font-weight="700">Pump ON: ${pumpOn}%</text>

        <!-- Pump OFF: 60% (Hijau) -->
        <line x1="${padding.left}" y1="${ySoil(pumpOff)}" x2="${width - padding.right}" y2="${ySoil(pumpOff)}" 
              stroke="#16a34a" stroke-dasharray="3,3" stroke-width="1" opacity="0.7" />
        <text x="${padding.left + 4}" y="${ySoil(pumpOff) - 4}" fill="#16a34a" font-size="10" text-anchor="start" font-weight="700">Pump OFF: ${pumpOff}%</text>
      `;
    }

    // Grid Garis Horizontal Latar Belakang (Tema Light / Bersih)
    let gridSvg = '';
    [20, 30, 40].forEach(tVal => {
      gridSvg += `<line x1="${padding.left}" y1="${yTemp(tVal)}" x2="${width - padding.right}" y2="${yTemp(tVal)}" stroke="#f1f5f9" stroke-width="1" />`;
      gridSvg += `<text x="${padding.left - 6}" y="${yTemp(tVal) + 3}" fill="#94a3b8" font-size="10" text-anchor="end" font-family="JetBrains Mono">${tVal}°C</text>`;
    });

    const firstTime = dataPoints[0]?.rx ? new Date(dataPoints[0].rx).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    const lastTime = dataPoints[n - 1]?.rx ? new Date(dataPoints[n - 1].rx).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

    container.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
        <!-- Grid -->
        ${gridSvg}

        <!-- Garis Panduan Ambang Batas -->
        ${guidelinesSvg}

        <!-- Garis Kurva Suhu Udara (°C) -->
        <path d="${pathTemp}" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Garis Kurva Kelembapan Tanah (%) -->
        <path d="${pathSoil}" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Sumbu X Label Waktu -->
        <text x="${padding.left}" y="${height - 8}" fill="#94a3b8" font-size="11" text-anchor="start" font-family="JetBrains Mono">${firstTime}</text>
        <text x="${width - padding.right}" y="${height - 8}" fill="#94a3b8" font-size="11" text-anchor="end" font-family="JetBrains Mono">${lastTime}</text>

        <!-- Interactive Crosshair -->
        <line id="crosshair-x-${containerId}" x1="0" y1="${padding.top}" x2="0" y2="${height - padding.bottom}" 
              stroke="#94a3b8" stroke-width="1" stroke-dasharray="3,3" opacity="0" pointer-events="none" />
      </svg>
    `;

    Charts.attachTooltip(container, dataPoints, { xCoord, yTemp, ySoil, padding, plotW });
  },

  // 2. Render Grouped Bar Chart untuk Statistik Agregasi Sensor (Min, Rata-rata, Maks)
  renderBarChart(containerId, dataPoints) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!dataPoints || dataPoints.length === 0) {
      container.innerHTML = '<div class="chart-loading">Belum ada data sensor pada rentang waktu ini untuk kalkulasi statistik.</div>';
      return;
    }

    // Ambil nilai valid (abaikan null)
    const validTemps = dataPoints.map(d => d.temp).filter(v => v !== null && v !== undefined);
    const validHums = dataPoints.map(d => d.hum).filter(v => v !== null && v !== undefined);
    const validSoils = dataPoints.map(d => d.soil).filter(v => v !== null && v !== undefined);

    if (validTemps.length === 0 && validHums.length === 0 && validSoils.length === 0) {
      container.innerHTML = '<div class="chart-loading">Data sensor tidak valid pada rentang waktu terpilih.</div>';
      return;
    }

    const calcStats = (arr) => {
      if (arr.length === 0) return { min: 0, avg: 0, max: 0 };
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      const avg = Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
      return { min, avg, max };
    };

    const tempStats = calcStats(validTemps);
    const humStats = calcStats(validHums);
    const soilStats = calcStats(validSoils);

    const width = container.clientWidth || 700;
    const height = container.clientHeight || 280;
    const padding = { top: 25, right: 30, bottom: 40, left: 50 };

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Skala Y: 0 s/d 100
    const maxY = 100;
    const scaleY = (val) => padding.top + plotH - (Math.max(0, Math.min(maxY, val)) / maxY) * plotH;

    // Grid Garis Horizontal Latar Belakang
    let gridSvg = '';
    [0, 25, 50, 75, 100].forEach(val => {
      const y = scaleY(val);
      gridSvg += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1" />`;
      gridSvg += `<text x="${padding.left - 8}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end" font-family="JetBrains Mono">${val}</text>`;
    });

    // 3 Kategori Utama: Min, Rata-rata, Maks
    const categories = [
      { label: 'Minimum (Min)', key: 'min' },
      { label: 'Rata-rata (Avg)', key: 'avg' },
      { label: 'Maksimum (Maks)', key: 'max' }
    ];

    const groupW = plotW / categories.length;
    const barW = Math.min(32, Math.max(16, (groupW - 40) / 3)); // Lebar kapsul bar
    const barRadius = 6; // Sudut melengkung atas (Capsule style sesuai gambar referensi)

    let barsSvg = '';
    const barDataElements = [];

    categories.forEach((cat, gIdx) => {
      const groupCenterX = padding.left + (gIdx * groupW) + (groupW / 2);
      const startX = groupCenterX - (3 * barW + 16) / 2;

      // 1. Bar Suhu (°C) - Royal Blue
      const tVal = tempStats[cat.key];
      const tY = scaleY(tVal);
      const tH = Math.max(2, padding.top + plotH - tY);
      const tX = startX;

      // 2. Bar Kelembapan Udara (%) - Sky Blue
      const hVal = humStats[cat.key];
      const hY = scaleY(hVal);
      const hH = Math.max(2, padding.top + plotH - hY);
      const hX = startX + barW + 8;

      // 3. Bar Kelembapan Tanah (%) - Emerald Green
      const sVal = soilStats[cat.key];
      const sY = scaleY(sVal);
      const sH = Math.max(2, padding.top + plotH - sY);
      const sX = startX + (barW * 2) + 16;

      // Render Bar Capsular
      barsSvg += `
        <!-- Suhu -->
        <rect class="bar-rect" data-cat="${cat.label}" data-param="Suhu Udara" data-val="${tVal}" data-unit="°C"
              x="${tX}" y="${tY}" width="${barW}" height="${tH}" rx="${barRadius}" ry="${barRadius}"
              fill="url(#blueBarGrad)" filter="drop-shadow(0 2px 4px rgba(37,99,235,0.15))" />
        <text x="${tX + barW / 2}" y="${tY - 5}" fill="#1e293b" font-size="11" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">${tVal}</text>

        <!-- Kelembapan Udara -->
        <rect class="bar-rect" data-cat="${cat.label}" data-param="Kelembapan Udara" data-val="${hVal}" data-unit="% RH"
              x="${hX}" y="${hY}" width="${barW}" height="${hH}" rx="${barRadius}" ry="${barRadius}"
              fill="url(#skyBarGrad)" filter="drop-shadow(0 2px 4px rgba(14,165,233,0.15))" />
        <text x="${hX + barW / 2}" y="${hY - 5}" fill="#1e293b" font-size="11" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">${hVal}</text>

        <!-- Kelembapan Tanah -->
        <rect class="bar-rect" data-cat="${cat.label}" data-param="Kelembapan Tanah" data-val="${sVal}" data-unit="%"
              x="${sX}" y="${sY}" width="${barW}" height="${sH}" rx="${barRadius}" ry="${barRadius}"
              fill="url(#greenBarGrad)" filter="drop-shadow(0 2px 4px rgba(16,185,129,0.15))" />
        <text x="${sX + barW / 2}" y="${sY - 5}" fill="#1e293b" font-size="11" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">${sVal}</text>

        <!-- Label Kategori Sumbu X -->
        <text x="${groupCenterX}" y="${height - 12}" fill="#475569" font-size="12" font-weight="700" text-anchor="middle">${cat.label}</text>
      `;
    });

    container.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
        <defs>
          <linearGradient id="blueBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
          <linearGradient id="skyBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#0284c7" />
          </linearGradient>
          <linearGradient id="greenBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#34d399" />
            <stop offset="100%" stop-color="#059669" />
          </linearGradient>
        </defs>

        <!-- Grid Lines -->
        ${gridSvg}

        <!-- Bars -->
        ${barsSvg}
      </svg>
    `;

    // Tooltip interaktif untuk bar chart
    Charts.attachBarTooltip(container);
  },

  attachTooltip(container, dataPoints, scales) {
    const tooltip = document.getElementById('chartTooltip');
    const svg = container.querySelector('svg');
    const crosshair = container.querySelector(`[id^="crosshair-x-"]`);
    if (!tooltip || !svg) return;

    svg.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;

      if (mouseX < scales.padding.left || mouseX > rect.width - scales.padding.right) {
        tooltip.style.opacity = '0';
        if (crosshair) crosshair.style.opacity = '0';
        return;
      }

      const ratio = (mouseX - scales.padding.left) / scales.plotW;
      const index = Math.min(dataPoints.length - 1, Math.max(0, Math.round(ratio * (dataPoints.length - 1))));
      const point = dataPoints[index];

      if (!point) return;

      const timeStr = new Date(point.rx).toLocaleTimeString('id-ID');
      const tempStr = point.temp !== null ? `${point.temp.toFixed(1)} °C` : '<span style="color:#ea580c">Fault (null)</span>';
      const soilStr = point.soil !== null ? `${point.soil}%` : '--';
      const humStr = point.hum !== null ? `${point.hum.toFixed(1)}% RH` : '--';

      tooltip.innerHTML = `
        <div style="font-weight:700;margin-bottom:4px;color:#2563eb;font-family:JetBrains Mono">${timeStr} (Seq #${point.seq || 0})</div>
        <div style="display:flex;gap:12px;font-size:11px">
          <div><span style="color:#ef4444">●</span> Suhu: <strong>${tempStr}</strong></div>
          <div><span style="color:#10b981">●</span> Tanah: <strong>${soilStr}</strong></div>
          <div><span style="color:#0284c7">●</span> Udara: <strong>${humStr}</strong></div>
        </div>
      `;

      tooltip.style.left = `${Math.min(rect.width - 200, Math.max(10, mouseX - 60))}px`;
      tooltip.style.top = `${e.clientY - rect.top - 70}px`;
      tooltip.style.opacity = '1';

      if (crosshair) {
        crosshair.setAttribute('x1', mouseX);
        crosshair.setAttribute('x2', mouseX);
        crosshair.style.opacity = '1';
      }
    };

    svg.onmouseleave = () => {
      tooltip.style.opacity = '0';
      if (crosshair) crosshair.style.opacity = '0';
    };
  },

  attachBarTooltip(container) {
    const tooltip = document.getElementById('barChartTooltip');
    if (!tooltip) return;

    const rects = container.querySelectorAll('.bar-rect');
    rects.forEach(rect => {
      rect.onmouseenter = (e) => {
        const cat = rect.dataset.cat;
        const param = rect.dataset.param;
        const val = rect.dataset.val;
        const unit = rect.dataset.unit;

        tooltip.innerHTML = `
          <div style="font-weight:700;color:#2563eb;margin-bottom:2px">${cat}</div>
          <div style="font-size:12px;color:#475569">${param}: <strong style="color:#0f172a;font-family:JetBrains Mono">${val} ${unit}</strong></div>
        `;

        const bbox = rect.getBoundingClientRect();
        const containerBox = container.getBoundingClientRect();
        tooltip.style.left = `${bbox.left - containerBox.left + (bbox.width / 2) - 60}px`;
        tooltip.style.top = `${bbox.top - containerBox.top - 55}px`;
        tooltip.style.opacity = '1';
      };

      rect.onmouseleave = () => {
        tooltip.style.opacity = '0';
      };
    });
  }
};
