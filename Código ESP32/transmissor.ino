/*
 * VigiMat - Transmissor LoRa (nó com DHT11 + FC37)
 * 
 * Lê temperatura, humidade (DHT11) e nível de água (FC37).
 * Envia os dados via LoRa (433 MHz) para o recetor central.
 */

#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>

// ========== CONFIGURAÇÕES DO NÓ ==========
#define NODE_ID 1               // 1 ou 2 (alterar em cada ESP32)

// Pinos dos sensores
#define DHT_PIN   22            // DHT11 (GPIO22)
#define RAIN_PIN  34            // FC37 (GPIO34 - ADC)

#define DHT_TYPE DHT11

// Pinos LoRa (SX1278)
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2

// Frequência LoRa (433 MHz)
#define LORA_FREQ 433E6

// Intervalo entre envios (30 segundos)
#define SEND_INTERVAL 30000

// Limiar para detecção de água (valor analógico < 1200 = molhado)
#define RAIN_THRESHOLD 1200

// ========== OBJETOS ==========
DHT dht(DHT_PIN, DHT_TYPE);

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

void readSensors(float &temp, float &hum, int &rainValue, bool &water) {
  // Leitura do DHT11 (com tentativas)
  int attempts = 3;
  while (attempts--) {
    temp = dht.readTemperature();
    hum = dht.readHumidity();
    if (!isnan(temp) && !isnan(hum)) break;
    delay(200);
  }
  if (isnan(temp)) temp = 0;
  if (isnan(hum)) hum = 0;

  // Leitura do sensor de água (FC37)
  rainValue = analogRead(RAIN_PIN);
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
  Serial.printf("\n--- Transmissor LoRa (Nó %d) ---\n", NODE_ID);
  
  // Inicializa sensores
  dht.begin();
  analogReadResolution(12);     // ADC 0-4095
  pinMode(RAIN_PIN, INPUT);
  
  // Inicializa LoRa
  setupLoRa();
  
  Serial.printf("Intervalo de envio: %d segundos.\n\n", SEND_INTERVAL/1000);
}

void loop() {
  static unsigned long lastSend = 0;
  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();
    
    float temp, hum;
    int rainVal;
    bool water;
    
    readSensors(temp, hum, rainVal, water);
    
    Serial.println("--- Leitura dos sensores ---");
    Serial.printf("Temperatura: %.1f°C\n", temp);
    Serial.printf("Humidade: %.1f%%\n", hum);
    Serial.printf("FC37: %d (%s)\n", rainVal, water ? "MOLHADO" : "SECO");
    
    sendLoRaPacket(temp, hum, rainVal, water);
    Serial.println("----------------------------\n");
  }
  delay(100);
}