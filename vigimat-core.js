/**
 * VigiMat Core - Business Logic Layer
 * Responsibilities: Firebase consumption, Validation, Statistics, Alerts, Trends.
 */

const VigimatConfig = {
    firebaseConfig: {
      apiKey: "AIzaSyDEQC4Obd9LbovK0tqmpTcHB0Q5B5_1UEA",
      authDomain: "pro-vigimat.firebaseapp.com",
      databaseURL: "https://pro-vigimat-default-rtdb.firebaseio.com",
      projectId: "pro-vigimat",
      storageBucket: "pro-vigimat.firebasestorage.app",
      messagingSenderId: "37906477930",
      appId: "1:37906477930:web:dbc0f9eaa7badded612b13",
      measurementId: "G-1NCKJB4PM5"
    }
};

/**
 * Módulo 10 — Arquitetura: FirebaseService (Refactored for Modular SDK v9+)
 */
class FirebaseService {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    init() {
        // Modular imports are handled via script type="module" or global window access if using compat
        // Here we assume global access through the script tags in index.html
        if (typeof firebase === 'undefined') {
            console.error('Firebase SDK not found. Loading via compat layer.');
            return;
        }
        if (!this.isInitialized) {
            firebase.initializeApp(VigimatConfig.firebaseConfig);
            this.db = firebase.database();
            this.isInitialized = true;
        }
    }

    onReadingsUpdate(callback) {
        if (!this.db) return;
        const readingsRef = this.db.ref('readings');
        readingsRef.on('value', (snapshot) => {
            const data = snapshot.val();
            // Handle Firebase object structure or array
            let list = [];
            if (data) {
                list = Object.keys(data).map(key => ({
                    id: key,
                    ...data[key]
                }));
            }
            callback(list);
        });
    }
}

/**
 * Módulo 2 — Validação
 */
class ValidationService {
    static isValid(r) {
        if (!r) return false;
        
        // Módulo 2 rules
        const hasRequiredFields = r.timestamp && r.avgTemp !== undefined && r.avgHum !== undefined;
        if (!hasRequiredFields) return false;

        const isTempValid = r.avgTemp >= 0 && r.avgTemp <= 60;
        const isHumValid = r.avgHum >= 0 && r.avgHum <= 100;
        const isRainValid = (r.rain1 === undefined || (r.rain1 >= 0 && r.rain1 <= 4095)) &&
                            (r.rain2 === undefined || (r.rain2 >= 0 && r.rain2 <= 4095));

        return isTempValid && isHumValid && isRainValid;
    }
}

/**
 * Módulo 1 — Leitura de Dados
 */
class ReadingService {
    static process(rawList) {
        // Validation and Filter
        const validReadings = rawList.filter(ValidationService.isValid);
        
        // Módulo 1: Ordenação (Mais recente -> Mais antigo)
        return validReadings.sort((a, b) => b.timestamp - a.timestamp);
    }

    // Módulo 7 — Filtros
    static filterByRange(readings, range) {
        const now = Date.now() / 1000; // Firebase uses seconds based on prompt example
        const day = 24 * 60 * 60;

        switch (range) {
            case 'today':
                const todayStart = new Date().setHours(0,0,0,0) / 1000;
                return readings.filter(r => r.timestamp >= todayStart);
            case '24h':
                return readings.filter(r => r.timestamp >= now - day);
            case '7d':
                return readings.filter(r => r.timestamp >= now - (7 * day));
            case '30d':
                return readings.filter(r => r.timestamp >= now - (30 * day));
            default:
                return readings;
        }
    }
}

/**
 * Módulo 3 — Estatísticas
 */
class StatisticsService {
    static calculate(readings) {
        if (readings.length === 0) return {
            avgTemp: 0, avgHum: 0, maxTemp: 0, minTemp: 0, maxHum: 0, minHum: 0, total: 0
        };

        const total = readings.length;
        const sumTemp = readings.reduce((acc, r) => acc + r.avgTemp, 0);
        const sumHum = readings.reduce((acc, r) => acc + r.avgHum, 0);

        const temps = readings.map(r => r.avgTemp);
        const hums = readings.map(r => r.avgHum);

        return {
            avgTemp: sumTemp / total,
            avgHum: sumHum / total,
            maxTemp: Math.max(...temps),
            minTemp: Math.min(...temps),
            maxHum: Math.max(...hums),
            minHum: Math.min(...hums),
            total: total
        };
    }
}

/**
 * Módulo 4 — Alertas
 */
class AlertService {
    static process(readings) {
        const alerts = [];
        if (readings.length === 0) return alerts;

        const latest = readings[0];
        
        // Preventive Alert: 3 consecutive readings with water in same range
        if (readings.length >= 3) {
            const r0 = readings[0], r1 = readings[1], r2 = readings[2];
            const TOLERANCE = 200; 
            const WATER_THRESHOLD = 2000;

            const checkWaterRange = (val0, val1, val2) => {
                if (val0 === undefined || val1 === undefined || val2 === undefined) return false;
                const isWater = val0 < WATER_THRESHOLD && val1 < WATER_THRESHOLD && val2 < WATER_THRESHOLD;
                const inRange = Math.abs(val0 - val1) < TOLERANCE && Math.abs(val1 - val2) < TOLERANCE;
                return isWater && inRange;
            };

            const tx1Risk = checkWaterRange(r0.rain1, r1.rain1, r2.rain1);
            const tx2Risk = checkWaterRange(r0.rain2, r1.rain2, r2.rain2);

            const timeDiffMinutes = Math.round((r0.timestamp - r2.timestamp) / 60);

            if (tx1Risk) {
                alerts.push({
                    timestamp: r0.timestamp,
                    type: "PREVENTIVE_TX1",
                    severity: "danger",
                    title: "ALERTA PREVENTIVO - TX1",
                    icon: "water",
                    message: `TX1 detectou água estagnada há ${timeDiffMinutes} min. Risco de criadouro identificado.`
                });
            }

            if (tx2Risk) {
                alerts.push({
                    timestamp: r0.timestamp,
                    type: "PREVENTIVE_TX2",
                    severity: "danger",
                    title: "ALERTA PREVENTIVO - TX2",
                    icon: "water",
                    message: `TX2 detectou água estagnada há ${timeDiffMinutes} min. Risco de criadouro identificado.`
                });
            }
        }

        // Standard risk alerts (only for the latest reading)
        if (latest.risk === "ALTO") {
            alerts.push({
                timestamp: latest.timestamp,
                type: "HIGH_RISK",
                severity: "danger",
                title: "RISCO ALTO",
                icon: "alert",
                message: "Elevado risco ambiental detectado no local."
            });
        } else if (latest.risk === "MEDIO") {
            alerts.push({
                timestamp: latest.timestamp,
                type: "MEDIUM_RISK",
                severity: "warn",
                title: "RISCO MÉDIO",
                icon: "warning",
                message: "Condições moderadamente favoráveis identificadas."
            });
        }

        return alerts;
    }
}

/**
 * Módulo 5 — Tendências
 */
class TrendService {
    static getTrend(values) {
        if (values.length < 2) return "Estável";
        const first = values[values.length - 1];
        const last = values[0]; // Ordered newest to oldest, so index 0 is newest
        
        if (last > first) return "Subindo";
        if (last < first) return "Descendo";
        return "Estável";
    }

    static getRiskTrend(values) {
        const riskMap = { "BAIXO": 1, "MEDIO": 2, "ALTO": 3 };
        const mapped = values.map(v => riskMap[v] || 1);
        
        if (mapped.length < 2) return "Estável";
        const first = mapped[mapped.length - 1];
        const last = mapped[0];

        if (last > first) return "Piorando";
        if (last < first) return "Melhorando";
        return "Estável";
    }

    static analyze(readings) {
        // Analyse last 10
        const subset = readings.slice(0, 10);
        if (subset.length === 0) return { temp: "Estável", hum: "Estável", risk: "Estável" };

        return {
            temp: this.getTrend(subset.map(r => r.avgTemp)),
            hum: this.getTrend(subset.map(r => r.avgHum)),
            risk: this.getRiskTrend(subset.map(r => r.risk))
        };
    }
}

/**
 * Módulo 6 & 8 — Dashboard & Graphs
 */
class DashboardService {
    static getSummary(readings, stats, alerts, trends) {
        const latest = readings[0] || {};
        const highEvents = alerts.filter(a => a.type === "HIGH_RISK").length;
        const mediumEvents = alerts.filter(a => a.type === "MEDIUM_RISK").length;

        return {
            currentRisk: latest.risk || "BAIXO",
            averageTemperature: stats.avgTemp,
            averageHumidity: stats.avgHum,
            totalReadings: stats.total,
            highRiskEvents: highEvents,
            mediumRiskEvents: mediumEvents,
            temperatureTrend: trends.temp,
            humidityTrend: trends.hum,
            riskTrend: trends.risk
        };
    }

    static getChartData(readings) {
        const riskMap = { "BAIXO": 1, "MEDIO": 2, "ALTO": 3 };
        
        // Reverse for chronological order in charts (oldest to newest)
        const chrono = [...readings].reverse();

        return {
            temperature: chrono.map(r => ({
                timestamp: new Date(r.timestamp * 1000).toLocaleTimeString(),
                value: r.avgTemp
            })),
            humidity: chrono.map(r => ({
                timestamp: new Date(r.timestamp * 1000).toLocaleTimeString(),
                value: r.avgHum
            })),
            risk: chrono.map(r => ({
                timestamp: new Date(r.timestamp * 1000).toLocaleTimeString(),
                value: riskMap[r.risk] || 1
            }))
        };
    }
}

/**
 * Entry point for VigiMat logic
 */
const VigiMat = {
    firebase: new FirebaseService(),
    
    init() {
        this.firebase.init();
    },

    // Main data flow
    processData(rawReadings) {
        const processed = ReadingService.process(rawReadings);
        const stats = StatisticsService.calculate(processed);
        const alerts = AlertService.process(processed);
        const trends = TrendService.analyze(processed);
        
        const summary = DashboardService.getSummary(processed, stats, alerts, trends);
        const chartData = DashboardService.getChartData(processed);

        return {
            readings: processed,
            stats,
            alerts,
            summary,
            chartData
        };
    }
};
