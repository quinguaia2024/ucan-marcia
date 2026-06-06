/* ═══════════════════════════════════════════════════════
   PRO-VigiMAT — Citizen Portal Logic
   Handles real-time data display and recommendations
════════════════════════════════════════════════════════ */
'use strict';

// Recommendations data
const RECOMMENDATIONS = {
  BAIXO: [
    { title: 'Limpeza de Quintais', desc: 'Mantém o teu quintal livre de recipientes que possam acumular água da chuva.', icon: '🧹' },
    { title: 'Janelas Protegidas', desc: 'Utiliza redes mosquiteiras em janelas e portas para evitar a entrada de insectos.', icon: '🏠' },
    { title: 'Vigilância Comunitária', desc: 'Informa os teus vizinhos sobre a importância de manter a zona limpa.', icon: '📢' }
  ],
  MEDIO: [
    { title: 'Uso de Repelente', desc: 'Aplica repelente nas áreas expostas do corpo, especialmente ao amanhecer e entardecer.', icon: '🧴' },
    { title: 'Roupa Protegida', desc: 'Veste roupas de mangas compridas e calças se precisares de sair à noite.', icon: '👕' },
    { title: 'Verificação de Poças', desc: 'Verifica e elimina poças de água estagnada após a chuva na tua vizinhança.', icon: '💧' }
  ],
  ALTO: [
    { title: 'Redes Mosquiteiras', desc: 'Dorme SEMPRE debaixo de uma rede mosquiteira tratada com insecticida.', icon: '🕸️' },
    { title: 'Evitar Saídas Nocturnas', desc: 'Evita actividades ao ar livre durante a noite, quando os mosquitos são mais activos.', icon: '🌙' },
    { title: 'Destruição de Criadouros', desc: 'Acção imediata para enterrar ou destruir qualquer foco de água parada num raio de 50m.', icon: '🚨' }
  ]
};

let currentRisk = 'BAIXO';
let riskChart = null;

/* ── UTILS ── */
const now = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });
const today = () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

/* ── PRELOADER ── */
function initPreloader() {
  const status = document.getElementById('pl-status');
  const msgs = ['Conectando à rede...', 'Sincronizando dados comunitários...', 'Analisando tendências...', 'Pronto.'];
  let i = 0;
  const iv = setInterval(() => {
    if (status && i < msgs.length) status.textContent = msgs[i++];
    else clearInterval(iv);
  }, 600);
  
  setTimeout(() => {
    document.getElementById('preloader').classList.add('gone');
  }, 2500);
}

/* ── DATA BINDING ── */
function updateUI(data) {
  const summary = data.summary;
  currentRisk = summary.currentRisk || 'BAIXO';
  
  // Hero section
  document.getElementById('hero-temp').textContent = `${summary.averageTemperature.toFixed(1)}°C`;
  document.getElementById('hero-hum').textContent = `${summary.averageHumidity.toFixed(1)}%`;
  document.getElementById('hero-date').textContent = today();
  
  // Risk Orb
  const orbPct = summary.currentRisk === 'ALTO' ? 85 : summary.currentRisk === 'MEDIO' ? 50 : 20;
  document.getElementById('orb-pct').textContent = `${orbPct}%`;
  document.getElementById('orb-lvl').textContent = `RISCO ${summary.currentRisk}`;
  document.getElementById('orb-tag').textContent = summary.riskTrend === 'Piorando' ? 'Risco em subida' : 'Condições estáveis';
  
  const orb = document.getElementById('risk-orb');
  orb.className = `risk-orb risk-${summary.currentRisk === 'ALTO' ? 'high' : summary.currentRisk === 'MEDIO' ? 'med' : 'low'}`;
  
  // Dashboard cards
  document.getElementById('sv-temp').textContent = `${summary.averageTemperature.toFixed(1)}°C`;
  document.getElementById('sv-hum').textContent = `${summary.averageHumidity.toFixed(1)}%`;
  
  const envVal = document.getElementById('sv-env');
  if (summary.stagnationMsg) {
    envVal.textContent = "Criadouro Detectado";
    envVal.style.color = "var(--c-red)";
    document.getElementById('orb-tag').textContent = summary.stagnationMsg;
  } else {
    envVal.textContent = summary.currentRisk === 'ALTO' ? 'Risco Elevado' : summary.currentRisk === 'MEDIO' ? 'Atenção' : 'Seguro';
    envVal.style.color = "var(--c-accent)";
  }
  
  document.getElementById('tr-temp').textContent = summary.temperatureTrend;
  document.getElementById('tr-temp').className = `sc-trend ${summary.temperatureTrend === 'Subindo' ? 'up' : 'down'}`;
  document.getElementById('tr-hum').textContent = summary.humidityTrend;
  document.getElementById('tr-hum').className = `sc-trend ${summary.humidityTrend === 'Subindo' ? 'up' : 'down'}`;
  
  // Condition Meter
  document.getElementById('seg-low').classList.toggle('active', summary.currentRisk === 'BAIXO');
  document.getElementById('seg-med').classList.toggle('active', summary.currentRisk === 'MEDIO');
  document.getElementById('seg-high').classList.toggle('active', summary.currentRisk === 'ALTO');
  
  // Gauge fill (SVG)
  const offset = 628.3 - (orbPct / 100 * 628.3);
  document.getElementById('gauge-fill').style.strokeDashoffset = offset;

  // Alerts
  renderAlerts(data.alerts);
  
  // Recommendations
  renderRecommendations(currentRisk);
  
  // Chart
  renderChart(data.chartData);
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-list');
  const empty = document.getElementById('alerts-empty');
  
  // For citizens, we only show risk-based alerts, not sensor technical alerts
  const filtered = alerts.filter(a => a.type === 'HIGH_RISK' || a.type === 'MEDIUM_RISK');
  
  if (filtered.length === 0) {
    empty.style.display = 'flex';
    // Remove existing items if any
    const existingItems = container.querySelectorAll('.alert-item');
    existingItems.forEach(item => item.remove());
    return;
  }
  
  empty.style.display = 'none';
  const html = filtered.map(a => `
    <article class="alert-item sev-${a.severity}">
      <div class="al-icon">${a.severity === 'danger' ? '🚨' : '⚠️'}</div>
      <div class="al-body">
        <div class="al-title">${a.title}</div>
        <div class="al-msg">${a.message}</div>
        <div class="al-foot">
          <span class="al-time">${new Date(a.timestamp * 1000).toLocaleTimeString()}</span>
          <span class="al-badge">${a.severity === 'danger' ? 'ALTA PRIORIDADE' : 'AVISO'}</span>
        </div>
      </div>
    </article>
  `).join('');
  
  // Clear old and insert new
  const existingItems = container.querySelectorAll('.alert-item');
  existingItems.forEach(item => item.remove());
  container.insertAdjacentHTML('beforeend', html);
}

function renderRecommendations(risk) {
  const container = document.getElementById('rec-grid');
  const recs = RECOMMENDATIONS[risk] || RECOMMENDATIONS.BAIXO;
  
  container.innerHTML = recs.map(r => `
    <article class="rec-card">
      <div class="rec-icon">${r.icon}</div>
      <div class="rec-body">
        <div class="rec-title">${r.title}</div>
        <div class="rec-desc">${r.desc}</div>
      </div>
    </article>
  `).join('');
}

function renderChart(chartData) {
  const ctx = document.getElementById('ch-risk').getContext('2d');
  
  if (riskChart) {
    riskChart.data.labels = chartData.risk.map(d => d.timestamp);
    riskChart.data.datasets[0].data = chartData.risk.map(d => d.value);
    riskChart.update();
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
        backgroundColor: 'rgba(0, 232, 198, 0.1)',
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: '#00e8c6',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 1, max: 3,
          ticks: {
            stepSize: 1,
            callback: function(value) {
              return ['BAIXO', 'MÉDIO', 'ALTO'][value - 1];
            },
            color: '#8fafc8'
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        x: {
          ticks: { color: '#8fafc8', maxRotation: 0 },
          grid: { display: false }
        }
      }
    }
  });
}

/* ── INTERACTIVITY ── */
window.toggleMenu = () => {
  const drawer = document.getElementById('drawer');
  const overlay = document.getElementById('drawer-overlay');
  drawer.classList.toggle('open');
  overlay.classList.toggle('open');
};

window.closeDrawer = () => {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
};

document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
document.getElementById('drawer-close').addEventListener('click', closeDrawer);

/* ── BOOT ── */
function init() {
  initPreloader();
  
  // Start Clock
  setInterval(() => {
    document.getElementById('nav-clock').textContent = now();
    document.getElementById('nav-date').textContent = today();
  }, 1000);
  
  // VigiMat Integration
  VigiMat.init();
  VigiMat.firebase.onReadingsUpdate((raw) => {
    if (raw.length > 0) {
      const data = VigiMat.processData(raw);
      updateUI(data);
      
      const badge = document.getElementById('conn-badge');
      const dot = document.getElementById('conn-dot');
      const text = document.getElementById('conn-text');
      dot.className = 'conn-dot online';
      text.textContent = 'Actualizado agora';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
