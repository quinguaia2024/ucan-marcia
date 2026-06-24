/*
 * VigiMat - Transmissor LoRa (nó com DHT11 + FC37)
 * 
 * Lê temperatura, humidade (DHT11) e nível de água (FC37).
 * Envia os dados via LoRa (433 MHz) para o recetor central.
 * 
 * VERSÃO SIMULADA: Gera dados aleatórios para simular um ambiente real.
 */

#include <SPI.h>
#include <LoRa.h>

// ========== CONFIGURAÇÕES DO NÓ ==========
#define NODE_ID 1               // 1 ou 2 (alterar em cada ESP32)

// Pinos LoRa (SX1278)
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2

// Frequência LoRa (433 MHz)
#define LORA_FREQ 433E6

// Intervalo entre envios (30 segundos)
#define SEND_INTERVAL 30000

// Limiar para detecção de água (valor analógico < 2000 = molhado)
#define RAIN_THRESHOLD 2000

// ========== ESTADO DA SIMULAÇÃO ==========
float current_temp = 28.0;
float current_hum = 75.0;
bool is_raining = false;
unsigned long next_event_time = 0;

// ========== FUNÇÕES ==========
void setupLoRa() {
  Serial.print("Inicializando LoRa...");
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println(" Falha!");
    while (1);
  }
  LoRa.setSyncWord(0xF3);       // Palavra de sincronismo (igual no recetor)
  LoRa.setSpreadingFactor(12);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(17);
  Serial.printf(" OK (freq %.0f MHz)\n", LORA_FREQ/1e6);
}

// Função para gerar dados de sensores simulados e realistas
void generateSimulatedData(float &temp, float &hum, int &rainValue, bool &water) {
  // 1. Simular mudança de chuva
  if (millis() > next_event_time) {
    is_raining = !is_raining;
    Serial.printf("\n*** EVENTO SIMULADO: %s ***\n\n", is_raining ? "Chuva começou" : "Chuva parou");
    // Próximo evento em 2 a 5 minutos
    next_event_time = millis() + random(120000, 300000); 
  }

  // 2. Simular flutuação de temperatura e humidade
  // Adiciona um "ruído" suave aos valores base
  float temp_jitter = (random(-5, 6) / 10.0); // +/- 0.5 graus
  float hum_jitter = (random(-10, 11) / 10.0); // +/- 1.0 %
  
  current_temp += temp_jitter;
  current_hum += hum_jitter;

  // Ajusta humidade se estiver a chover
  if (is_raining) {
    current_hum += 0.5;
  } else {
    current_hum -= 0.2;
  }

  // Manter os valores dentro de limites realistas
  if (current_temp < 22.0) current_temp = 22.0;
  if (current_temp > 34.0) current_temp = 34.0;
  if (current_hum < 60.0) current_hum = 60.0;
  if (current_hum > 98.0) current_hum = 98.0;

  temp = current_temp;
  hum = current_hum;

  // 3. Simular valor do sensor de chuva
  if (is_raining) {
    rainValue = random(800, 1500); // Valor baixo = molhado
  } else {
    rainValue = random(3000, 4000); // Valor alto = seco
  }
  
  water = (rainValue < RAIN_THRESHOLD);
}

void sendLoRaPacket(float temp, float hum, int rainValue, bool water) {
  // Formato: ID, temperatura, humidade, valor_analogico_agua, agua_detectada
  String packet = String(NODE_ID) + "," +
                  String(temp, 1) + "," +
                  String(hum, 1) + "," +
                  String(rainValue) + "," +
                  (water ? "1" : "0");
  
  Serial.print("Enviando: ");
  Serial.println(packet);
  
  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();
}

void setup() {
  Serial.begin(115200);
  Serial.printf("\n--- Transmissor LoRa SIMULADO (Nó %d) ---\n", NODE_ID);
  
  // Inicializa LoRa
  setupLoRa();
  
  // Define o tempo para o primeiro evento de simulação (10-30s)
  next_event_time = millis() + random(10000, 30000);
  
  Serial.printf("Intervalo de envio: %d segundos.\n\n", SEND_INTERVAL/1000);
}

void loop() {
  static unsigned long lastSend = 0;
  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();
    
    float temp, hum;
    int rainVal;
    bool water;
    
    generateSimulatedData(temp, hum, rainVal, water);
    
    Serial.println("--- Leitura dos sensores (SIMULADO) ---");
    Serial.printf("Temperatura: %.1f°C\n", temp);
    Serial.printf("Humidade: %.1f%%\n", hum);
    Serial.printf("Sensor Chuva: %d (%s)\n", rainVal, water ? "ÁGUA DETECTADA" : "SECO");
    
    sendLoRaPacket(temp, hum, rainVal, water);
    Serial.println("-------------------------------------\n");
  }
  delay(100);
}