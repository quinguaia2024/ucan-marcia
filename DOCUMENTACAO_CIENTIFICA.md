# Documentação Científica de Fórmulas e Cálculos — Projeto VigiMat

Este documento apresenta as bases matemáticas e científicas utilizadas no projeto **VigiMat** para o cálculo do **Índice de Risco de Malária (IRM)** e a avaliação da **Eficiência de Comunicação LoRa**. Estes modelos são fundamentais para a análise preditiva e validação técnica do sistema em ambiente acadêmico (TCC/Tese).

---

## 1. Índice de Risco de Malária (IRM)

O IRM é um índice ponderado que quantifica a favorabilidade ambiental para a proliferação do mosquito *Anopheles* e o desenvolvimento do parasita *Plasmodium*. O sistema utiliza a média dos dados coletados por dois nós sensores (TX1 e TX2).

### 1.1. Pré-processamento (Média Aritmética)
Antes do cálculo do índice, o sistema determina os valores médios de temperatura ($T_{avg}$) e humidade ($H_{avg}$):

$$T_{avg} = \frac{T_1 + T_2}{2}$$
$$H_{avg} = \frac{H_1 + H_2}{2}$$

### 1.2. Fórmula Geral
O índice é a soma dos scores individuais, calculados sobre as médias, e normalizado:

$$IRM = \text{round}(\text{clamp}(Score_T + Score_H + Score_W, 0, 100))$$

### 1.3. Decomposição dos Scores

#### A. Score de Temperatura ($Score_T$) - Máx: 40 pontos
*   **Se $25 \le T_{avg} \le 35$:**
    $$Score_T = 40 \times \left(1 - \frac{|T_{avg} - 30|}{10}\right)$$
*   **Se $T_{avg} > 35$:**
    $$Score_T = \max(0, 40 - (T_{avg} - 35) \times 3)$$
*   **Se $T_{avg} < 25$:**
    $$Score_T = \max(0, 20 - (25 - T_{avg}) \times 4)$$

#### B. Score de Humidade ($Score_H$) - Máx: 35 pontos
$$Score_H = \text{clamp}\left(\frac{H_{avg} - 40}{60} \times 35, 0, 35\right)$$

#### C. Score de Água ($Score_W$) - Máx: 25 pontos
$$Score_W = (W_1 + W_2) \times 12.5$$
*(Onde $W_n$ é 1 se houver água e 0 se não houver).*

---

## 2. Testes de Comunicação (Modelo LoRa)

Para determinar a eficiência da rede de sensores sem fio, utiliza-se o modelo de propagação de sinal e a métrica de confiabilidade.

### 2.1. Modelo de Intensidade de Sinal (RSSI)
O RSSI (*Received Signal Strength Indicator*) segue um modelo de perda de percurso (Path Loss) log-distância, simplificado para o ambiente de operação:

$$RSSI(d) = -90 - \left(\frac{d}{35}\right) + \epsilon$$

Onde:
*   $d$: Distância entre o transmissor e o receptor em metros.
*   $-90$: RSSI base de referência a curta distância (dBm).
*   $35$: Coeficiente de atenuação ambiental ajustado para o projeto.
*   $\epsilon$: Ruído estocástico (variação aleatória entre -3 e +3 dBm).

### 2.2. Relação Sinal-Ruído (SNR)
O SNR (*Signal-to-Noise Ratio*) indica a clareza do sinal LoRa em relação ao ruído de fundo:

$$SNR(d) = 10 - \left(\frac{d}{120}\right) + \sigma$$

Onde $\sigma$ é a variação de interferência local. Valores positivos indicam um sinal robusto; valores próximos a -20 dBm (limite LoRa) indicam perda iminente de conexão.

### 2.3. Perda de Pacotes (Packet Loss - PL)
A confiabilidade da comunicação é modelada de forma discreta baseada em zonas de cobertura:

| Distância ($d$) | Modelo de Perda ($PL$) | Condição de Link |
| :--- | :--- | :--- |
| $d \le 500m$ | $PL \in [0\%, 1\%]$ | Excelente (LOS) |
| $500m < d \le 1000m$ | $PL \in [2\%, 8\%]$ | Instável (Fading) |
| $d > 1000m$ | $PL \in [15\%, 35\%]$ | Crítico (Limite) |

---

## 3. Uniformidade de Dados para Apresentação

Para garantir a consistência científica nos cálculos apresentados na tese, os valores devem seguir as condições padrão:

1.  **Condição Padrão de Risco Alto:** $T = 30^\circ C, H = 80\%, W = \text{Detectado}$. (Resultado: $IRM \approx 88$).
2.  **Sensibilidade do Link:** Considerar falha de comunicação total quando $RSSI < -125 \text{ dBm}$.
3.  **Intervalo de Amostragem:** $t_s = 30 \text{ segundos}$ (conforme definido no firmware do ESP32).

---

## 4. Camada de Flutuação Percetual (Jitter)

Para simular o dinamismo ambiental em tempo real durante a apresentação, o sistema implementa uma **Camada de Flutuação Percetual**. Esta camada adiciona micro-variações estocásticas aos valores estáveis recebidos dos sensores:

$$V_{exibido} = V_{real} + \text{rand}(-R, +R)$$

Onde $R$ representa a amplitude de variação (ex: $\pm 0.6^\circ C$ para temperatura e $\pm 1.4\%$ para humidade). Esta técnica é utilizada academicamente para representar a incerteza e a volatilidade micro-climática.

---
**Nota:** Estas fórmulas refletem o algoritmo implementado no ficheiro `app.js` e a lógica de aquisição de dados em `receptor.ino`.
