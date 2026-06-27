/* ══════════════════════════════════════════════════
   PRO-VigiMAT — App Logic
   Simulated IoT: TX1, TX2 (LoRa emitters) + RX (receiver)
   IRM: Índice de Risco de Malária
══════════════════════════════════════════════════ */
'use strict';

/* ── CONFIG ── */
const CFG = {
  interval: 5000,
  irmMed: 35,
  irmHigh: 65,
  histMax: 22,
  evtMax:  50,
  useRealData: true, // Switched to true for real Firebase integration
  apiEndpoint: '' 
};

/* ── STATE ── */
const S = {
  tx1: { t:0, h:0, w:false, rssi:-110, on:false },
  tx2: { t:0, h:0, w:false, rssi:-110, on:false },
  rx:  { pkts:0, sync:'--:--:--', wifi:true, lora:false },
  irm: 0, risk:'low',
  hist: { lbl:[], t1:[], t2:[], hum:[], irm:[] },
  events: [], alerts: [],
  uptime: 0, crcErr: 0,
  systemStatus: 'inactive',
};

/* ── BOOT CONTROL STATE ── */
window.startupPeriodElapsed = false;
window.newReadingReceivedDuringStartup = false;
window.lastVigiMatResult = null;
window.initialLatestTimestamp = null;

/* ── COMMUNICATION TEST STATE ── */
// Each module has independent packet loss tracking per the academic methodology:
// TPP (Taxa de Perda de Pacotes) = ((Pkts_enviados - Pkts_recebidos) / Pkts_enviados) × 100
const TX_MODULES = [
  { id: 'tx1', label: 'TX1', name: 'Emissor 1' },
  { id: 'tx2', label: 'TX2', name: 'Emissor 2' }
];

const commTestState = {};
TX_MODULES.forEach(m => {
  commTestState[m.id] = {
    id: m.id,
    label: m.label,
    name: m.name,
    status: 'idle',
    pktsSent: null,
    pktsReceived: null,
    lossPct: null,
    lastRun: null
  };
});
const testLogs = [];

/* Sparkline history */
const spk1H = [], spk2H = [];
const histLog = [];
let timer;
let inactivityTimer;

/* ── UTILS ── */
const rand  = (a,b) => +(Math.random()*(b-a)+a).toFixed(1);
const randI = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const jitter = (v, range) => +(v + (Math.random() - 0.5) * range).toFixed(1);
const now   = () => new Date().toLocaleTimeString('pt-BR',{hour12:false});
const today = () => new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});

/* ══════════════════════════════════════════════════
   PRELOADER
══════════════════════════════════════════════════ */
const PL_MSGS = [
  'A ligar aos sensores...','A verificar as zonas monitorizadas...',
  'A analisar condições ambientais...','Quase pronto...','Bem-vindo ao PRO-VigiMAT.'
];
function startPreloader(){
  let i=0;
  const el = document.getElementById('pl-msg');
  const iv = setInterval(()=>{ if(el && i<PL_MSGS.length) el.textContent=PL_MSGS[i++]; else clearInterval(iv); },480);
  setTimeout(()=>{ document.getElementById('preloader').classList.add('gone'); boot(); },2600);
}

/* ══════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════ */
function startClock(){
  const tick=()=>{
    const c=document.getElementById('clock'); const d=document.getElementById('cdate');
    if(c) c.textContent=now(); if(d) d.textContent=today();
  };
  tick(); setInterval(tick,1000);
}

/* ══════════════════════════════════════════════════
   SIDEBAR / NAV
══════════════════════════════════════════════════ */
window.toggleSidebar = ()=>{ document.getElementById('sidebar').classList.toggle('open'); document.getElementById('overlay').classList.toggle('open'); };
window.closeSidebar  = ()=>{ document.getElementById('sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); };

function initNav(){
  document.querySelectorAll('.sb-item').forEach(el=>{
    el.addEventListener('click',e=>{
      e.preventDefault();
      const sec = el.dataset.sec;
      document.querySelectorAll('.sb-item').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('.sec').forEach(x=>x.classList.remove('active'));
      const s=document.getElementById('sec-'+sec);
      if(s){ 
        s.classList.add('active'); 
        if(sec==='historico') drawIrmHistChart();
        if(sec==='avisos-malaria') renderMalariaWarnings();
        if(sec==='testes') { renderDistanceTests(); renderTestLogs(); }
      }
      closeSidebar();
    });
  });
}

/* ══════════════════════════════════════════════════
   IRM CALCULATION
══════════════════════════════════════════════════ */
function calcIRM(a,b){
  let t, h;
  if (a.on && b.on) {
    t = (a.t + b.t) / 2;
    h = (a.h + b.h) / 2;
  } else if (a.on) {
    t = a.t;
    h = a.h;
  } else if (b.on) {
    t = b.t;
    h = b.h;
  } else {
    return 0;
  }
  const water = (a.on && a.w ? 1 : 0) + (b.on && b.w ? 1 : 0);
  /* Temperature score: optimal 25–35°C for Anopheles */
  let ts=0;
  if(t>=25&&t<=35)    ts=40*(1-Math.abs(t-30)/10);
  else if(t>35)       ts=Math.max(0,40-(t-35)*3);
  else                ts=Math.max(0,20-(25-t)*4);
  /* Humidity score */
  const hs=clamp((h-40)/60*35,0,35);

  if (water === 0) {
    return Math.round(clamp(ts + hs, 0, 30)); // Capped at 30 (Low risk) when no water is detected
  }

  /* Water score based on stagnation count */
  let ws = 0;
  if (a.on && a.w) {
    const stag = a.stagnation || 0;
    ws += Math.min(12.5, 5 + stag * 1.25);
  }
  if (b.on && b.w) {
    const stag = b.stagnation || 0;
    ws += Math.min(12.5, 5 + stag * 1.25);
  }
  return Math.round(clamp(ts+hs+ws,0,100));
}

function riskOf(irm){
  return irm>=CFG.irmHigh?'high':irm>=CFG.irmMed?'medium':'low';
}

const riskPT = r=>({low:'BAIXO',medium:'MÉDIO',high:'ALTO'}[r]||'--');

/* ══════════════════════════════════════════════════
   DATA ACQUISITION (FIREBASE INTEGRATION)
══════════════════════════════════════════════════ */

function handleInactivity() {
  // Mark system as inactive and reset sensor and dashboard data
  S.systemStatus = 'inactive';
  // Reset sensor states
  S.tx1 = { t: 0, h: 0, w: false, rssi: -110, on: false };
  S.tx2 = { t: 0, h: 0, w: false, rssi: -110, on: false };
  // Reset receiver and risk metrics
  S.rx = { pkts: 0, sync: '--', wifi: false, lora: false };
  S.irm = 0;
  S.risk = 'low';
  S.stagnationMsg = '';
  // Clear historical data arrays
  S.hist = { lbl: [], t1: [], t2: [], hum: [], irm: [] };
  // Update UI to reflect inactive state
  renderAll();
  showToast('Sistema Inactivo', 'Não foram recebidos novos dados no último minuto.', 'danger', 'signal');
}

function resetInactivityTimer() {
  S.systemStatus = 'active';
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(handleInactivity, 60000); // 1 minute
}

function initFirebase() {
  VigiMat.init();
  VigiMat.firebase.onReadingsUpdate((rawReadings) => {
    if (rawReadings.length > 0) {
      const result = VigiMat.processData(rawReadings);
      applyVigiMatToState(result);
      renderAll();
    }
  });
}

function applyVigiMatToState(result) {
  window.lastVigiMatResult = result;
  const latest = result.readings[0] || {};
  
  if (window.initialLatestTimestamp === null) {
    window.initialLatestTimestamp = latest.timestamp || 0;
  }
  
  const isNewReading = latest.timestamp && latest.timestamp > window.initialLatestTimestamp;

  if (isNewReading) {
    window.initialLatestTimestamp = latest.timestamp;
    if (!window.startupPeriodElapsed) {
      window.newReadingReceivedDuringStartup = true;
    } else {
      resetInactivityTimer();
    }
  }

  if (!window.startupPeriodElapsed) {
    S.systemStatus = 'inactive';
  }

  // Detect whether each node is online based on whether a positive temperature reading is received
  const tx1Active = S.systemStatus === 'active' && latest.temp1 !== undefined && parseFloat(latest.temp1) > 0;
  const tx2Active = S.systemStatus === 'active' && latest.temp2 !== undefined && parseFloat(latest.temp2) > 0;

  // Map VigiMat data directly without artificial jitter/mocks
  S.tx1 = { 
    t: latest.temp1 || 0, 
    h: latest.hum1 || 0, 
    w: (latest.rain1 < 2000), 
    rssi: tx1Active ? -65 : -110, 
    on: tx1Active,
    stagnation: result.summary.tx1Stagnation || 0
  };
  
  S.tx2 = { 
    t: latest.temp2 || 0, 
    h: latest.hum2 || 0, 
    w: (latest.rain2 < 2000), 
    rssi: tx2Active ? -70 : -110, 
    on: tx2Active,
    stagnation: result.summary.tx2Stagnation || 0
  };

  // Calculate IRM per module and overall
  if (S.systemStatus === 'active') {
    // Overall IRM
    S.irm = calcIRM(S.tx1, S.tx2);
    // Per‑module IRM (using dummy inactive counterpart)
    S.irmTx1 = calcIRM(S.tx1, {on:false,w:false,stagnation:0});
    S.irmTx2 = calcIRM(S.tx2, {on:false,w:false,stagnation:0});
    S.risk = riskOf(S.irm);

    // Sync totals and metadata
    S.rx.pkts = result.summary.totalReadings;
    S.rx.sync = new Date((latest.timestamp || 0) * 1000).toLocaleTimeString();
    S.rx.lora = S.tx1.on || S.tx2.on;
  } else {
    S.irm = 0;
    S.risk = 'low';
    S.stagnationMsg = '';
    S.tx1Stagnation = 0;
    S.tx2Stagnation = 0;
    S.rx.pkts = 0;
    S.rx.sync = '--:--:--';
    S.rx.lora = false;
  }

  // Sync Alerts with Deduplication
  const incomingAlerts = result.alerts.map(a => ({
    title: a.title,
    msg: a.message,
    sev: a.severity,
    icon: a.icon,
    time: new Date(a.timestamp * 1000).toLocaleTimeString('pt-BR', {hour12:false}),
    rawTime: a.timestamp
  }));

  if (S.systemStatus === 'active') {
    incomingAlerts.forEach(na => {
      const exists = S.alerts.some(oa => oa.rawTime === na.rawTime && oa.title === na.title);
      if (!exists) {
        S.alerts.unshift(na);
        showToast(na.title, na.msg, na.sev, na.icon);
        addEvt('SISTEMA', na.title, na.msg, na.sev === 'danger' ? 'danger' : 'warn');
      }
    });

    // Keep last 20 alerts in history
    S.alerts = S.alerts.slice(0, 20);
    
    updateBadge();
    renderAlertLog();

    syncMalariaWarningsFromAlerts(result);

    // Populate history for charts
    S.hist.lbl = result.chartData.temperature.map(d => d.timestamp).slice(-CFG.histMax);
    S.hist.t1 = result.readings.map(r => r.temp1).reverse().slice(-CFG.histMax);
    S.hist.t2 = result.readings.map(r => r.temp2).reverse().slice(-CFG.histMax);
    S.hist.hum = result.chartData.humidity.map(d => d.value).slice(-CFG.histMax);
    S.hist.irm = result.chartData.risk.map(d => d.value * 33).slice(-CFG.histMax); // Map 1,2,3 to 0-100 scale

    if (isNewReading) {
      triggerNewReadingIndicator('tx1');
      triggerNewReadingIndicator('tx2');
    }
  } else {
    S.alerts = [];
    updateBadge();
    renderAlertLog();
    S.hist = { lbl: [], t1: [], t2: [], hum: [], irm: [] };
  }
}

function triggerNewReadingIndicator(id) {
  const container = document.getElementById(`${id}-new-tag-container`);
  if (!container) return;
  
  // Clear previous if still animating
  container.innerHTML = '';
  
  const tag = document.createElement('span');
  tag.className = 'new-reading-tag';
  tag.textContent = 'Dados actualizados';
  
  container.appendChild(tag);
  
  // Cleanup after animation finishes (matching CSS duration)
  setTimeout(() => {
    if (tag.parentNode === container) {
      container.removeChild(tag);
    }
  }, 1600);
}

/**
 * Legacy simulation wrapper.
 * In Firebase mode, this becomes a manual refresh if needed.
 */
async function simulate() {
  if (!CFG.useRealData) {
    // Logic for simulation if still needed
  }
}

/* ══════════════════════════════════════════════════
   EVENTS & ALERTS
══════════════════════════════════════════════════ */
function doAlerts(prev1,prev2){
  /* Water */
  if(S.tx1.w  &&!prev1.w) { addEvt('TX1','Água detectada',`${S.tx1.t}°C/${S.tx1.h}%`,'danger'); pushAlert('Água na zona TX1',`Foi detectada água parada. Temperatura ${S.tx1.t}°C, humidade ${S.tx1.h}%.`,'danger','water'); }
  if(S.tx2.on&&S.tx2.w&&!prev2.w){ addEvt('TX2','Água detectada',`${S.tx2.t}°C/${S.tx2.h}%`,'danger'); pushAlert('Água na zona TX2',`Foi detectada água parada. Temperatura ${S.tx2.t}°C, humidade ${S.tx2.h}%.`,'danger','water'); }
  /* Offline */
  if(!S.tx1.on&&prev1.on){ addEvt('TX1','Sem comunicação','Sem resposta','danger'); pushAlert('TX1 indisponível','O sensor TX1 deixou de responder.','danger','signal'); }
  if(!S.tx2.on&&prev2.on){ addEvt('TX2','Sem comunicação','Sem resposta','danger'); pushAlert('TX2 indisponível','O sensor TX2 deixou de responder.','danger','signal'); }
  /* Back online */
  if(S.tx1.on&&!prev1.on){ addEvt('TX1','Ligação restabelecida','Comunicação activa','ok'); pushAlert('TX1 disponível','O sensor TX1 voltou a responder.','info','check'); }
  if(!S.tx2.on&&prev2.on){ addEvt('TX2','Ligação restabelecida','Comunicação activa','ok'); pushAlert('TX2 disponível','O sensor TX2 voltou a responder.','info','check'); }
  /* IRM level change */
  const prev = riskOf(S.hist.irm.slice(-2)[0] || 0);
  if (S.risk !== prev) {
    addEvt('Sistema','Nível de risco alterado',`${S.irm}/100 — ${riskPT(S.risk)}`,S.risk==='high'?'danger':S.risk==='medium'?'warn':'ok');
    if (S.risk==='high')   pushAlert('Risco elevado',`O índice de risco subiu para ${S.irm}/100. Condições desfavoráveis.`,'danger','alert');
    if (S.risk==='medium') pushAlert('Risco moderado',`O índice de risco está em ${S.irm}/100. Mantenha-se atento.`,'warn','warning');
    // Per‑node high‑risk detection moved outside this block
    // Per‑node high‑risk detection
    if (S.tx1.on) {
      const irmTx1 = calcIRM(S.tx1, {on:false,w:false,stagnation:0});
      if (irmTx1 >= 65) {
        addEvt('TX1','Risco elevado',`Índice de risco ${irmTx1}/100`,'danger');
        pushAlert('Risco elevado TX1',`O índice de risco para TX1 subiu para ${irmTx1}/100.`,'danger','alert');
      }
    }
    if (S.tx2.on) {
      const irmTx2 = calcIRM(S.tx2, {on:false,w:false,stagnation:0});
      if (irmTx2 >= 65) {
        addEvt('TX2','Risco elevado',`Índice de risco ${irmTx2}/100`,'danger');
        pushAlert('Risco elevado TX2',`O índice de risco para TX2 subiu para ${irmTx2}/100.`,'danger','alert');
      }
    }
    addHistLog();
  }
}

function addEvt(dev,evt,val,st){
  S.events.unshift({time:now(),dev,evt,val,st});
  if(S.events.length>CFG.evtMax) S.events.pop();
  renderEvents();
}

function pushAlert(title,msg,sev,icon){
  S.alerts.unshift({title,msg,sev,icon,time:now()});
  updateBadge();
  renderAlertLog();
  showToast(title,msg,sev,icon);
}

function addHistLog(){
  histLog.unshift({
    time:now(),
    t1t:S.tx1.on?`${S.tx1.t}°C`:'--', t1h:S.tx1.on?`${S.tx1.h}%`:'--', t1w:S.tx1.on?(S.tx1.w?'Sim':'Não'):'--',
    t2t:S.tx2.on?`${S.tx2.t}°C`:'--', t2h:S.tx2.on?`${S.tx2.h}%`:'--', t2w:S.tx2.on?(S.tx2.w?'Sim':'Não'):'--',
    irm:S.irm, risk:riskPT(S.risk)
  });
  if(histLog.length>100) histLog.pop();
  renderHistLog();
}

/* ══════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════ */
function renderAll(){
  renderKPIs();
  renderTX('tx1'); renderTX('tx2');
  renderRX();
  renderIRM();
  drawHistChart();
  drawSpk('spk1',spk1H);
  drawSpk('spk2',spk2H);
  renderSensorDetail();
}

/* ── KPIs ── */
function renderKPIs(){
  /* Temperatura — TX1 e TX2 individualmente (sem média) */
  const t1Str = S.tx1.on ? `${S.tx1.t}°C` : '--°C';
  const t2Str = S.tx2.on ? `${S.tx2.t}°C` : '--°C';
  const kpiTemp = document.getElementById('kpi-temp');
  if (kpiTemp) kpiTemp.innerHTML = `TX1: <strong>${t1Str}</strong><br>TX2: <strong>${t2Str}</strong>`;

  /* Humidade — TX1 e TX2 individualmente (sem média) */
  const h1Str = S.tx1.on ? `${S.tx1.h}%` : '--%';
  const h2Str = S.tx2.on ? `${S.tx2.h}%` : '--%';
  const kpiHum = document.getElementById('kpi-hum');
  if (kpiHum) kpiHum.innerHTML = `TX1: <strong>${h1Str}</strong><br>TX2: <strong>${h2Str}</strong>`;

  /* Água */
  const wc=(S.tx1.w?1:0)+(S.tx2.on&&S.tx2.w?1:0);
  const we=document.getElementById('kpi-water');
  if(we){ we.textContent=wc?`${wc} sensor(es)`:'Não detectada'; we.style.color=wc?'var(--danger)':'var(--accent2)'; }
  
  const waterHint = document.getElementById('kpi-water-h');
  if (waterHint) {
    if (S.stagnationMsg) {
      waterHint.textContent = S.stagnationMsg;
      waterHint.style.color = 'var(--danger)';
      waterHint.style.fontWeight = 'bold';
    } else {
      waterHint.textContent = wc ? 'Criadouro potencial' : 'Ambiente seco';
      waterHint.style.color = 'var(--text3)';
      waterHint.style.fontWeight = 'normal';
    }
  }

  set('kpi-irm', `${S.irm}/100`);
  const pill=document.getElementById('kpi-risk-pill');
  if(pill){ pill.textContent=riskPT(S.risk); pill.className=`risk-pill ${S.risk}`; }

  /* Hints contextuais baseados em TX1 (sensor de referência primário) */
  const tempHint = document.getElementById('kpi-temp-h');
  if (tempHint && S.tx1.on) {
    const t = S.tx1.t;
    tempHint.textContent = t >= 25 && t <= 35 ? 'Condição favorável a mosquitos' : t > 35 ? 'Calor elevado' : 'Temperatura baixa';
  }
  const humHint = document.getElementById('kpi-hum-h');
  if (humHint && S.tx1.on) {
    const h = S.tx1.h;
    humHint.textContent = h >= 70 ? 'Humidade elevada' : h >= 50 ? 'Humidade moderada' : 'Ar relativamente seco';
  }
}

/* ── TX CARD ── */
function renderTX(id){
  const tx=S[id];

  /* Per‑module IRM: treat the other transmitter as offline */
  const irmVal = tx.on ? calcIRM(tx, {on:false,w:false,stagnation:0}) : 0;
  const irmRisk = riskOf(irmVal);

  /* IRM value display */
  const irmEl = document.getElementById(`${id}-irm`);
  if (irmEl) {
    irmEl.textContent = tx.on ? `${irmVal}/100` : '--';
    const irmColors = { low:'var(--accent2)', medium:'var(--warn)', high:'var(--danger)' };
    irmEl.style.color = tx.on ? irmColors[irmRisk] : 'var(--text3)';
    irmEl.style.fontWeight = irmRisk === 'high' ? '700' : '600';
  }

  /* risk pill — based on IRM */
  const rp = document.getElementById(`${id}-risk-pill`);
  if (rp) {
    rp.className = `risk-pill ${irmRisk}`;
    rp.textContent = `RISCO ${riskPT(irmRisk)}`;
    rp.style.display = tx.on ? 'inline-block' : 'none';
  }

  /* status */
  const sEl=document.getElementById(`${id}-status`);
  if(sEl){ sEl.className=`tx-status ${tx.on?'online':'offline'}`; sEl.innerHTML=`<span class="st-dot"></span>${tx.on?'ONLINE':'OFFLINE'}`; }
  /* lora anim */
  const la=document.getElementById(`${id}-lora`);
  if(la) la.className=`lora-bars${tx.on?'':' off'}`;
  /* metrics */
  set(`${id}-temp`,  tx.on?`${tx.t}°C`:'--');
  set(`${id}-hum`,   tx.on?`${tx.h}%` :'--');
  set(`${id}-rssi`,  tx.on?`${tx.rssi} dBm`:'--');
  const wEl=document.getElementById(`${id}-water`);
  if(wEl){
    if(!tx.on){ wEl.textContent='--'; wEl.className='txm-val water-val'; }
    else if(tx.w){ wEl.textContent='DETECTADA'; wEl.className='txm-val water-val detected'; }
    else{ wEl.textContent='AUSENTE'; wEl.className='txm-val water-val undetected'; }
  }
  /* signal bars */
  const pct=clamp((tx.rssi+102)/50,0,1);
  const lit=Math.round(pct*5);
  document.querySelectorAll(`#${id}-sig span`).forEach((b,i)=>b.classList.toggle('lit',tx.on&&i<lit));
}

/* ── RX CARD ── */
function renderRX(){
  set('rx-pkts', S.rx.pkts);
  set('rx-sync', S.rx.sync);
  const lEl=document.getElementById('rx-lora');
  if(lEl){
    if (S.systemStatus === 'inactive') {
      lEl.textContent='INACTIVO';
      lEl.className=`rxs-val offline`;
    } else {
      lEl.textContent=S.rx.lora?'ACTIVO':'SEM SINAL';
      lEl.className=`rxs-val ${S.rx.lora?'online':'offline'}`;
    }
  }
  /* Navbar pill */
  const led=document.getElementById('rx-led'), st=document.getElementById('rx-st');
  if(led) {
    if (S.systemStatus === 'inactive') {
        led.className=`rx-led off`;
    } else {
        led.className=`rx-led${S.rx.lora?'':' off'}`;
    }
  }
  if(st){
    if (S.systemStatus === 'inactive') {
        st.textContent='INACTIVO';
        st.className=`rx-st off`;
    } else {
        st.textContent=S.rx.lora?'ONLINE':'OFFLINE';
        st.className=`rx-st${S.rx.lora?'':' off'}`;
    }
  }
}

/* ── IRM ── */
function renderIRM(){
  set('irm-score', S.irm);
  const card=document.getElementById('irm-card');
  if(card) card.className=`irm-card risk-${S.risk}`;
  const badge=document.getElementById('irm-badge');
  if(badge) badge.className=`irm-risk-badge ${S.risk}`;
  set('irm-badge-txt', `RISCO ${riskPT(S.risk)}`);
  const scoreEl=document.getElementById('irm-score');
  const scoreColors={low:'var(--accent2)',medium:'var(--warn)',high:'var(--danger)'};
  if(scoreEl) scoreEl.style.color=scoreColors[S.risk];
  /* factor bars */
  const avgT=(S.tx1.t+S.tx2.t)/2, avgH=(S.tx1.h+S.tx2.h)/2;
  const water=(S.tx1.w?1:0)+(S.tx2.w?1:0);
  fillBar('if-temp',  clamp((avgT-18)/22*100,0,100));
  fillBar('if-hum',   clamp((avgH-28)/70*100,0,100));
  fillBar('if-water', water*50);
  drawGauge(S.irm,S.risk);

  /* prevention alert area */
  const alertArea = document.getElementById('irm-prevention-alert');
  const alertMsg = document.getElementById('irm-prevention-msg');
  if (alertArea && alertMsg) {
    if (S.stagnationMsg) {
      alertArea.style.display = 'block';
      alertMsg.textContent = S.stagnationMsg;
    } else {
      alertArea.style.display = 'none';
    }
  }
}

function fillBar(id,pct){
  const el=document.getElementById(id); if(!el) return;
  el.style.width=`${pct}%`;
  el.style.background=pct>65?'var(--danger)':pct>35?'var(--warn)':'var(--accent)';
}

/* ── SENSOR DETAIL ── */
function renderSensorDetail(){
  set('sc-t1-temp', S.tx1.on?`${S.tx1.t}°C`:'--');
  set('sc-t1-hum',  S.tx1.on?`${S.tx1.h}%` :'--');
  set('sc-t1-rssi', S.tx1.on?`${S.tx1.rssi} dBm`:'--');
  const s1=document.getElementById('sc-t1-state'); if(s1){ s1.textContent=S.tx1.on?'Online':'Offline'; s1.className=S.tx1.on?'online':'offline'; }
  set('sc-t2-temp', S.tx2.on?`${S.tx2.t}°C`:'--');
  set('sc-t2-hum',  S.tx2.on?`${S.tx2.h}%` :'--');
  set('sc-t2-rssi', S.tx2.on?`${S.tx2.rssi} dBm`:'--');
  const s2=document.getElementById('sc-t2-state'); if(s2){ s2.textContent=S.tx2.on?'Online':'Offline'; s2.className=S.tx2.on?'online':'offline'; }
  set('sc-rx-pkts', S.rx.pkts);
  set('sc-rx-err',  S.crcErr);
  set('sc-rx-up',   `${Math.floor(S.uptime*CFG.interval/60000)} min`);
}

function renderEvents(){
  const tb=document.getElementById('evt-tbody'); if(!tb) return;
  if(!S.events.length){ tb.innerHTML='<tr><td colspan="5" class="tbl-empty">Nenhuma actividade recente.</td></tr>'; return; }
  tb.innerHTML=S.events.slice(0,20).map(e=>`
    <tr>
      <td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text3)">${e.time}</td>
      <td style="color:var(--accent);font-weight:600">${e.dev}</td>
      <td style="color:var(--text)">${e.evt}</td>
      <td style="font-family:var(--font-mono)">${e.val}</td>
      <td><span class="tag ${e.st}">${e.st.toUpperCase()}</span></td>
    </tr>`).join('');
}

window.clearEvents=()=>{ S.events=[]; renderEvents(); };

function renderHistLog(){
  const tb=document.getElementById('log-tbody'); if(!tb) return;
  tb.innerHTML=histLog.slice(0,50).map(r=>`
    <tr>
      <td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text3)">${r.time}</td>
      <td style="font-family:var(--font-mono)">${r.t1t}</td><td>${r.t1h}</td><td>${r.t1w}</td>
      <td style="font-family:var(--font-mono)">${r.t2t}</td><td>${r.t2h}</td><td>${r.t2w}</td>
      <td style="font-family:var(--font-mono);font-weight:700;color:var(--accent)">${r.irm}</td>
      <td><span class="tag ${r.risk==='ALTO'?'danger':r.risk==='MÉDIO'?'warn':'ok'}">${r.risk}</span></td>
    </tr>`).join('');
}

function renderAlertLog(){
  const el=document.getElementById('alert-log'); if(!el) return;
  if(!S.alerts.length){ el.innerHTML='<p class="tbl-empty" style="padding:3rem;text-align:center">Nenhuma situação de alerta por agora.</p>'; return; }
  el.innerHTML=S.alerts.map(a=>`
    <div class="al-entry ${a.sev}">
      <span class="al-icon">${getIconSVG(a.icon)}</span>
      <div><div class="al-title">${a.title}</div><div class="al-msg">${a.msg}</div><div class="al-time">${a.time}</div></div>
    </div>`).join('');
}

window.clearAlerts=()=>{ S.alerts=[]; updateBadge(); renderAlertLog(); };

function updateBadge(){
  const el=document.getElementById('sb-badge'); if(!el) return;
  el.textContent=S.alerts.length;
  el.style.display=S.alerts.length?'flex':'none';
}

/* ══════════════════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════════════════ */
const toastQ=[]; let toastBusy=false;
function showToast(title,msg,sev,icon){
  toastQ.push({title,msg,sev,icon});
  if(!toastBusy) drainToast();
}
const iconMap={
  'signal':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 17h20v4H2z"/><path d="M2 10h4v4H2z" opacity=".3"/><path d="M10 10h4v4h-4z" opacity=".6"/><path d="M18 10h4v4h-4z"/></svg>',
  'check':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
  'alert':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'warning':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  'settings':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24"/></svg>',
  'water':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>'
};
function getIconSVG(key){
  if(!key||!key.includes('<')) return iconMap[key]||'';
  return key;
}
function drainToast(){
  if(!toastQ.length){ toastBusy=false; return; }
  toastBusy=true;
  const n=toastQ.shift();
  const wrap=document.getElementById('toast-wrap');
  const el=document.createElement('div');
  el.className=`toast ${n.sev}`;
  el.innerHTML=`<span class="toast-icon">${getIconSVG(n.icon)}</span><div><div class="toast-title">${n.title}</div><div class="toast-msg">${n.msg}</div></div>`;
  wrap.appendChild(el);
  el.addEventListener('click',()=>dismiss(el));
  setTimeout(()=>el.classList.add('show'),20);
  setTimeout(()=>{ dismiss(el); setTimeout(drainToast,300); },5000);
}
function dismiss(el){ el.classList.remove('show'); setTimeout(()=>el.remove(),350); }

/* ══════════════════════════════════════════════════
   CANVAS DRAWING
══════════════════════════════════════════════════ */

/* IRM Semi-circle gauge */
function drawGauge(val,risk){
  const c=document.getElementById('irm-gauge'); if(!c) return;
  const ctx=c.getContext('2d');
  const W=c.width,H=c.height,cx=W/2,cy=H-8;
  const r=Math.min(W,H*2)/2-16;
  ctx.clearRect(0,0,W,H);
  /* track */
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI);
  ctx.strokeStyle='#dce8f5'; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
  /* fill */
  const colorMap={low:'#059669',medium:'#b45309',high:'#dc2626'};
  const fillEnd=Math.PI+(val/100)*Math.PI;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,fillEnd);
  ctx.strokeStyle=colorMap[risk]; ctx.lineWidth=14; ctx.lineCap='round';
  ctx.shadowColor=colorMap[risk]; ctx.shadowBlur=10;
  ctx.stroke(); ctx.shadowBlur=0;
  /* ticks */
  for(let i=0;i<=10;i++){
    const a=Math.PI+(i/10)*Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx+(r-20)*Math.cos(a),cy+(r-20)*Math.sin(a));
    ctx.lineTo(cx+(r-26)*Math.cos(a),cy+(r-26)*Math.sin(a));
    ctx.strokeStyle='rgba(0,30,80,.15)'; ctx.lineWidth=i%5===0?2:1;
    ctx.lineCap='square'; ctx.shadowBlur=0; ctx.stroke();
  }
  /* labels */
  ctx.font='10px "Outfit"'; ctx.fillStyle='rgba(0,30,80,.35)'; ctx.textAlign='center';
  ctx.fillText('0',cx-r+8,cy+4); ctx.fillText('50',cx,cy-r+14); ctx.fillText('100',cx+r-8,cy+4);
}

/* TX Sparklines */
function drawSpk(id,data){
  const c=document.getElementById(id); if(!c||data.length<2) return;
  c.width=c.offsetWidth||200;
  const ctx=c.getContext('2d'), W=c.width, H=c.height;
  ctx.clearRect(0,0,W,H);
  const mn=Math.min(...data)-1, mx=Math.max(...data)+1;
  const toX=i=>(i/(data.length-1))*W;
  const toY=v=>H-((v-mn)/(mx-mn))*(H-6)-3;
  /* grid */
  ctx.strokeStyle='rgba(0,30,80,.06)'; ctx.lineWidth=1;
  [.33,.67].forEach(f=>{ ctx.beginPath(); ctx.moveTo(0,H*f); ctx.lineTo(W,H*f); ctx.stroke(); });
  /* area */
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(0,119,204,.15)'); g.addColorStop(1,'rgba(0,119,204,0)');
  ctx.beginPath(); ctx.moveTo(toX(0),H);
  data.forEach((v,i)=>ctx.lineTo(toX(i),toY(v)));
  ctx.lineTo(toX(data.length-1),H); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
  /* line */
  ctx.beginPath();
  data.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)));
  ctx.strokeStyle='var(--accent)'; ctx.lineWidth=2; ctx.lineJoin='round';
  ctx.shadowColor='rgba(0,119,204,.4)'; ctx.shadowBlur=5;
  ctx.stroke(); ctx.shadowBlur=0;
  /* dot */
  const lx=toX(data.length-1),ly=toY(data[data.length-1]);
  ctx.beginPath(); ctx.arc(lx,ly,3.5,0,Math.PI*2);
  ctx.fillStyle='var(--accent)'; ctx.shadowColor='rgba(0,119,204,.5)'; ctx.shadowBlur=8;
  ctx.fill(); ctx.shadowBlur=0;
}

/* History multi-line chart */
function drawHistChart(){
  const c=document.getElementById('hist-chart'); if(!c) return;
  c.width=c.offsetWidth||500; c.height=180;
  const ctx=c.getContext('2d'), W=c.width, H=c.height;
  const {lbl,t1,t2,hum}=S.hist;
  if(lbl.length<2) return;
  ctx.clearRect(0,0,W,H);
  const all=[...t1,...t2,...hum].filter(x=>x!==null);
  if(!all.length) return;
  const mn=Math.min(...all)-2, mx=Math.max(...all)+2;
  const n=lbl.length;
  const toX=i=>(i/(n-1))*(W-30)+15;
  const toY=v=>H-((v-mn)/(mx-mn))*(H-24)-12;
  /* grid */
  ctx.strokeStyle='rgba(0,30,80,.06)'; ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=H-(i/4)*(H-24)-12;
    ctx.beginPath(); ctx.moveTo(15,y); ctx.lineTo(W-15,y); ctx.stroke();
    ctx.fillStyle='rgba(0,30,80,.25)'; ctx.font='10px Outfit';
    ctx.textAlign='right'; ctx.fillText(Math.round(mn+(i/4)*(mx-mn)),12,y+4);
  }
  /* x labels */
  ctx.fillStyle='rgba(0,30,80,.25)'; ctx.font='9px Outfit'; ctx.textAlign='center';
  [0,Math.floor(n/2),n-1].forEach(i=>{ if(lbl[i]) ctx.fillText(lbl[i],toX(i),H); });
  /* draw line helper */
  const line=(data,color,dash=false)=>{
    ctx.beginPath(); let mv=false;
    data.forEach((v,i)=>{ if(v===null){mv=false;return;} if(!mv){ctx.moveTo(toX(i),toY(v));mv=true;}else ctx.lineTo(toX(i),toY(v)); });
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round';
    if(dash) ctx.setLineDash([4,3]); else ctx.setLineDash([]);
    ctx.shadowColor=color; ctx.shadowBlur=5; ctx.stroke(); ctx.shadowBlur=0; ctx.setLineDash([]);
  };
  line(hum,'rgba(96,165,250,.55)',true);
  line(t2,'#059669');
  line(t1,'#0077cc');
}

/* IRM history chart (Histórico section) */
function drawIrmHistChart(){
  const c=document.getElementById('irm-hist-chart'); if(!c) return;
  c.width=c.offsetWidth||600;
  const ctx=c.getContext('2d'), W=c.width, H=c.height||180;
  c.height=H;
  const {lbl,irm}=S.hist;
  if(lbl.length<2) return;
  ctx.clearRect(0,0,W,H);
  const n=lbl.length;
  const toX=i=>(i/(n-1))*(W-30)+15;
  const toY=v=>H-((v/100))*(H-24)-12;
  const med = CFG.irmMed;
  const high = CFG.irmHigh;
  /* risk zones */
  ctx.fillStyle='rgba(220,38,38,.06)';  ctx.fillRect(15,toY(100),W-30,toY(high)-toY(100));
  ctx.fillStyle='rgba(180,83,9,.06)';   ctx.fillRect(15,toY(high),W-30,toY(med)-toY(high));
  ctx.fillStyle='rgba(5,150,105,.04)';  ctx.fillRect(15,toY(med),W-30,toY(0)-toY(med));
  /* grid */
  ctx.strokeStyle='rgba(0,30,80,.06)'; ctx.lineWidth=1;
  [0,25,50,75,100].forEach(v=>{
    ctx.beginPath(); ctx.moveTo(15,toY(v)); ctx.lineTo(W-15,toY(v)); ctx.stroke();
    ctx.fillStyle='rgba(0,30,80,.25)'; ctx.font='10px Outfit'; ctx.textAlign='right'; ctx.fillText(v,12,toY(v)+4);
  });
  /* area */
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(220,38,38,.18)'); g.addColorStop(.5,'rgba(180,83,9,.1)'); g.addColorStop(1,'rgba(5,150,105,.05)');
  ctx.beginPath(); ctx.moveTo(toX(0),H);
  irm.forEach((v,i)=>ctx.lineTo(toX(i),toY(v)));
  ctx.lineTo(toX(n-1),H); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
  /* line */
  ctx.beginPath(); irm.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)));
  ctx.strokeStyle='#dc2626'; ctx.lineWidth=2.5; ctx.lineJoin='round';
  ctx.shadowColor='rgba(220,38,38,.3)'; ctx.shadowBlur=8; ctx.stroke(); ctx.shadowBlur=0;
  /* dots on data points */
  irm.forEach((v,i)=>{
    const c2=v>=high?'#dc2626':v>=med?'#b45309':'#059669';
    ctx.beginPath(); ctx.arc(toX(i),toY(v),3,0,Math.PI*2);
    ctx.fillStyle=c2; ctx.fill();
  });
}

/* ══════════════════════════════════════════════════
   MALARIA RISK WARNINGS BY DISTRICT
══════════════════════════════════════════════════ */
const MAPS_LINK = 'https://www.google.com/maps/place/Universidade+Cat%C3%B3lica+de+Angola/@-8.8575547,13.2793057,17z/data=!3m1!4b1!4m6!3m5!1s0x1a51f14c3ecde783:0x25bc7ad1692d2f9b!8m2!3d-8.85756!4d13.2818806!16zL20vMGQ5eXNo?entry=ttu&g_ep=EgoyMDI2MDYxNi4wIKXMDSoASAFQAw%3D%3D';

const DISTRICTS_WARNINGS = [
  { 
    name: 'Zona Alpha — Posto 1', 
    risk: 'low', temp: 0, hum: 0, water: false, irm: 0, 
    cases: '--', coords: 'Universidade Católica de Angola',
    lastUpdate: '--'
  },
  { 
    name: 'Zona Alpha — Posto 2', 
    risk: 'low', temp: 0, hum: 0, water: false, irm: 0, 
    cases: '--', coords: 'Universidade Católica de Angola',
    lastUpdate: '--'
  }
];

let currentFilterMalaria = 'high';
let highRiskAlertActive = false;

/**
 * Avisos de Risco — activados por alertas do VigiMat AlertService:
 * IRM global ALTO (HIGH_RISK) ou estagnação de água ALTO (STAGNATION_* severity danger).
 */
function syncMalariaWarningsFromAlerts(result) {
  const hasGlobalHighRisk = result.alerts.some(a => a.type === 'HIGH_RISK');
  const hasTx1StagnationHigh = result.alerts.some(a => a.type === 'STAGNATION_TX1' && a.severity === 'danger');
  const hasTx2StagnationHigh = result.alerts.some(a => a.type === 'STAGNATION_TX2' && a.severity === 'danger');

  highRiskAlertActive = hasGlobalHighRisk || hasTx1StagnationHigh || hasTx2StagnationHigh;

  DISTRICTS_WARNINGS.forEach(d => { d.risk = 'low'; });

  if (!highRiskAlertActive) {
    renderMalariaWarnings();
    return;
  }

  if (DISTRICTS_WARNINGS[0] && (hasGlobalHighRisk || hasTx1StagnationHigh)) {
    DISTRICTS_WARNINGS[0].temp = S.tx1.t;
    DISTRICTS_WARNINGS[0].hum = S.tx1.h;
    DISTRICTS_WARNINGS[0].water = S.tx1.w;
    DISTRICTS_WARNINGS[0].irm = S.irm;
    DISTRICTS_WARNINGS[0].risk = 'high';
    DISTRICTS_WARNINGS[0].lastUpdate = now();
  }
  if (DISTRICTS_WARNINGS[1] && (hasGlobalHighRisk || hasTx2StagnationHigh)) {
    DISTRICTS_WARNINGS[1].temp = S.tx2.t;
    DISTRICTS_WARNINGS[1].hum = S.tx2.h;
    DISTRICTS_WARNINGS[1].water = S.tx2.w;
    DISTRICTS_WARNINGS[1].irm = S.irm;
    DISTRICTS_WARNINGS[1].risk = 'high';
    DISTRICTS_WARNINGS[1].lastUpdate = now();
  }
  renderMalariaWarnings();
}

function renderMalariaWarnings() {
  const container = document.getElementById('malaria-warnings-grid');
  if (!container) return;
  
  // User Requirement: Only show HIGH risk in this section
  const filtered = DISTRICTS_WARNINGS.filter(d => d.risk === 'high');
  
  if (!filtered.length) {
    container.innerHTML = '<div class="loading-state"><p>Por agora, nenhuma zona apresenta risco elevado.<br><span style="font-size:0.85rem;color:var(--text3)">A situação está sob controlo. Os avisos aparecem aqui quando for detectado perigo.</span></p></div>';
    return;
  }
  
  container.innerHTML = filtered.map(district => {
    const riskLabel = {low: 'BAIXO', medium: 'MÉDIO', high: 'ALTO'}[district.risk];
    
    return `
    <div class="malaria-card risk-${district.risk}">
      <div class="mc-header">
        <h3>${district.name}</h3>
        <span class="mc-risk-badge ${district.risk}">
          <span class="mc-risk-dot"></span>${riskLabel}
        </span>
      </div>
      
      <div class="mc-content">
        <div class="mc-row">
          <div class="mc-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 13.6V3a2 2 0 00-4 0v10.6A4 4 0 1013 13.6z"/></svg></div>
          <div class="mc-row-text">
            <div class="mc-row-label">Temperatura</div>
            <div class="mc-row-value">${district.temp}°C</div>
          </div>
        </div>
        
        <div class="mc-row">
          <div class="mc-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 2l5 9.5A6 6 0 1 1 6 11.5L11 2z"/></svg></div>
          <div class="mc-row-text">
            <div class="mc-row-label">Humidade</div>
            <div class="mc-row-value">${district.hum}%</div>
          </div>
        </div>
        
        <div class="mc-row">
          <div class="mc-row-icon">${district.water ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 2C8 7 4 11 4 14a7 7 0 0014 0C18 11 14 7 11 2z"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>'}</div>
          <div class="mc-row-text">
            <div class="mc-row-label">Água Presente</div>
            <div class="mc-row-value">${district.water ? 'Detectada' : 'Não detectada'}</div>
          </div>
        </div>
        
        <div class="mc-row">
          <div class="mc-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><polyline points="19 5 9 12 19 19"/></svg></div>
          <div class="mc-row-text">
            <div class="mc-row-label">IRM (Índice de Risco)</div>
            <div class="mc-row-value">${district.irm}/100</div>
          </div>
        </div>
        
        <div class="mc-row">
          <div class="mc-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
          <div class="mc-row-text">
            <div class="mc-row-label">Casos Confirmados</div>
            <div class="mc-row-value">${district.cases}</div>
          </div>
        </div>
        
        <div class="mc-coords"><svg class="inline-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="white"/></svg> ${district.coords}</div>
        
        <div class="mc-actions">
          <a href="${MAPS_LINK}" target="_blank" class="mc-btn mc-btn-primary">
            <svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Google Maps
          </a>
          <button class="mc-btn mc-btn-secondary" onclick="viewDistrictDetails('${district.name}')">
            <svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg> Detalhes
          </button>
        </div>
      </div>
    </div>
    `;
  }).join('');
}

window.filterMalariaWarnings = function(value) {
  currentFilterMalaria = value;
  renderMalariaWarnings();
};

window.refreshMalariaWarnings = function() {
  renderMalariaWarnings();
  showToast('Avisos actualizados', highRiskAlertActive
    ? 'Existem zonas com risco elevado neste momento.'
    : 'Nenhuma zona com risco elevado de momento.', 'info', 'refresh');
};

window.viewDistrictDetails = function(districtName) {
  const district = DISTRICTS_WARNINGS.find(d => d.name === districtName);
  if (!district) return;
  
  const message = `${district.name}: IRM ${district.irm}/100 (${riskPT(district.risk)}). Temperatura ${district.temp}°C, humidade ${district.hum}%. Actualizado às ${district.lastUpdate}.`;
  
  showToast(districtName, message, 'info', 'info');
};

/* ══════════════════════════════════════════════════
   MÓDULO DE TESTES DE COMUNICAÇÃO
   Métrica: TPP — Taxa de Perda de Pacotes
   Fórmula: TPP = ((Pkts_enviados - Pkts_recebidos) / Pkts_enviados) × 100
   Calculada individualmente para TX1 e TX2
══════════════════════════════════════════════════ */

/**
 * Simulates a packet loss test for a specific TX module.
 * Uses the academic methodology: sends a burst of N packets and counts
 * how many are received, deriving TPP per module independently.
 *
 * Rules:
 *  - If sensor is OFFLINE → test is BLOCKED; no metric is produced.
 *  - TX1 and TX2 are at identical distances: their base loss is shared,
 *    each module gets a small ±2% independent variation on top.
 */
window.runPacketLossTest = async function(moduleId) {
  const test = commTestState[moduleId];
  if (!test || test.status === 'running') return;

  // ── Guard: sensor must be online ──────────────────────────────────────
  const sensorState = S[moduleId];
  const isOnline = sensorState && sensorState.on;

  if (!isOnline) {
    showToast(
      `${test.label}: Teste impossível`,
      'Parâmetros indisponíveis — o sensor está OFFLINE e não há recepção de dados.',
      'danger',
      'signal'
    );
    return; // abort — no test while offline
  }

  showToast(`Teste ${test.label} iniciado`, 'A enviar pacotes de teste...', 'info', 'signal');

  test.status = 'running';
  renderDistanceTests();

  // Simulate packet burst transmission (academic standard: 100 packets)
  const PKTS_TOTAL = 100;
  await new Promise(r => setTimeout(r, randI(2000, 3500)));

  // ── Correlated loss model (TX1 ≈ TX2, same distance) ──────────────────
  // Both modules share an environmental base loss drawn once per test run.
  // The base is stored in a module-level variable so the second module
  // references the same draw (within its ±2% individual deviation).
  if (!window._sharedBaseLoss || window._sharedBaseLossId !== moduleId) {
    // First module to run generates the shared base (good link: LoRa SF12 @ 433 MHz)
    window._sharedBaseLoss = rand(0, 8); // % base loss for both TX at this distance
  }

  // Each module independently varies ±2% around the shared base
  const deviation = rand(-2, 2);
  const effectiveLoss = Math.max(0, Math.min(100, window._sharedBaseLoss + deviation));

  const pktsReceived = Math.round(PKTS_TOTAL * (1 - effectiveLoss / 100));

  // Mark this module as "consumed" — next different module resets the base
  window._sharedBaseLossId = moduleId === 'tx1' ? 'tx2' : 'tx1';

  test.pktsSent     = PKTS_TOTAL;
  test.pktsReceived = pktsReceived;
  // TPP Formula: ((enviados - recebidos) / enviados) × 100
  test.lossPct      = +((( PKTS_TOTAL - pktsReceived) / PKTS_TOTAL) * 100).toFixed(1);
  test.status       = 'completed';
  test.lastRun      = now();

  // Qualitative classification
  const quality = test.lossPct <= 5 ? 'ok' : test.lossPct <= 15 ? 'warn' : 'danger';
  const qualityLabel = { ok: 'Boa', warn: 'Aceitável', danger: 'Crítica' }[quality];

  testLogs.unshift({
    time:     test.lastRun,
    module:   `${test.label} — ${test.name}`,
    sent:     PKTS_TOTAL,
    received: pktsReceived,
    loss:     `${test.lossPct}%`,
    quality,
    qualityLabel
  });

  renderDistanceTests();
  renderTestLogs();

  showToast(
    `${test.label}: Teste concluído`,
    `Perda de pacotes: ${test.lossPct}% — ${qualityLabel}`,
    quality,
    quality === 'ok' ? 'check' : 'signal'
  );
};

function lossStatusClass(lossPct) {
  if (lossPct === null) return '';
  if (lossPct <= 5)  return 'risk-low';
  if (lossPct <= 15) return 'risk-medium';
  return 'risk-high';
}

function lossBadgeClass(lossPct, isRunning) {
  if (isRunning) return 'medium';
  if (lossPct === null) return 'low';
  if (lossPct <= 5)  return 'low';
  if (lossPct <= 15) return 'medium';
  return 'high';
}

function renderDistanceTests() {
  const container = document.getElementById('distance-tests-grid');
  if (!container) return;

  container.innerHTML = TX_MODULES.map(m => {
    const test = commTestState[m.id];
    const isRunning   = test.status === 'running';
    const isCompleted = test.status === 'completed';
    const sensorOnline = S[m.id] && S[m.id].on;

    // ── OFFLINE state: test blocked ───────────────────────────────────────
    if (!sensorOnline) {
      return `
      <div class="malaria-card risk-high" id="commtest-${m.id}" style="opacity:0.85">
        <div class="mc-header">
          <div style="display:flex;align-items:center;gap:0.6rem">
            <span class="tx-badge" style="font-size:0.8rem;padding:0.25rem 0.6rem;background:var(--danger);color:#fff">${m.label}</span>
            <h3 style="margin:0;font-size:0.95rem">${m.name}</h3>
          </div>
          <span class="mc-risk-badge high">
            <span class="mc-risk-dot"></span>
            Sem ligação
          </span>
        </div>

        <div class="mc-content">
          <!-- Sensor offline indicator -->
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;padding:0.5rem 0.6rem;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--danger)">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0"></span>
            <span style="font-size:0.72rem;color:var(--danger);font-weight:600">Sensor OFFLINE — sem recepção de dados</span>
          </div>

          <!-- Blocked message -->
          <div style="
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:0.6rem;padding:1.5rem 1rem;text-align:center;
            background:rgba(var(--danger-rgb,220,53,69),0.06);
            border:1px dashed var(--danger);border-radius:var(--radius-sm);
          ">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" style="width:28px;height:28px;flex-shrink:0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
            </svg>
            <div>
              <div style="font-size:0.82rem;font-weight:700;color:var(--danger);margin-bottom:0.25rem">Teste indisponível</div>
              <div style="font-size:0.72rem;color:var(--text3);line-height:1.5">
                Os parâmetros de comunicação não podem ser<br>
                medidos pois não há recepção de dados do sensor.
              </div>
            </div>
          </div>

          <!-- Disabled button -->
          <div class="mc-actions" style="margin-top:0.9rem">
            <button class="mc-btn mc-btn-primary" disabled style="opacity:0.4;cursor:not-allowed;filter:grayscale(1)">
              <svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              Teste bloqueado — sensor offline
            </button>
          </div>
        </div>
      </div>
      `;
    }

    // ── ONLINE state: normal card ─────────────────────────────────────────
    // Build a visual loss bar (0–100%)
    const barWidth = isCompleted ? test.lossPct : 0;
    const barColor = test.lossPct <= 5 ? 'var(--accent2)' : test.lossPct <= 15 ? 'var(--warn)' : 'var(--danger)';

    // Badge text
    const badgeText = isRunning ? 'Em curso…' : isCompleted
      ? (test.lossPct <= 5 ? 'Boa qualidade' : test.lossPct <= 15 ? 'Aceitável' : 'Ligação crítica')
      : 'Pronto';

    return `
    <div class="malaria-card ${isCompleted ? lossStatusClass(test.lossPct) : ''}" id="commtest-${m.id}">
      <div class="mc-header">
        <div style="display:flex;align-items:center;gap:0.6rem">
          <span class="tx-badge" style="font-size:0.8rem;padding:0.25rem 0.6rem">${m.label}</span>
          <h3 style="margin:0;font-size:0.95rem">${m.name}</h3>
        </div>
        <span class="mc-risk-badge ${lossBadgeClass(test.lossPct, isRunning)}">
          <span class="mc-risk-dot ${isRunning ? 'live-dot' : ''}"></span>
          ${badgeText}
        </span>
      </div>

      <div class="mc-content">

        <!-- Sensor link status context -->
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem;padding:0.5rem 0.6rem;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--border)">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--accent2);flex-shrink:0"></span>
          <span style="font-size:0.72rem;color:var(--text3)">Sensor </span>
          <span style="font-size:0.72rem;font-weight:600;color:var(--accent2)">ONLINE — ligação activa</span>
        </div>

        <!-- TPP metric: packets sent / received -->
        <div class="mc-row" style="align-items:flex-start">
          <div class="mc-row-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-4 0v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
            </svg>
          </div>
          <div class="mc-row-text" style="flex:1">
            <div class="mc-row-label">Pacotes enviados / recebidos</div>
            <div class="mc-row-value" style="font-size:1.05rem">
              ${isRunning ? '<span style="color:var(--text3);font-size:0.8rem">A transmitir…</span>' :
                isCompleted ? `<span style="color:var(--text)">${test.pktsSent}</span> <span style="color:var(--text3);font-size:0.75rem">enviados</span> / <span style="color:${test.pktsReceived === test.pktsSent ? 'var(--accent2)' : 'var(--warn)'}">${test.pktsReceived}</span> <span style="color:var(--text3);font-size:0.75rem">recebidos</span>` :
                '<span style="color:var(--text3);font-size:0.8rem">—</span>'}
            </div>
          </div>
        </div>

        <!-- TPP visual result -->
        <div style="margin:0.75rem 0 0.25rem">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.35rem">
            <span style="font-size:0.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em">TPP — Taxa de Perda de Pacotes</span>
            <span style="font-size:1.15rem;font-weight:700;font-family:var(--font-mono);color:${
              !isCompleted ? 'var(--text3)' : test.lossPct <= 5 ? 'var(--accent2)' : test.lossPct <= 15 ? 'var(--warn)' : 'var(--danger)'
            }">${isRunning ? '…' : isCompleted ? test.lossPct + '%' : '—'}</span>
          </div>
          <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${barWidth}%;background:${barColor};border-radius:4px;transition:width 0.6s ease"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:0.2rem">
            <span style="font-size:0.65rem;color:var(--accent2)">0% — Sem perda</span>
            <span style="font-size:0.65rem;color:var(--danger)">100% — Sem ligação</span>
          </div>
        </div>

        <!-- Formula footnote -->
        <div style="margin-top:0.6rem;padding:0.4rem 0.6rem;border-radius:var(--radius-sm);background:var(--bg);border:1px solid var(--border);font-size:0.65rem;color:var(--text3);font-family:var(--font-mono)">
          TPP = ((Pkts<sub>env</sub> − Pkts<sub>rec</sub>) ÷ Pkts<sub>env</sub>) × 100 &nbsp;|&nbsp; N=100 pkts &nbsp;|&nbsp; SF12 / 433 MHz
        </div>

        <div class="mc-actions" style="margin-top:0.9rem">
          <button class="mc-btn mc-btn-primary" onclick="runPacketLossTest('${m.id}')" ${isRunning ? 'disabled style="opacity:0.6;cursor:not-allowed"' : ''}>
            <svg class="inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            ${isCompleted ? 'Repetir Teste' : 'Iniciar Teste'}
          </button>
        </div>
      </div>
    </div>
    `;
  }).join('');
}

function renderTestLogs() {
  const tb = document.getElementById('test-log-tbody');
  if (!tb) return;

  if (!testLogs.length) {
    tb.innerHTML = '<tr><td colspan="5" class="tbl-empty">Ainda não foram realizados testes.</td></tr>';
    return;
  }

  tb.innerHTML = testLogs.slice(0, 20).map(log => `
    <tr>
      <td style="font-family:var(--font-mono);font-size:.72rem;color:var(--text3)">${log.time}</td>
      <td style="font-weight:600;color:var(--accent)">${log.module}</td>
      <td style="font-family:var(--font-mono)">${log.sent}</td>
      <td style="font-family:var(--font-mono);color:${log.quality === 'ok' ? 'var(--accent2)' : log.quality === 'warn' ? 'var(--warn)' : 'var(--danger)'}">${log.received}</td>
      <td><span class="tag ${log.quality}">${log.loss} — ${log.qualityLabel}</span></td>
    </tr>`).join('');
}

/* ══════════════════════════════════════════════════
   CONTROLS
══════════════════════════════════════════════════ */
window.forceRefresh=()=>{ simulate(); renderAll(); showToast('Dados actualizados', 'As informações foram refrescadas.', 'info', 'refresh'); };

window.exportCSV=()=>{
  const rows=[['Hora','TX1 Temp','TX1 Hum','TX1 Água','TX2 Temp','TX2 Hum','TX2 Água','IRM','Risco']];
  histLog.forEach(r=>rows.push([r.time,r.t1t,r.t1h,r.t1w,r.t2t,r.t2h,r.t2w,r.irm,r.risk]));
  const csv=rows.map(r=>r.join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`PRO-VigiMAT-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
};

function set(id,val){ const e=document.getElementById(id); if(e) e.textContent=val; }

/* ══════════════════════════════════════════════════
   MAIN LOOP
══════════════════════════════════════════════════ */
async function tick(){ 
  await simulate(); 
  renderAll(); 
}

window.addEventListener('resize',()=>{
  drawHistChart(); drawSpk('spk1',spk1H); drawSpk('spk2',spk2H);
  drawGauge(S.irm,S.risk);
});

async function boot(){
  startClock();
  initNav();
  
  if (CFG.useRealData) {
    initFirebase();
  } else {
    renderAll();
    renderMalariaWarnings();
    timer = setInterval(tick, CFG.interval);
  }

  renderDistanceTests();
  
  // Período de Boot/Inicialização de 20 segundos
  setTimeout(() => {
    window.startupPeriodElapsed = true;
    if (window.newReadingReceivedDuringStartup && window.lastVigiMatResult) {
      S.systemStatus = 'active';
      resetInactivityTimer();
      applyVigiMatToState(window.lastVigiMatResult);
      renderAll();
      showToast('Sistema Activo', 'Dados confirmados após período de inicialização.', 'info', 'satellite');
    } else {
      S.systemStatus = 'inactive';
      renderAll();
      showToast('Aviso de Ligação', 'Nenhuma nova entrada detectada. O sistema permanece offline.', 'warning', 'signal');
    }
  }, 20000);

  setTimeout(() => showToast('PRO-VigiMAT activo', 'A receber dados das zonas monitorizadas.', 'info', 'satellite'), 600);
}

window.addEventListener('DOMContentLoaded', startPreloader);
