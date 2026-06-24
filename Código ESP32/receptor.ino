/*
 * VigiMat - Recetor LoRa + Firebase
 * 
 * Recebe pacotes LoRa dos nós 1 e 2, agrega os dados, calcula o risco
 * e envia um registo combinado para o Firebase Realtime Database.
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
#define LORA_FREQ 433E6

// ========== CONFIGURAÇÕES DE RISCO ==========
#define RISK_HIGH_TEMP 25.0
#define RISK_HIGH_HUM  70.0
#define RISK_MED_TEMP  22.0
#define RISK_MED_HUM   60.0

// ========== ESTRUTURA DE DADOS DOS NÓS ==========
struct NodeData {
  float temp = 0.0;
  float hum = 0.0;
  int rainVal = 4095;
  bool water = false;
  unsigned long lastUpdate = 0; // Timestamp da última atualização
};

NodeData node1Data;
NodeData node2Data;

// ========== OBJETOS FIREBASE ==========
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ========== CONTROLO DE ENVIO ==========
unsigned long lastSendToFirebase = 0;
const unsigned long FIREBASE_SEND_INTERVAL = 30000; // Enviar a cada 30 segundos
const unsigned long NODE_TIMEOUT = 65000; // Considerar nó offline após 65 segundos

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
  configTime(3600, 0, "pool.ntp.org");
  Serial.print("Sincronizando horário...");
  struct tm timeinfo;
  while (!getLocalTime(&timeinfo)) delay(500);
  Serial.println(" OK");
}

unsigned long getTimestamp() {
  time_t now;
  time(&now);
  return now;
}

String calculateRisk(float avgTemp, float avgHum, bool water1, bool water2) {
  if (avgTemp >= RISK_HIGH_TEMP && avgHum >= RISK_HIGH_HUM && (water1 || water2))
    return "ALTO";
  else if (avgTemp >= RISK_MED_TEMP && avgHum >= RISK_MED_HUM)
    return "MEDIO";
  else
    return "BAIXO";
}

void sendToFirebase() {
  if (!Firebase.ready()) {
    Serial.println("Firebase não pronto.");
    return;
  }

  // Verificar se ambos os nós estão online
  bool node1_online = (millis() - node1Data.lastUpdate) < NODE_TIMEOUT;
  bool node2_online = (millis() - node2Data.lastUpdate) < NODE_TIMEOUT;

  if (!node1_online && !node2_online) {
    Serial.println("Ambos os nós offline. A aguardar...");
    return;
  }

  // Usar dados do nó que estiver online, ou a média se ambos estiverem
  float t1 = node1_online ? node1Data.temp : 0;
  float h1 = node1_online ? node1Data.hum : 0;
  int r1 = node1_online ? node1Data.rainVal : 4095;
  bool w1 = node1_online ? node1Data.water : false;

  float t2 = node2_online ? node2Data.temp : 0;
  float h2 = node2_online ? node2Data.hum : 0;
  int r2 = node2_online ? node2Data.rainVal : 4095;
  bool w2 = node2_online ? node2Data.water : false;

  float avgTemp, avgHum;
  if (node1_online && node2_online) {
    avgTemp = (t1 + t2) / 2.0;
    avgHum = (h1 + h2) / 2.0;
  } else if (node1_online) {
    avgTemp = t1;
    avgHum = h1;
  } else {
    avgTemp = t2;
    avgHum = h2;
  }

  String risk = calculateRisk(avgTemp, avgHum, w1, w2);
  unsigned long ts = getTimestamp();

  FirebaseJson json;
  json.set("temp1", String(t1, 1));
  json.set("hum1", String(h1, 1));
  json.set("rain1", r1);
  json.set("temp2", String(t2, 1));
  json.set("hum2", String(h2, 1));
  json.set("rain2", r2);
  json.set("avgTemp", String(avgTemp, 1));
  json.set("avgHum", String(avgHum, 1));
  json.set("risk", risk);
  json.set("timestamp", (int)ts);

  Serial.println("Enviando dados agregados para Firebase...");
  if (Firebase.RTDB.pushJSON(&fbdo, "/readings", &json)) {
    Serial.println(" -> OK");
  } else {
    Serial.printf(" -> Falha: %s\n", fbdo.errorReason().c_str());
  }
}

void setupLoRa() {
  Serial.print("Inicializando LoRa (433 MHz)...");
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println(" Falha!");
    while (1);
  }
  LoRa.setSyncWord(0xF3);
  Serial.println(" OK");
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== Recetor LoRa Agregador + Firebase ===");
  
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
  
  setupLoRa();
  
  Serial.println("Aguardando pacotes LoRa...\n");
}

void loop() {
  // 1. Verificar se há pacotes LoRa
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String packet = "";
    while (LoRa.available()) {
      packet += (char)LoRa.read();
    }
    
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
      
      Serial.printf("Pacote recebido (Nó %d): T=%.1f H=%.1f R=%d W=%d\n", nodeId, temp, hum, rainVal, water);
      
      if (nodeId == 1) {
        node1Data.temp = temp;
        node1Data.hum = hum;
        node1Data.rainVal = rainVal;
        node1Data.water = water;
        node1Data.lastUpdate = millis();
      } else if (nodeId == 2) {
        node2Data.temp = temp;
        node2Data.hum = hum;
        node2Data.rainVal = rainVal;
        node2Data.water = water;
        node2Data.lastUpdate = millis();
      }
    } else {
      Serial.println("Pacote inválido: " + packet);
    }
  }

  // 2. Verificar se é hora de enviar para o Firebase
  if (millis() - lastSendToFirebase >= FIREBASE_SEND_INTERVAL) {
    lastSendToFirebase = millis();
    sendToFirebase();
    Serial.println("----------------------------------------\n");
  }
  
  delay(10);
}