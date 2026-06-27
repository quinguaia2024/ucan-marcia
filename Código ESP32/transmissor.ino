/*
 * VigiMat - Transmissor LoRa
 * 
 * DESCRIÇÃO: Módulo transmissor do sistema VigiMat.
 * Realiza a leitura de sensores ambientais e transmite os dados
 * via rádio frequência (LoRa) para o recetor central.
 * 
 * HARDWARE:
 * - ESP32 DevKit V1
 * - Módulo LoRa SX1278 (433 MHz)
 * - Sensor DHT11 (Temperatura e Humidade)
 * - Sensor FC-37 (Detecção de Água/Chuva)
 * 
 * FUNCIONAMENTO:
 * - A cada 30 segundos, lê os sensores
 * - Empacota os dados em formato CSV
 * - Transmite via LoRa para o recetor
 */

#include <SPI.h>
#include <LoRa.h>
#include <DHT.h>

// ========================== CONFIGURAÇÕES ==========================
// Identificador do nó (definir 1 ou 2 conforme o hardware)
#define NODE_ID 1

// Pinos dos sensores
#define DHT_PIN   2        // DHT11 - Data
#define RAIN_PIN  34        // FC-37 - Saída Analógica

#define DHT_TYPE DHT11

// Pinos do módulo LoRa
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2

// Frequência de operação (433 MHz)
#define LORA_FREQ 433E6

// Intervalo entre leituras e transmissões
#define SEND_INTERVAL 30000

// Limiar para detecção de água (leitura analógica)
#define RAIN_THRESHOLD 2500

// ========================== OBJETOS ==========================
DHT dht(DHT_PIN, DHT_TYPE);

// ========================== VARIÁVEIS ==========================
unsigned long lastSendTime = 0;
float temperature = 0;
float humidity = 0;
int rainValue = 0;
bool waterDetected = false;
int packetCounter = 0;

// ========================== FUNÇÕES ==========================

/*
 * setupLoRa()
 * Inicializa o módulo LoRa com os parâmetros de configuração.
 * Define frequência, fator de espalhamento, potência e CRC.
 */
void setupLoRa() {
  Serial.print("Inicializando LoRa (433 MHz)...");
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println(" FALHA!");
    Serial.println("Verifique as ligações do módulo LoRa.");
    while (1) {
      delay(1000);
      Serial.print(".");
    }
  }
  
  LoRa.setSyncWord(0xF3);
  LoRa.setSpreadingFactor(12);
  LoRa.setCodingRate4(5);
  LoRa.setTxPower(17);
  LoRa.enableCrc();
  
  Serial.println(" OK!");
  Serial.printf("  Frequência: %.0f MHz\n", LORA_FREQ / 1e6);
  Serial.printf("  Spreading Factor: %d\n", 12);
  Serial.printf("  Potência: %d dBm\n\n", 17);
}

/*
 * readSensors()
 * Efetua a leitura dos sensores conectados ao ESP32.
 * - DHT11: temperatura e humidade (com 3 tentativas)
 * - FC-37: leitura analógica para detecção de água
 */
void readSensors() {
  int attempts = 3;
  while (attempts--) {
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    
    if (!isnan(temperature) && !isnan(humidity)) {
      break;
    }
    delay(200);
  }
  
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("  [ERRO] Falha na leitura do DHT11");
  }
  
  rainValue = analogRead(RAIN_PIN);
  waterDetected = (rainValue < RAIN_THRESHOLD);
}

/*
 * sendLoRaPacket()
 * Constrói o pacote no formato CSV e transmite via LoRa.
 * Formato: NODE_ID,temperatura,humidade,chuva,agua_detectada
 */
void sendLoRaPacket() {
  String packet = String(NODE_ID) + "," +
                  String(temperature, 1) + "," +
                  String(humidity, 1) + "," +
                  String(rainValue) + "," +
                  (waterDetected ? "1" : "0");
  
  Serial.print("  Transmitindo: ");
  Serial.println(packet);
  
  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();
  
  packetCounter++;
}

// ========================== SETUP ==========================
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("  VIGIMAT - TRANSMISSOR LoRa");
  Serial.printf("  Nó ID: %d\n", NODE_ID);
  Serial.println("========================================\n");
  
  dht.begin();
  analogReadResolution(12);
  pinMode(RAIN_PIN, INPUT);
  
  Serial.println("Teste inicial dos sensores:");
  float testTemp = dht.readTemperature();
  float testHum = dht.readHumidity();
  int testRain = analogRead(RAIN_PIN);
  
  Serial.printf("  DHT11: T=%.1f°C H=%.1f%%\n", testTemp, testHum);
  Serial.printf("  FC-37: %d (%s)\n", testRain, (testRain < RAIN_THRESHOLD) ? "MOLHADO" : "SECO");
  Serial.println();
  
  setupLoRa();
  
  Serial.printf("Intervalo de transmissão: %d segundos\n", SEND_INTERVAL / 1000);
  Serial.println("Aguardando próximo ciclo...\n");
}

// ========================== LOOP ==========================
void loop() {
  unsigned long now = millis();
  
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;
    
    Serial.printf("--- Ciclo %d ---\n", packetCounter + 1);
    
    readSensors();
    
    Serial.printf("  DHT11: T=%.1f°C H=%.1f%%\n", temperature, humidity);
    Serial.printf("  FC-37: %d %s\n", rainValue, waterDetected ? "MOLHADO" : "SECO");
    
    sendLoRaPacket();
    
    Serial.printf("  Pacotes transmitidos: %d\n\n", packetCounter);
  }
  
  delay(100);
}