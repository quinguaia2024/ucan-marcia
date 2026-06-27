/*
 * VigiMat - Recetor LoRa com Interface Firebase
 * 
 * DESCRIÇÃO: Módulo recetor do sistema VigiMat.
 * Recebe os pacotes de dados dos transmissores via LoRa,
 * processa as informações e envia para o Firebase Realtime Database.
 * 
 * HARDWARE:
 * - ESP32 DevKit V1
 * - Módulo LoRa SX1278 (433 MHz)
 * - Conexão Wi-Fi para comunicação com Firebase
 * 
 * FUNCIONAMENTO:
 * - Escuta continuamente pacotes LoRa
 * - Extrai dados de temperatura, humidade e chuva
 * - Calcula médias entre os dois nós
 * - Envia dados para o Firebase a cada 30 segundos
 */

#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include <SPI.h>
#include <LoRa.h>

// ========================== CONFIGURAÇÕES ==========================
// Rede Wi-Fi
#define WIFI_SSID "luz"
#define WIFI_PASSWORD "12345678910"

// Firebase Realtime Database
#define API_KEY "AIzaSyDEQC4Obd9LbovK0tqmpTcHB0Q5B5_1UEA"
#define DATABASE_URL "https://pro-vigimat-default-rtdb.firebaseio.com"

// Módulo LoRa
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2
#define LORA_FREQ 433E6

// Limiar para detecção de água
#define RAIN_THRESHOLD 2500

// Intervalo para envio ao Firebase
#define SEND_INTERVAL 30000

// Servidor NTP para sincronização de horário
#define NTP_SERVER "pool.ntp.org"
#define GMT_OFFSET_SEC 3600
#define DAYLIGHT_OFFSET_SEC 0

// ========================== OBJETOS ==========================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ========================== VARIÁVEIS ==========================
unsigned long lastSendTime = 0;

// Dados do Nó 1
float temp1 = 0, hum1 = 0;
int rain1 = 0;
bool water1 = false;
bool received1 = false;
float rssi1 = 0, snr1 = 0;

// Dados do Nó 2
float temp2 = 0, hum2 = 0;
int rain2 = 0;
bool water2 = false;
bool received2 = false;
float rssi2 = 0, snr2 = 0;

// Médias
float avgTemp = 0, avgHum = 0;
bool waterDetected = false;

// Estatísticas de comunicação
unsigned long totalPacketsReceived = 0;

// ========================== FUNÇÕES ==========================

/*
 * connectWiFi()
 * Estabelece conexão com a rede Wi-Fi configurada.
 */
void connectWiFi() {
  Serial.print("Conectando Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi conectado!");
    Serial.print("  IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFalha na conexão Wi-Fi!");
  }
}

/*
 * initNTP()
 * Sincroniza o relógio do ESP32 com servidor NTP.
 * Utilizado para gerar timestamps precisos.
 */
void initNTP() {
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  Serial.print("Sincronizando horário NTP...");
  
  struct tm timeinfo;
  int attempts = 0;
  while (!getLocalTime(&timeinfo) && attempts < 10) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println(" OK!");
}

/*
 * getTimestamp()
 * Retorna o timestamp Unix atual em segundos.
 * Se o NTP não estiver disponível, usa o tempo de execução.
 */
unsigned long getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return millis() / 1000;
  }
  return mktime(&timeinfo);
}

/*
 * initFirebase()
 * Configura e autentica a conexão com o Firebase.
 * Utiliza autenticação anónima.
 */
void initFirebase() {
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  
  Serial.print("Autenticando no Firebase...");
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println(" OK!");
  } else {
    Serial.printf(" Falha: %s\n", config.signer.signupError.message.c_str());
  }
  
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  Serial.print("Aguardando Firebase...");
  int attempts = 0;
  while (!Firebase.ready() && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println(Firebase.ready() ? " Pronto!" : " Falha!");
}

/*
 * setupLoRa()
 * Inicializa o módulo LoRa no modo recetor.
 * Configura frequência, sincronismo e parâmetros de comunicação.
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
  LoRa.enableCrc();
  
  Serial.println(" OK!");
  Serial.printf("  Frequência: %.0f MHz\n", LORA_FREQ / 1e6);
  Serial.printf("  Spreading Factor: %d\n\n", 12);
}

/*
 * processLoRaPacket()
 * Processa os pacotes recebidos via LoRa.
 * Extrai os dados, identifica o nó de origem e armazena as leituras.
 */
void processLoRaPacket() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;
  
  String packet = "";
  while (LoRa.available()) {
    packet += (char)LoRa.read();
  }
  
  float rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();
  
  // Parse do pacote CSV: "1,25.3,68.2,1200,1"
  int c1 = packet.indexOf(',');
  int c2 = packet.indexOf(',', c1 + 1);
  int c3 = packet.indexOf(',', c2 + 1);
  int c4 = packet.indexOf(',', c3 + 1);
  
  if (c1 < 0 || c2 < 0 || c3 < 0 || c4 < 0) {
    Serial.println("Pacote inválido: " + packet);
    return;
  }
  
  int nodeId = packet.substring(0, c1).toInt();
  float temp = packet.substring(c1 + 1, c2).toFloat();
  float hum = packet.substring(c2 + 1, c3).toFloat();
  int rain = packet.substring(c3 + 1, c4).toInt();
  bool water = (packet.substring(c4 + 1).toInt() == 1);
  
  // Armazena dados conforme o nó de origem
  if (nodeId == 1) {
    temp1 = temp;
    hum1 = hum;
    rain1 = rain;
    water1 = water;
    rssi1 = rssi;
    snr1 = snr;
    received1 = true;
  } else if (nodeId == 2) {
    temp2 = temp;
    hum2 = hum;
    rain2 = rain;
    water2 = water;
    rssi2 = rssi;
    snr2 = snr;
    received2 = true;
  }
  
  totalPacketsReceived++;
  
  Serial.printf("  Nó %d: T=%.1f°C H=%.1f%% Rain=%d %s\n",
                nodeId, temp, hum, rain, water ? "MOLHADO" : "SECO");
  Serial.printf("  RSSI=%.1f dBm SNR=%.1f dB\n", rssi, snr);
}

/*
 * sendToFirebase()
 * Envia os dados processados para o Firebase Realtime Database.
 * Calcula médias, estatísticas de comunicação e gera timestamp.
 */
void sendToFirebase() {
  if (!Firebase.ready()) {
    Serial.println("Firebase não pronto.");
    return;
  }
  
  unsigned long ts = getTimestamp();
  
  // Calcula médias com base nos dados recebidos
  if (received1 && received2) {
    avgTemp = (temp1 + temp2) / 2.0;
    avgHum = (hum1 + hum2) / 2.0;
    waterDetected = (water1 || water2);
  } else if (received1) {
    avgTemp = temp1;
    avgHum = hum1;
    waterDetected = water1;
  } else if (received2) {
    avgTemp = temp2;
    avgHum = hum2;
    waterDetected = water2;
  }
  
  // Prepara o objeto JSON para envio
  FirebaseJson json;
  json.set("temp1", temp1);
  json.set("hum1", hum1);
  json.set("rain1", rain1);
  json.set("water1", water1);
  json.set("temp2", temp2);
  json.set("hum2", hum2);
  json.set("rain2", rain2);
  json.set("water2", water2);
  json.set("avgTemp", avgTemp);
  json.set("avgHum", avgHum);
  json.set("waterDetected", waterDetected);
  json.set("rssi1", rssi1);
  json.set("snr1", snr1);
  json.set("rssi2", rssi2);
  json.set("snr2", snr2);
  json.set("lora_totalPacketsReceived", (int)totalPacketsReceived);
  json.set("timestamp", ts);
  
  Serial.print("Enviando para Firebase...");
  if (Firebase.RTDB.pushJSON(&fbdo, "/readings", &json)) {
    Serial.println(" OK!");
  } else {
    Serial.printf(" Falha: %s\n", fbdo.errorReason().c_str());
  }
  
  // Atualiza o estado atual
  Firebase.RTDB.setFloat(&fbdo, "/currentStatus/avgTemp", avgTemp);
  Firebase.RTDB.setFloat(&fbdo, "/currentStatus/avgHum", avgHum);
  Firebase.RTDB.setBool(&fbdo, "/currentStatus/waterDetected", waterDetected);
  Firebase.RTDB.setInt(&fbdo, "/currentStatus/timestamp", ts);
}

// ========================== SETUP ==========================
void setup() {
  Serial.begin(115200);
  Serial.println("\n========================================");
  Serial.println("  VIGIMAT - RECETOR LoRa + FIREBASE");
  Serial.println("========================================\n");
  
  connectWiFi();
  initNTP();
  initFirebase();
  setupLoRa();
  
  Serial.println("Aguardando pacotes LoRa...\n");
}

// ========================== LOOP ==========================
void loop() {
  processLoRaPacket();
  
  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;
    
    Serial.println("--- Enviando para Firebase ---");
    sendToFirebase();
    Serial.println("----------------------------------------\n");
  }
  
  delay(10);
}