/*
 * VigiMat - Recetor LoRa + Firebase
 * 
 * Recebe pacotes LoRa dos nós 1 e 2, calcula o risco de malária
 * e envia os dados para o Firebase Realtime Database.
 */

#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include <SPI.h>
#include <LoRa.h>

// ========== CONFIGURAÇÕES Wi-Fi ==========
#define WIFI_SSID "luz"
#define WIFI_PASSWORD "12345678910"

// ========== CONFIGURAÇÕES FIREBASE ==========
#define API_KEY "AIzaSyDEQC4Obd9LbovK0tqmpTcHB0Q5B5_1UEA"
#define DATABASE_URL "https://pro-vigimat-default-rtdb.firebaseio.com"

// ========== CONFIGURAÇÕES LoRa ==========
#define LORA_SS   5
#define LORA_RST  14
#define LORA_DIO0 2
#define LORA_FREQ 433E6          // Mesma frequência dos transmissores

// ========== CONFIGURAÇÕES DE RISCO ==========
// Regras: ALTO: T>=25, H>=70, água; MÉDIO: T>=22, H>=60
#define RISK_HIGH_TEMP 25.0
#define RISK_HIGH_HUM  70.0
#define RISK_MED_TEMP  22.0
#define RISK_MED_HUM   60.0

// ========== OBJETOS FIREBASE ==========
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long lastAlertTime = 0;
String lastRiskSent = "";
const unsigned long ALERT_COOLDOWN = 60000;  // 60 seg

// ========== FUNÇÕES AUXILIARES ==========
void connectWiFi() {
  Serial.print("Conectando Wi-Fi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi conectado.");
}

void initNTP() {
  configTime(3600, 0, "pool.ntp.org");  // UTC+1
  Serial.print("Sincronizando horário...");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) delay(500);
  Serial.println(" OK");
}

unsigned long getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return millis() / 1000;
  return mktime(&timeinfo);
}

String calculateRisk(float temp, float hum, bool water) {
  if (temp >= RISK_HIGH_TEMP && hum >= RISK_HIGH_HUM && water)
    return "ALTO";
  else if (temp >= RISK_MED_TEMP && hum >= RISK_MED_HUM)
    return "MEDIO";
  else
    return "BAIXO";
}

void sendToFirebase(int nodeId, float temp, float hum, int rainValue, bool water, unsigned long ts) {
  if (!Firebase.ready()) {
    Serial.println("Firebase não pronto.");
    return;
  }
  
  String risk = calculateRisk(temp, hum, water);
  
  // Caminho único para cada nó: /readings/node_X/
  String path = "/readings/node_" + String(nodeId);
  
  FirebaseJson json;
  json.set("temp", temp);
  json.set("hum", hum);
  json.set("rain", rainValue);
  json.set("water", water);
  json.set("risk", risk);
  json.set("timestamp", ts);
  
  Serial.printf("Enviando nó %d para Firebase...", nodeId);
  if (Firebase.RTDB.pushJSON(&fbdo, path, &json)) {
    Serial.println(" OK");
  } else {
    Serial.printf(" Falha: %s\n", fbdo.errorReason().c_str());
  }
  
  // Actualizar estado actual do risco para este nó
  String currentPath = "/currentRisk/node_" + String(nodeId);
  Firebase.RTDB.setString(&fbdo, currentPath + "/level", risk);
  Firebase.RTDB.setFloat(&fbdo, currentPath + "/avgTemp", temp);
  Firebase.RTDB.setFloat(&fbdo, currentPath + "/avgHum", hum);
  Firebase.RTDB.setBool(&fbdo, currentPath + "/water", water);
  Firebase.RTDB.setInt(&fbdo, currentPath + "/timestamp", ts);
  
  // Gerar alerta se risco for ALTO ou MÉDIO (com cooldown)
  if ((risk == "ALTO" || risk == "MEDIO") && 
      (risk != lastRiskSent || (millis() - lastAlertTime) > ALERT_COOLDOWN)) {
    
    FirebaseJson alertJson;
    alertJson.set("nodeId", nodeId);
    alertJson.set("risk", risk);
    alertJson.set("temp", temp);
    alertJson.set("hum", hum);
    alertJson.set("water", water);
    alertJson.set("timestamp", ts);
    
    if (Firebase.RTDB.pushJSON(&fbdo, "/alerts", &alertJson)) {
      Serial.println(" Alerta enviado!");
      lastRiskSent = risk;
      lastAlertTime = millis();
    }
  }
}

void setupLoRa() {
  Serial.print("Inicializando LoRa (433 MHz)...");
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println(" Falha!");
    while (1);
  }
  LoRa.setSyncWord(0xF3);   // deve ser igual ao dos transmissores
  Serial.println(" OK");
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Recetor LoRa + Firebase ===");
  
  // Wi-Fi e Firebase
  connectWiFi();
  initNTP();
  
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  
  Serial.print("Autenticação anónima...");
  if (Firebase.signUp(&config, &auth, "", "")) {
    Serial.println(" OK");
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
  Serial.println(Firebase.ready() ? " Pronto" : " Falha");
  
  // LoRa
  setupLoRa();
  
  Serial.println("Aguardando pacotes LoRa...\n");
}

void loop() {
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String packet = "";
    while (LoRa.available()) {
      packet += (char)LoRa.read();
    }
    
    // Exemplo de pacote: "1,25.3,68.2,1024,0"
    int firstComma = packet.indexOf(',');
    int secondComma = packet.indexOf(',', firstComma + 1);
    int thirdComma = packet.indexOf(',', secondComma + 1);
    int fourthComma = packet.indexOf(',', thirdComma + 1);
    
    if (firstComma > 0 && secondComma > 0 && thirdComma > 0 && fourthComma > 0) {
      int nodeId = packet.substring(0, firstComma).toInt();
      float temp = packet.substring(firstComma + 1, secondComma).toFloat();
      float hum = packet.substring(secondComma + 1, thirdComma).toFloat();
      int rainVal = packet.substring(thirdComma + 1, fourthComma).toInt();
      bool water = (packet.substring(fourthComma + 1).toInt() == 1);
      
      unsigned long ts = getTimestamp();
      
      Serial.printf("Pacote recebido (Nó %d): T=%.1f°C H=%.1f%% Água=%d (%s)\n",
                    nodeId, temp, hum, rainVal, water ? "SIM" : "NÃO");
      
      sendToFirebase(nodeId, temp, hum, rainVal, water, ts);
      Serial.println("----------------------------------------\n");
    } else {
      Serial.println("Pacote inválido: " + packet);
    }
  }
  delay(10);
}