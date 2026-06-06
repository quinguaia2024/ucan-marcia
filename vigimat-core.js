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
        
        // --- Progressive Water Stagnation Logic ---
        const WATER_THRESHOLD = 2000; // Value below this indicates water
        const TOLERANCE = 50;         // Stability tolerance

        const checkStagnation = (sensorKey) => {
            let count = 0;
            const initialVal = readings[0][sensorKey];
            
            // Sensor must detect water first
            if (initialVal === undefined || initialVal >= WATER_THRESHOLD) return 0;

            for (let i = 0; i < readings.length; i++) {
                const currentVal = readings[i][sensorKey];
                if (currentVal !== undefined && Math.abs(currentVal - initialVal) <= TOLERANCE) {
                    count++;
                } else {
                    break;
                }
            }
            return count;
        };

        const tx1StagnationCount = checkStagnation('rain1');
        const tx2StagnationCount = checkStagnation('rain2');

        const generateStagnationAlert = (sensorId, count) => {
            if (count < 2) return null; // Need at least 2 readings (30s interval)

            let severity = "info";
            let riskLvl = "BAIXO";
            let timeDesc = count === 2 ? "30 segundos" : `${(count - 1) * 30} segundos`;

            if (count >= 6) {
                severity = "danger";
                riskLvl = "ALTO";
            } else if (count >= 4) {
                severity = "warn";
                riskLvl = "MÉDIO";
            }

            return {
                timestamp: latest.timestamp,
                type: `STAGNATION_${sensorId}`,
                severity: severity,
                title: `RISCO ${riskLvl} - Água Estagnada (${sensorId})`,
                icon: "water",
                message: `Valores de água permanecem constantes há ${timeDesc}. Risco de criadouro identificado.`
            };
        };

        const alert1 = generateStagnationAlert("TX1", tx1StagnationCount);
        if (alert1) alerts.push(alert1);

        const alert2 = generateStagnationAlert("TX2", tx2StagnationCount);
        if (alert2) alerts.push(alert2);

        // --- Standard risk alerts (Global IRM) ---
        if (latest.risk === "ALTO") {
            alerts.push({
                timestamp: latest.timestamp,
                type: "HIGH_RISK",
                severity: "danger",
                title: "RISCO ALTO GLOBAL",
                icon: "alert",
                message: "Elevado risco ambiental detectado no local."
            });
        } else if (latest.risk === "MEDIO") {
            alerts.push({
                timestamp: latest.timestamp,
                type: "MEDIUM_RISK",
                severity: "warn",
                title: "RISCO MÉDIO GLOBAL",
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
        let currentRisk = latest.risk || "BAIXO";

        // --- Priority: Water Stagnation overrides Temperature-based risk ---
        const stagnationAlerts = alerts.filter(a => a.type.startsWith("STAGNATION_"));
        const hasHighStagnation = stagnationAlerts.some(a => a.severity === "danger");
        const hasMedStagnation = stagnationAlerts.some(a => a.severity === "warn");

        if (hasHighStagnation) {
            currentRisk = "ALTO";
        } else if (hasMedStagnation && currentRisk !== "ALTO") {
            currentRisk = "MEDIO";
        }

        const highEvents = alerts.filter(a => a.type === "HIGH_RISK").length;
        const mediumEvents = alerts.filter(a => a.type === "MEDIUM_RISK").length;

        // Get max stagnation time for UI display
        let maxStagnationMsg = "";
        if (stagnationAlerts.length > 0) {
            // Sort by severity and then by time (message contains the time)
            const critical = stagnationAlerts.find(a => a.severity === "danger") || stagnationAlerts[0];
            maxStagnationMsg = critical.message;
        }

        return {
            currentRisk: currentRisk,
            averageTemperature: stats.avgTemp,
            averageHumidity: stats.avgHum,
            totalReadings: stats.total,
            highRiskEvents: highEvents,
            mediumRiskEvents: mediumEvents,
            temperatureTrend: trends.temp,
            humidityTrend: trends.hum,
            riskTrend: trends.risk,
            stagnationMsg: maxStagnationMsg
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
