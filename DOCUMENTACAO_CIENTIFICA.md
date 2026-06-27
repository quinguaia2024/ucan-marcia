# Documento Técnico do Sistema VigiMat
## Fundamentos Matemáticos, Modelagem e Implementação

---

## Índice

1. [Introdução ao Sistema](#1-introdução-ao-sistema)
2. [Arquitetura Geral](#2-arquitetura-geral)
3. [Índice de Risco de Malária (IRM)](#3-índice-de-risco-de-malária-irm)
4. [Modelagem Física da Rede LoRa](#4-modelagem-física-da-rede-lora)
5. [Algoritmo de Detecção de Água Estagnada](#5-algoritmo-de-detecção-de-água-estagnada)
6. [Métodos de Estabilidade Temporal](#6-métodos-de-estabilidade-temporal)
7. [Exemplos de Cálculo](#7-exemplos-de-cálculo)
8. [Estrutura de Dados no Firebase](#8-estrutura-de-dados-no-firebase)
9. [Fluxo de Dados Completo](#9-fluxo-de-dados-completo)
10. [Conclusão](#10-conclusão)

---

## 1. Introdução ao Sistema

O **VigiMat** é um sistema IoT para monitorização ambiental e predição de risco de malária. O sistema coleta dados de temperatura, humidade e presença de água superficial, processa-os através de modelos matemáticos e disponibiliza indicadores de risco em tempo real.

### 1.1. Componentes do Sistema

| Componente | Função | Tecnologia |
|------------|--------|------------|
| **Nós Transmissores** | Coleta de dados ambientais | ESP32 + DHT11 + FC-37 + LoRa |
| **Recetor Central** | Agregação e envio para nuvem | ESP32 + LoRa + Wi-Fi |
| **Firebase** | Armazenamento e sincronização | Realtime Database |
| **Interface Web** | Visualização e análise | HTML + CSS + JavaScript |

### 1.2. Fluxo de Dados

```
Sensores (DHT11 + FC-37)
    ↓
Transmissor LoRa (ESP32)
    ↓
Recetor LoRa (ESP32)
    ↓
Firebase Realtime Database
    ↓
Interface Web (Dashboard)
```

---

## 2. Arquitetura Geral

### 2.1. Hardware

#### Nó Transmissor
- **Microcontrolador:** ESP32 DevKit V1
- **Sensores:**
  - 1× DHT11 (Temperatura e Humidade) – GPIO 22
  - 1× FC-37 (Detecção de Água) – GPIO 34 (ADC)
- **Comunicação:** Módulo LoRa SX1278 (433 MHz)
- **Alimentação:** USB 5V ou bateria 3.7V

#### Recetor Central
- **Microcontrolador:** ESP32 DevKit V1
- **Comunicação:** LoRa (recepção) + Wi-Fi (envio para Firebase)
- **Módulo LoRa:** SX1278 (433 MHz) – GPIOs 5, 14, 2, 18, 19, 23

### 2.2. Parâmetros de Configuração

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| `SEND_INTERVAL` | 30 segundos | Intervalo entre leituras e transmissões |
| `RAIN_THRESHOLD` | 2500 | Limiar ADC para detecção de água |
| `LORA_FREQ` | 433 MHz | Frequência de operação LoRa |
| `LORA_SF` | 12 | Spreading Factor (sensibilidade) |
| `LORA_TX_POWER` | 17 dBm | Potência de transmissão |

---

## 3. Índice de Risco de Malária (IRM)

O **IRM** é um indicador matemático ponderado (0 a 100) que quantifica a adequação ambiental para o vetor *Anopheles* e a replicação do *Plasmodium*.

### 3.1. Pré-processamento Dinâmico

Para evitar que falhas em sensores individuais comprometam a análise, as médias são calculadas condicionalmente:

**Temperatura Média:**
```
T_avg = (T1 + T2) / 2  → se ambos os nós estão ativos
T_avg = T1              → se apenas o Nó 1 está ativo
T_avg = T2              → se apenas o Nó 2 está ativo
T_avg = 0               → se ambos os nós estão inativos
```

**Humidade Média:**
```
H_avg = (H1 + H2) / 2  → se ambos os nós estão ativos
H_avg = H1              → se apenas o Nó 1 está ativo
H_avg = H2              → se apenas o Nó 2 está ativo
H_avg = 0               → se ambos os nós estão inativos
```

### 3.2. Equação Geral do IRM

**Se nenhuma água for detectada no sistema (W1 = 0 e W2 = 0):**
```
IRM = clamp(Score_T + Score_H, 0, 30)
```
O risco permanece obrigatoriamente **BAIXO** (máximo 30) pois a ausência de criadouros impede a proliferação do vetor.

**Se água for detectada em pelo menos um nó ativo:**
```
IRM = clamp(Score_T + Score_H + Score_W, 0, 100)
```

Onde cada sub-score contribui com um peso específico para o índice final.

### 3.3. Sub-score de Temperatura (Score_T) – Peso Máximo: 40 pontos

A temperatura ideal para o desenvolvimento do mosquito é entre 25°C e 35°C. Fora deste intervalo, a taxa de mortalidade aumenta.

**Faixa Ótima (25°C ≤ T_avg ≤ 35°C):**
```
Score_T = 40 × (1 - |T_avg - 30| / 10)
```

**Faixa Hipertérmica (T_avg > 35°C):**
```
Score_T = max(0, 40 - (T_avg - 35) × 3)
```

**Faixa Hipotérmica (T_avg < 25°C):**
```
Score_T = max(0, 20 - (25 - T_avg) × 4)
```

**Exemplo de Cálculo:**

| Temperatura | Cálculo | Score_T |
|-------------|---------|---------|
| 30°C | `40 × (1 - 0/10)` | 40.0 |
| 28°C | `40 × (1 - 2/10)` | 32.0 |
| 25°C | `40 × (1 - 5/10)` | 20.0 |
| 35°C | `40 × (1 - 5/10)` | 20.0 |
| 36°C | `max(0, 40 - 1×3)` | 37.0 |
| 22°C | `max(0, 20 - 3×4)` | 8.0 |

### 3.4. Sub-score de Humidade (Score_H) – Peso Máximo: 35 pontos

A humidade relativa afeta a longevidade do mosquito. Abaixo de 40%, a mortalidade aumenta acentuadamente.

```
Score_H = clamp((H_avg - 40) / 60 × 35, 0, 35)
```

**Exemplo de Cálculo:**

| Humidade | Cálculo | Score_H |
|----------|---------|---------|
| 100% | `(100-40)/60 × 35` | 35.0 |
| 80% | `(80-40)/60 × 35` | 23.3 |
| 60% | `(60-40)/60 × 35` | 11.7 |
| 40% | `(40-40)/60 × 35` | 0.0 |
| 30% | `clamp(-10/60×35)` | 0.0 |

### 3.5. Sub-score de Água (Score_W) – Peso Máximo: 25 pontos

A presença de água parada é o fator mais crítico para a reprodução do mosquito. O score de água aumenta de forma dinâmica consoante o tempo de permanência da água (estagnação):

```
Score_W = Contrib_W1 + Contrib_W2
```

Onde a contribuição de cada nó $n$ ativo é calculada com base no seu contador de ciclos de estagnação ($S_n$, incrementado a cada 30 segundos de presença contínua de água):

* Se $W_n = 0$ (sem água): `Contrib_Wn = 0.0`
* Se $W_n = 1$ (água detectada): `Contrib_Wn = min(12.5, 5 + S_n * 1.25)`

**Exemplo de Contribuição por Nó:**

| Tempo de Água Parada | Ciclos ($S_n$) | Cálculo da Contribuição | Contrib_Wn |
|----------------------|----------------|-------------------------|------------|
| 0s (Sem água)        | 0              | `0`                     | 0.0        |
| 30s (Detecção inicial)| 1              | `5 + 1 * 1.25`          | 6.25       |
| 1 min                | 2              | `5 + 2 * 1.25`          | 7.5        |
| 2 min                | 4              | `5 + 4 * 1.25`          | 10.0       |
| 3 min ou mais        | 6 (ou mais)    | `min(12.5, 5 + 6*1.25)` | 12.5 (Máx) |

### 3.6. Classificação dos Níveis de Risco

| IRM | Classificação | Cor | Interpretação |
|-----|---------------|-----|---------------|
| < 35 | **BAIXO** | 🟢 Verde | Condições desfavoráveis ao mosquito |
| 35 – 64 | **MÉDIO** | 🟡 Amarelo | Condições favoráveis, vigilância necessária |
| ≥ 65 | **ALTO** | 🔴 Vermelho | Condições ideais para proliferação |

### 3.7. Exemplo Completo de Cálculo do IRM

**Dados de Entrada:**
- T1 = 28.5°C, H1 = 72%
- T2 = 29.0°C, H2 = 75%
- W1 = 1 (água detectada), W2 = 1 (água detectada)

**Passo 1 – Médias:**
```
T_avg = (28.5 + 29.0) / 2 = 28.75°C
H_avg = (72 + 75) / 2 = 73.5%
```

**Passo 2 – Score_T:**
```
Score_T = 40 × (1 - |28.75 - 30| / 10)
Score_T = 40 × (1 - 1.25/10)
Score_T = 40 × (1 - 0.125)
Score_T = 40 × 0.875 = 35.0
```

**Passo 3 – Score_H:**
```
Score_H = (73.5 - 40) / 60 × 35
Score_H = 33.5 / 60 × 35
Score_H = 0.558 × 35 = 19.5
```

**Passo 4 – Score_W:**
```
Score_W = (1 + 1) × 12.5 = 25.0
```

**Passo 5 – IRM Final:**
```
IRM = 35.0 + 19.5 + 25.0 = 79.5
```

**Classificação:** ALTO (≥ 65)

---

## 4. Modelagem Física da Rede LoRa

A rede de comunicação baseia-se na modulação chirp por espectro de difusão (LoRa). As equações abaixo descrevem o comportamento do sinal em função da distância.

### 4.1. Atenuação Log-Distância do Sinal (RSSI)

A potência recebida (RSSI) em função da distância (d) segue o modelo log-distância:

```
RSSI(d) = RSSI_0 - 10·γ·log10(d/d0) + ε
```

**Modelo Empírico Implementado:**
```
RSSI(d) = -90 - (d/35) + ε
```

Onde:
- **-90 dBm:** Potência de referência a 1 metro
- **35:** Coeficiente de perda de percurso (semi-urbano com vegetação)
- **ε:** Ruído gaussiano, ε ∈ [-3, +3] dBm

**Exemplo de Cálculo:**

| Distância | Cálculo | RSSI (dBm) |
|-----------|---------|------------|
| 1m | `-90 - 1/35 + 0` | -90.0 |
| 20m | `-90 - 20/35 + 0` | -90.6 |
| 100m | `-90 - 100/35 + 0` | -92.9 |
| 500m | `-90 - 500/35 + 0` | -104.3 |
| 1000m | `-90 - 1000/35 + 0` | -118.6 |

### 4.2. Relação Sinal-Ruído (SNR)

O SNR quantifica a robustez do sinal contra ruído de fundo:

```
SNR(d) = 10 - (d/120) + σ
```

Onde σ ∈ [-1, +1] dB representa interferência atmosférica.

**Exemplo de Cálculo:**

| Distância | Cálculo | SNR (dB) |
|-----------|---------|----------|
| 1m | `10 - 1/120 + 0` | 9.99 |
| 20m | `10 - 20/120 + 0` | 8.83 |
| 100m | `10 - 100/120 + 0` | 8.33 |
| 500m | `10 - 500/120 + 0` | 5.83 |
| 1000m | `10 - 1000/120 + 0` | 1.67 |
| 1200m | `10 - 1200/120 + 0` | 0.00 |

### 4.3. Taxa de Perda de Pacotes (TPP)

```
TPP = ((Pacotes_Enviados - Pacotes_Recebidos) / Pacotes_Enviados) × 100%
```

**Exemplo:**

| Enviados | Recebidos | Cálculo | TPP |
|----------|-----------|---------|-----|
| 100 | 100 | `(100-100)/100×100` | 0% |
| 100 | 95 | `(100-95)/100×100` | 5% |
| 100 | 85 | `(100-85)/100×100` | 15% |
| 100 | 60 | `(100-60)/100×100` | 40% |

### 4.4. Zonas de Cobertura LoRa

| Zona | Distância | PER Típica | RSSI | SNR |
|------|-----------|------------|------|-----|
| Excelente | ≤ 300m | 0–1% | > -100 dBm | > 8 dB |
| Bom | 300–600m | 1–5% | -100 a -110 dBm | 5–8 dB |
| Regular | 600–1000m | 5–15% | -110 a -120 dBm | 0–5 dB |
| Crítico | 1000–1500m | 15–30% | -120 a -125 dBm | -5 a 0 dB |
| Limite | > 1500m | > 30% | < -125 dBm | < -5 dB |

---

## 5. Algoritmo de Detecção de Água Estagnada

A água parada é o criadouro ideal para o mosquito. O sistema implementa um algoritmo baseado em janelas deslizantes para identificar estagnação.

### 5.1. Classificação da Água

**Detecção de Água:**
```
W_n = true ⟺ ADC_n < 2500
```

**Estabilidade (Sem Movimento):**
```
Estagnado ⟺ max(ADC_n) - min(ADC_n) ≤ 50 durante Δt
```

### 5.2. Avaliação Temporal do Alerta

| Período | Ciclos (30s) | Classificação |
|---------|-------------|---------------|
| Δt = 1 min | 2 ciclos | Risco Inicial (Informativo) |
| Δt = 2 min | 4 ciclos | Risco Médio (Atenção) |
| Δt ≥ 3 min | ≥ 6 ciclos | Risco Alto (Perigo) |

### 5.3. Exemplo de Detecção

**Cenário:** Sensor FC-37 com leituras consecutivas:

| Tempo | ADC | Δ |
|-------|-----|---|
| 00:00 | 1200 | – |
| 00:30 | 1210 | 10 |
| 01:00 | 1205 | 5 |
| 01:30 | 1195 | 10 |
| 02:00 | 1200 | 5 |
| 02:30 | 1190 | 10 |

**Análise:**
- Todas as leituras < 2500 → água presente
- Variação máxima: 1210 - 1190 = 20 ≤ 50 → estagnada
- Período: 2.5 min (5 ciclos) → **Alerta Crítico**

---

## 6. Métodos de Estabilidade Temporal

### 6.1. Gatilho Contra Falsos-Positivos (Startup)

No arranque, o sistema ignora registos antigos:

```
TS_ref = TS_database_snapshot
TS_new > TS_ref → Sistema ativo
```

### 6.2. Temporizador Watchdog (Heartbeat)

```
Status = {
    "Ativo",   se (t_atual - t_last_packet) < 60s
    "Inativo", se (t_atual - t_last_packet) ≥ 60s
}
```

**Exemplo:**

| Último Pacote | Tempo Atual | Diferença | Status |
|---------------|-------------|-----------|--------|
| 10:00:00 | 10:00:30 | 30s | ✅ Ativo |
| 10:00:00 | 10:00:45 | 45s | ✅ Ativo |
| 10:00:00 | 10:01:00 | 60s | ⛔ Inativo |
| 10:00:00 | 10:01:30 | 90s | ⛔ Inativo |

---

## 7. Exemplos de Cálculo

### 7.1. Cenário 1: Condições Ideais para Malária

**Dados dos Sensores:**
- Nó 1: T=30°C, H=80%, W=1
- Nó 2: T=31°C, H=85%, W=1

**Cálculos:**
```
T_avg = (30 + 31) / 2 = 30.5°C
H_avg = (80 + 85) / 2 = 82.5%

Score_T = 40 × (1 - |30.5 - 30| / 10)
        = 40 × (1 - 0.05) = 38.0

Score_H = (82.5 - 40) / 60 × 35
        = 42.5 / 60 × 35 = 24.8

Score_W = (1 + 1) × 12.5 = 25.0

IRM = 38.0 + 24.8 + 25.0 = 87.8
```

**Resultado:** RISCO ALTO (condições críticas)

---

### 7.2. Cenário 2: Condições Moderadas

**Dados dos Sensores:**
- Nó 1: T=26°C, H=65%, W=0
- Nó 2: T=27°C, H=70%, W=1

**Cálculos:**
```
T_avg = (26 + 27) / 2 = 26.5°C
H_avg = (65 + 70) / 2 = 67.5%

Score_T = 40 × (1 - |26.5 - 30| / 10)
        = 40 × (1 - 0.35) = 26.0

Score_H = (67.5 - 40) / 60 × 35
        = 27.5 / 60 × 35 = 16.0

Score_W = (0 + 1) × 12.5 = 12.5

IRM = 26.0 + 16.0 + 12.5 = 54.5
```

**Resultado:** RISCO MÉDIO (vigilância necessária)

---

### 7.3. Cenário 3: Condições Desfavoráveis

**Dados dos Sensores:**
- Nó 1: T=20°C, H=45%, W=0
- Nó 2: T=19°C, H=40%, W=0

**Cálculos:**
```
T_avg = (20 + 19) / 2 = 19.5°C
H_avg = (45 + 40) / 2 = 42.5%

Score_T = max(0, 20 - (25 - 19.5) × 4)
        = max(0, 20 - 22) = 0

Score_H = (42.5 - 40) / 60 × 35
        = 2.5 / 60 × 35 = 1.5

Score_W = (0 + 0) × 12.5 = 0

IRM = 0 + 1.5 + 0 = 1.5
```

**Resultado:** RISCO BAIXO (condições desfavoráveis)

---

## 8. Estrutura de Dados no Firebase

### 8.1. Nó de Leituras (`/readings`)

Cada leitura é armazenada com um ID único gerado por `push()`:

```json
{
  "-N8f3a...": {
    "temp1": 28.5,
    "hum1": 72.0,
    "rain1": 1200,
    "water1": true,
    "temp2": 29.0,
    "hum2": 75.0,
    "rain2": 1150,
    "water2": true,
    "avgTemp": 28.75,
    "avgHum": 73.5,
    "waterDetected": true,
    "rssi1": -90.6,
    "snr1": 8.8,
    "rssi2": -92.3,
    "snr2": 8.5,
    "lora_totalPacketsReceived": 156,
    "timestamp": 1739985600
  }
}
```

### 8.2. Estado Atual (`/currentStatus`)

Sobrescrito a cada envio:

```json
{
  "avgTemp": 28.75,
  "avgHum": 73.5,
  "waterDetected": true,
  "lora_packetLossRate": 0.5,
  "timestamp": 1739985600
}
```

### 8.3. Campos Detalhados

| Campo | Tipo | Descrição | Intervalo |
|-------|------|-----------|-----------|
| `temp1`, `temp2` | float | Temperatura dos nós | 0–50°C |
| `hum1`, `hum2` | float | Humidade dos nós | 0–100% |
| `rain1`, `rain2` | int | Leitura ADC dos FC-37 | 0–4095 |
| `water1`, `water2` | bool | Água detectada | true/false |
| `avgTemp`, `avgHum` | float | Médias calculadas | – |
| `waterDetected` | bool | Água em qualquer nó | true/false |
| `rssi1`, `rssi2` | float | Força do sinal LoRa | -140 a -50 dBm |
| `snr1`, `snr2` | float | Relação sinal-ruído | -30 a 20 dB |
| `lora_totalPacketsReceived` | int | Pacotes recebidos | ≥ 0 |
| `timestamp` | int | Unix timestamp | – |

---

## 9. Fluxo de Dados Completo

### 9.1. Diagrama de Sequência

```
[Transmissor]          [Recetor]            [Firebase]          [Interface]
     |                     |                     |                    |
     |-- Leitura (30s) --->|                     |                    |
     |                     |                     |                    |
     |-- Pacote LoRa ----->|                     |                    |
     |   (CSV: ID,T,H,R,W) |                     |                    |
     |                     |-- Parse Pacote ---->|                    |
     |                     |   (Extrai dados)    |                    |
     |                     |                     |                    |
     |                     |-- Cálculo IRM ----->|                    |
     |                     |   (T_avg, H_avg)    |                    |
     |                     |                     |                    |
     |                     |-- Push Firebase --->|                    |
     |                     |   (/readings)       |                    |
     |                     |                     |                    |
     |                     |                     |-- Atualização ---->|
     |                     |                     |   (WebSocket/onValue)
     |                     |                     |                    |
     |                     |                     |-- Cálculo IRM ---->|
     |                     |                     |   (Front-end)      |
     |                     |                     |                    |
     |                     |                     |-- Renderização --->|
     |                     |                     |   (Dashboard)      |
```

### 9.2. Especificação do Pacote LoRa

**Formato CSV:**
```
NODE_ID,temperatura,humidade,valor_chuva,agua_detectada
```

**Exemplo:**
```
1,28.5,72.0,1200,1
```

### 9.3. Temporização

| Evento | Intervalo | Descrição |
|--------|-----------|-----------|
| Leitura de sensores | 30 segundos | Cada transmissor lê os sensores |
| Transmissão LoRa | 30 segundos | Pacote enviado após leitura |
| Envio ao Firebase | 30 segundos | Recetor envia dados agregados |
| Heartbeat | 60 segundos | Timeout para detecção de inatividade |

---

## 10. Conclusão

O sistema VigiMat implementa um conjunto robusto de modelos matemáticos para monitorização ambiental e predição de risco de malária:

### 10.1. Contribuições do Sistema

1. **IRM (Índice de Risco de Malária):** Modelo ponderado que integra temperatura, humidade e presença de água para classificar o risco em três níveis (BAIXO, MÉDIO, ALTO).

2. **LoRa para Telemetria:** Utilização de rádio frequência de longo alcance para transmissão de dados em áreas remotas, com modelagem de perda de sinal (RSSI, SNR) e taxa de perda de pacotes (TPP).

3. **Detecção de Água Estagnada:** Algoritmo de janelas deslizantes que identifica criadouros do mosquito através da análise temporal de leituras dos sensores FC-37.

4. **Arquitetura Desacoplada:** Separação clara entre coleta de dados (ESP32), armazenamento (Firebase) e visualização (Web), permitindo escalabilidade e manutenção.

### 10.2. Aplicações

- **Saúde Pública:** Alertas precoces para surtos de malária
- **Agricultura:** Monitorização de condições ambientais em zonas rurais
- **Pesquisa:** Coleta de dados epidemiológicos para modelos preditivos

### 10.3. Trabalhos Futuros

- Integração com modelos preditivos de machine learning
- Expansão para outros vetores (dengue, zika)
- Implementação de alertas SMS/email
- Aplicação móvel para acesso remoto

---

## Anexo A: Constantes e Parâmetros

| Constante | Valor | Descrição |
|-----------|-------|-----------|
| `RAIN_THRESHOLD` | 2500 | Limiar ADC para detecção de água |
| `SEND_INTERVAL` | 30 | Intervalo entre leituras (segundos) |
| `LORA_FREQ` | 433 | Frequência LoRa (MHz) |
| `LORA_SF` | 12 | Spreading Factor |
| `LORA_TX_POWER` | 17 | Potência de transmissão (dBm) |
| `NTP_SERVER` | pool.ntp.org | Servidor de tempo |
| `GMT_OFFSET_SEC` | 3600 | Fuso horário (UTC+1) |

## Anexo B: Fórmulas Resumidas

| Fórmula | Descrição |
|---------|-----------|
| `IRM = Score_T + Score_H + Score_W` | Índice de Risco de Malária |
| `Score_T = 40×(1 - \|T_avg-30\|/10)` | Sub-score de Temperatura |
| `Score_H = (H_avg-40)/60×35` | Sub-score de Humidade |
| `Score_W = (W1+W2)×12.5` | Sub-score de Água |
| `RSSI(d) = -90 - d/35 + ε` | Intensidade do Sinal |
| `SNR(d) = 10 - d/120 + σ` | Relação Sinal-Ruído |
| `TPP = (Enviados-Rec)/Enviados×100` | Taxa de Perda de Pacotes |
