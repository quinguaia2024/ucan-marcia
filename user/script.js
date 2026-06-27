/* ═══════════════════════════════════════════════════════
   PRO-VigiMAT — Portal Comunitário — script.js v3.0
   Alinhado com vigimat-core.js: avgTemp, avgHum, rain1,
   rain2, risk, tx1Temp, tx2Temp, hum1, hum2 do Firebase
════════════════════════════════════════════════════════ */
'use strict';

/* ── RECOMENDAÇÕES (com ícones SVG inline) ── */
const ICON = {
  broom:   `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l7-7"/><path d="M4.5 13.5l6 6"/><path d="M14 3l7 7-10 10-7-7z"/></svg>`,
  home:    `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  people:  `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  spray:   `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h4l1 5H3z"/><path d="M7 8h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8"/><path d="M8 15v4"/><path d="M12 15v4"/><path d="M14 9V3h4"/></svg>`,
  shirt:   `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>`,
  water:   `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 C8 7 4 11 4 14a8 8 0 0016 0C20 11 16 7 12 2z"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/></svg>`,
  net:     `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="14" x2="22" y2="14"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="14" y1="2" x2="14" y2="22"/></svg>`,
  moon:    `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  alert:   `<svg class="rec-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

const RECOMMENDATIONS = {
  BAIXO: [
    { title: 'Limpeza de Quintais',     desc: 'Mantém o teu quintal livre de recipientes que possam acumular água da chuva.',          iconKey: 'broom',  level: 'low' },
    { title: 'Janelas Protegidas',      desc: 'Utiliza redes mosquiteiras em janelas e portas para evitar a entrada de insectos.',    iconKey: 'home',   level: 'low' },
    { title: 'Vigilância Comunitária',  desc: 'Informa os teus vizinhos sobre a importância de manter a zona limpa.',                  iconKey: 'people', level: 'low' },
  ],
  MEDIO: [
    { title: 'Uso de Repelente',        desc: 'Aplica repelente nas áreas expostas do corpo, especialmente ao amanhecer e entardecer.', iconKey: 'spray',  level: 'warn' },
    { title: 'Roupa Protegida',         desc: 'Veste roupas de mangas compridas e calças se precisares de sair à noite.',              iconKey: 'shirt',  level: 'warn' },
    { title: 'Eliminação de Poças',     desc: 'Verifica e elimina poças de água estagnada após a chuva na tua vizinhança.',            iconKey: 'water',  level: 'warn' },
  ],
  ALTO: [
    { title: 'Redes Mosquiteiras',      desc: 'Dorme SEMPRE debaixo de uma rede mosquiteira tratada com insecticida.',                iconKey: 'net',    level: 'danger' },
    { title: 'Evitar Saídas Nocturnas', desc: 'Evita actividades ao ar livre durante a noite, quando os mosquitos são mais activos.',   iconKey: 'moon',   level: 'danger' },
    { title: 'Destruição de Criadouros',desc: 'Acção imediata para enterrar ou destruir qualquer foco de água parada num raio de 50 m.',iconKey: 'alert',  level: 'danger' },
  ]
};

let currentRisk = 'BAIXO';
let riskChart    = null;
let tempChart    = null;
let inactivityTimer;

/* ── BOOT CONTROL STATE ── */
let startupPeriodElapsed = false;
let newReadingReceivedDuringStartup = false;
let lastVigiMatResult = null;
let systemStatus = 'inactive';
window.initialLatestTimestamp = null;

/* ── UTILS ── */
const nowTime = () => new Date().toLocaleTimeString('pt-PT', { hour12: false });
const today   = () => new Date().toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' });
const el      = id  => document.getElementById(id);

/* ── PRELOADER ── */
function initPreloader() {
  const status = el('pl-status');
  const msgs = ['A ligar à rede...', 'A sincronizar dados...', 'A analisar condições...', 'Pronto.'];
  let i = 0;
  const iv = setInterval(() => {
    if (status && i < msgs.length) status.textContent = msgs[i++];
    else clearInterval(iv);
  }, 620);
  setTimeout(() => el('preloader').classList.add('gone'), 2500);
}

/* ══════════════════════════════════════════════════════
   DATA BINDING — alinhado com vigimat-core.js output
══════════════════════════════════════════════════════ */
function updateUI(data) {
  const { summary, readings, chartData } = data;
  currentRisk = summary.currentRisk || 'BAIXO';

  const latest = readings[0] || {};

  /* ── Hero chips ── */
  const t1 = latest.temp1 ?? latest.avgTemp ?? null;
  const t2 = latest.temp2 ?? latest.avgTemp ?? null;
  el('hero-temp1').textContent = t1 !== null ? `${t1.toFixed(1)}°C` : '--°C';
  el('hero-temp2').textContent = t2 !== null ? `${t2.toFixed(1)}°C` : '--°C';
  el('hero-hum').textContent   = `${summary.averageHumidity.toFixed(1)}%`;
  el('hero-date').textContent  = today();

  /* ── Risk Orb ── */
  const pctMap = { ALTO: 85, MEDIO: 50, BAIXO: 18 };
  const orbPct = pctMap[currentRisk] ?? 18;
  el('orb-pct').textContent = `${orbPct}%`;
  el('orb-lvl').textContent = `RISCO ${currentRisk}`;
  el('orb-tag').textContent = summary.riskTrend === 'Piorando' ? 'Risco em subida ↑' : summary.riskTrend === 'Melhorando' ? 'A melhorar ↓' : 'Condições estáveis';
  el('risk-caption').textContent = summary.stagnationMsg
    ? `⚠ ${summary.stagnationMsg.slice(0, 80)}...`
    : 'A monitorar condições ambientais em tempo real...';

  const orb = el('risk-orb');
  orb.className = `risk-orb risk-${currentRisk === 'ALTO' ? 'high' : currentRisk === 'MEDIO' ? 'med' : 'low'}`;

  /* SVG gauge */
  const offset = 628.3 - (orbPct / 100 * 628.3);
  el('gauge-fill').style.strokeDashoffset = offset;

  /* ── Dashboard Cards ── */
  // IRM state card
  const envVal = el('sv-env');
  if (summary.stagnationMsg) {
    envVal.textContent = 'Criadouro Detectado';
    envVal.style.color = 'var(--red)';
  } else {
    const labels = { ALTO: 'Risco Elevado', MEDIO: 'Atenção', BAIXO: 'Seguro' };
    envVal.textContent = labels[currentRisk] || 'Seguro';
    envVal.style.color = currentRisk === 'ALTO' ? 'var(--red)' : currentRisk === 'MEDIO' ? 'var(--yellow)' : 'var(--green)';
  }

  setTrend('tr-env', summary.riskTrend === 'Piorando' ? 'Subindo' : summary.riskTrend === 'Melhorando' ? 'Descendo' : 'Estável');

  // Condition meter
  el('seg-low').classList.toggle('active',  currentRisk === 'BAIXO');
  el('seg-med').classList.toggle('active',  currentRisk === 'MEDIO');
  el('seg-high').classList.toggle('active', currentRisk === 'ALTO');

  // Stagnation chips
  renderStagnation('stag-chip-tx1', 'stag-val-tx1', summary.tx1Stagnation);
  renderStagnation('stag-chip-tx2', 'stag-val-tx2', summary.tx2Stagnation);

  // Temperature TX1
  if (t1 !== null) {
    el('sv-temp1').textContent = `${t1.toFixed(1)}°C`;
    el('bf-temp1').style.width = `${Math.min(100, ((t1 - 10) / 40) * 100)}%`;
  }
  setTrend('tr-temp', summary.temperatureTrend);

  // Temperature TX2
  if (t2 !== null) {
    el('sv-temp2').textContent = `${t2.toFixed(1)}°C`;
    el('bf-temp2').style.width = `${Math.min(100, ((t2 - 10) / 40) * 100)}%`;
  }
  setTrend('tr-temp2', summary.temperatureTrend);

  // Humidity — TX1 e TX2 individuais (sem média)
  const hum1Raw = latest.hum1 !== undefined ? parseFloat(latest.hum1) : null;
  const hum2Raw = latest.hum2 !== undefined ? parseFloat(latest.hum2) : null;

  if (hum1Raw !== null) {
    el('sv-hum').textContent = `${hum1Raw.toFixed(1)}%`;
    el('bf-hum').style.width = `${Math.min(100, hum1Raw)}%`;
  }
  if (hum2Raw !== null) {
    const svHum2 = el('sv-hum2');
    const bfHum2 = el('bf-hum2');
    if (svHum2) svHum2.textContent = `${hum2Raw.toFixed(1)}%`;
    if (bfHum2) bfHum2.style.width = `${Math.min(100, hum2Raw)}%`;
  }
  setTrend('tr-hum', summary.humidityTrend);
  setTrend('tr-hum2', summary.humidityTrend);

  // Water presence
  const r1 = latest.rain1;
  const r2 = latest.rain2;
  const WATER_THRESH = 2000;
  const w1 = r1 !== undefined ? r1 < WATER_THRESH : null;
  const w2 = r2 !== undefined ? r2 < WATER_THRESH : null;
  let waterText = 'Sem dados';
  let waterColor = 'var(--text2)';
  if (w1 !== null || w2 !== null) {
    const hasWater = (w1 === true) || (w2 === true);
    waterText = hasWater
      ? `Detectada${w1 && w2 ? ' (TX1 e TX2)' : w1 ? ' (TX1)' : ' (TX2)'}`
      : 'Não detectada';
    waterColor = hasWater ? 'var(--blue)' : 'var(--green)';
  }
  el('sv-water').textContent = waterText;
  el('sv-water').style.color = waterColor;
  el('sc-water-sub').textContent = (r1 !== undefined && r2 !== undefined)
    ? `TX1: ${r1} / TX2: ${r2}`
    : 'Aguardando leituras';

  /* ── Alerts ── */
  renderAlerts(data.alerts);

  /* ── Recommendations ── */
  renderRecommendations(currentRisk);

  /* ── Charts ── */
  renderRiskChart(chartData);
  renderTempChart(chartData, readings);
  el('ch-cur-risk').textContent = `RISCO ${currentRisk}`;
  el('ch-cur-temp').textContent = t1 !== null ? `${t1.toFixed(1)}°C` : '--°C';
}

/* ── Stagnation chip helper ── */
function renderStagnation(chipId, valId, count) {
  const chip = el(chipId);
  const valEl = el(valId);
  if (!chip || !valEl) return;

  if (!count || count < 2) {
    chip.classList.remove('active-water');
    valEl.className = 'stag-val';
    valEl.textContent = 'Nenhuma';
    return;
  }
  const mins = Math.round((count - 1) * 30 / 60 * 10) / 10;
  chip.classList.add('active-water');
  valEl.className = 'stag-val has-water';
  valEl.textContent = mins >= 1 ? `${mins.toFixed(0)} min` : `${(count - 1) * 30}s`;
}

/* ── Trend badge helper ── */
function setTrend(id, trend) {
  const el2 = el(id);
  if (!el2) return;
  const map = { Subindo: 'up', Descendo: 'down', Piorando: 'up', Melhorando: 'down' };
  const cls = map[trend] || 'stable';
  el2.textContent = trend || '—';
  el2.className = `sc-trend ${cls}`;
}

/* ── Alert icons ── */
function alertIcon(type, severity) {
  if (type.startsWith('STAGNATION'))
    return `<svg class="al-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 C8 7 4 11 4 14a8 8 0 0016 0C20 11 16 7 12 2z"/></svg>`;
  if (severity === 'danger')
    return `<svg class="al-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  return `<svg class="al-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}

function renderAlerts(alerts) {
  const container = el('alerts-list');
  const empty     = el('alerts-empty');
  if (!container) return;

  // Show stagnation + risk alerts (exclude sensor-technical-only types)
  const filtered = alerts.filter(a =>
    a.type === 'HIGH_RISK' ||
    a.type === 'MEDIUM_RISK' ||
    a.type.startsWith('STAGNATION_')
  );

  // Badge config
  const badgeLabel = { info: 'AVISO', warn: 'ATENÇÃO', danger: 'ALTA PRIORIDADE' };

  if (filtered.length === 0) {
    empty.style.display = 'flex';
    container.querySelectorAll('.alert-item').forEach(i => i.remove());
    el('notif-dot').style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  el('notif-dot').style.display = 'block';

  const html = filtered.map(a => `
    <article class="alert-item sev-${a.severity}">
      <div class="al-icon sev-${a.severity}">${alertIcon(a.type, a.severity)}</div>
      <div class="al-body">
        <div class="al-title">${a.title}</div>
        <div class="al-msg">${a.message}</div>
        <div class="al-foot">
          <span class="al-time">${new Date(a.timestamp * 1000).toLocaleTimeString('pt-PT')}</span>
          <span class="al-badge sev-${a.severity}">${badgeLabel[a.severity] || 'AVISO'}</span>
        </div>
      </div>
    </article>
  `).join('');

  container.querySelectorAll('.alert-item').forEach(i => i.remove());
  container.insertAdjacentHTML('beforeend', html);
}

function renderRecommendations(risk) {
  const container = el('rec-grid');
  const recs = RECOMMENDATIONS[risk] || RECOMMENDATIONS.BAIXO;
  container.innerHTML = recs.map(r => `
    <article class="rec-card">
      <div class="rec-icon-wrap ${r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : ''}">
        ${ICON[r.iconKey] || ''}
      </div>
      <div class="rec-body">
        <div class="rec-title ${r.level === 'danger' ? 'danger' : r.level === 'warn' ? 'warn' : ''}">${r.title}</div>
        <div class="rec-desc">${r.desc}</div>
      </div>
    </article>
  `).join('');
}

/* ── Charts ── */
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(13,20,37,0.95)',
      borderColor: 'rgba(0,232,198,0.2)',
      borderWidth: 1,
      titleColor: '#e8f4f2',
      bodyColor: '#94a3b8',
      padding: 12,
    }
  },
  scales: {
    x: {
      ticks: { color: '#475569', maxRotation: 0, font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' }
    },
    y: {
      ticks: { color: '#475569', font: { size: 11 } },
      grid: { color: 'rgba(255,255,255,0.04)' }
    }
  }
};

function renderRiskChart(chartData) {
  const ctx = el('ch-risk').getContext('2d');
  if (riskChart) {
    riskChart.data.labels = chartData.risk.map(d => d.timestamp);
    riskChart.data.datasets[0].data = chartData.risk.map(d => d.value);
    riskChart.update('none');
    return;
  }
  riskChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.risk.map(d => d.timestamp),
      datasets: [{
        label: 'Nível de Risco',
        data: chartData.risk.map(d => d.value),
        borderColor: '#00e8c6',
        backgroundColor: 'rgba(0,232,198,0.06)',
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: '#00e8c6',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          min: 1, max: 3,
          ticks: {
            stepSize: 1,
            callback: v => ['BAIXO', 'MÉDIO', 'ALTO'][v - 1],
            color: '#475569', font: { size: 11 }
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

function renderTempChart(chartData, readings) {
  const ctx = el('ch-temp').getContext('2d');
  const chrono = [...readings].reverse();

  if (tempChart) {
    tempChart.data.labels = chrono.map(r => new Date(r.timestamp * 1000).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }));
    tempChart.data.datasets[0].data = chrono.map(r => r.temp1 ?? r.avgTemp ?? null);
    tempChart.data.datasets[1].data = chrono.map(r => r.temp2 ?? r.avgTemp ?? null);
    tempChart.update('none');
    return;
  }
  tempChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chrono.map(r => new Date(r.timestamp * 1000).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })),
      datasets: [
        {
          label: 'TX1 Temp',
          data: chrono.map(r => r.temp1 ?? r.avgTemp ?? null),
          borderColor: '#00e8c6',
          backgroundColor: 'rgba(0,232,198,0.06)',
          borderWidth: 2,
          pointRadius: 2.5,
          tension: 0.4,
          fill: false
        },
        {
          label: 'TX2 Temp',
          data: chrono.map(r => r.temp2 ?? r.avgTemp ?? null),
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.06)',
          borderWidth: 2,
          pointRadius: 2.5,
          tension: 0.4,
          fill: false
        }
      ]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true,
          labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 14, padding: 16 }
        }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ticks: {
            callback: v => `${v}°C`,
            color: '#475569', font: { size: 11 }
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        }
      }
    }
  });
}

/* ── INTERACTIVITY ── */
window.toggleMenu = () => {
  const drawer  = el('drawer');
  const overlay = el('drawer-overlay');
  const btn     = el('menu-toggle');
  const isOpen  = drawer.classList.toggle('open');
  overlay.classList.toggle('open', isOpen);
  btn.setAttribute('aria-expanded', isOpen);
};

window.closeDrawer = () => {
  el('drawer').classList.remove('open');
  el('drawer-overlay').classList.remove('open');
  el('menu-toggle').setAttribute('aria-expanded', 'false');
};

el('menu-toggle').addEventListener('click', toggleMenu);
el('drawer-close').addEventListener('click', closeDrawer);
el('notif-btn').addEventListener('click', () => {
  document.querySelector('#alerts').scrollIntoView({ behavior: 'smooth' });
});

/* ── INACTIVITY ── */
function handleInactivity() {
  el('conn-dot').className  = 'conn-dot offline';
  el('conn-text').textContent = 'Inactivo — sem dados > 1 min';
  el('drawer-conn-dot').className = 'conn-dot offline';
}

function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(handleInactivity, 60000);
}

/* ── BOOT ── */
function init() {
  initPreloader();

  // Clock
  setInterval(() => {
    el('nav-clock').textContent = nowTime();
    el('nav-date').textContent  = today();
  }, 1000);

  // VigiMat Integration
  VigiMat.init();
  VigiMat.firebase.onReadingsUpdate((raw) => {
    if (raw.length > 0) {
      const data = VigiMat.processData(raw);
      lastVigiMatResult = data;

      const latest = data.readings[0] || {};
      
      if (window.initialLatestTimestamp === null) {
        window.initialLatestTimestamp = latest.timestamp || 0;
      }

      const isNewReading = latest.timestamp && latest.timestamp > window.initialLatestTimestamp;

      if (isNewReading) {
        window.initialLatestTimestamp = latest.timestamp;
        if (!startupPeriodElapsed) {
          newReadingReceivedDuringStartup = true;
        } else {
          systemStatus = 'active';
          resetInactivity();
        }
      }

      if (systemStatus === 'active') {
        resetInactivity();
        updateUI(data);
        el('conn-dot').className  = 'conn-dot online';
        el('conn-text').textContent = 'Actualizado agora';
        el('drawer-conn-dot').className = 'conn-dot online';
      } else {
        el('conn-dot').className  = 'conn-dot offline';
        el('conn-text').textContent = startupPeriodElapsed ? 'Inactivo — sem dados > 1 min' : 'A aguardar validação (20s)...';
        el('drawer-conn-dot').className = 'conn-dot offline';
      }
    }
  });

  // Período de Boot/Inicialização de 20 segundos
  setTimeout(() => {
    startupPeriodElapsed = true;
    if (newReadingReceivedDuringStartup && lastVigiMatResult) {
      systemStatus = 'active';
      resetInactivity();
      updateUI(lastVigiMatResult);
      el('conn-dot').className  = 'conn-dot online';
      el('conn-text').textContent = 'Actualizado agora';
      el('drawer-conn-dot').className = 'conn-dot online';
    } else {
      systemStatus = 'inactive';
      handleInactivity();
    }
  }, 20000);
}

document.addEventListener('DOMContentLoaded', init);
