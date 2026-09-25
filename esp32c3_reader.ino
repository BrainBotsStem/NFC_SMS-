/*
 * Smart student attendance - card reader (works with or without internet)
 *
 * ESP32-C3 SuperMini + PN532 V3 (I2C mode) + green LED + red LED + buzzer.
 *
 * How it works
 *   - The server sends the reader the list of every registered card. The reader
 *     keeps it in flash, so it can accept or refuse a tap by itself in a
 *     millisecond, whether or not the internet is up.
 *   - Every accepted tap is written to flash with its time, then sent to the
 *     server. It stays in flash until the server confirms it, so a tap made
 *     while the internet is down is delivered later, with its real time.
 *   - The server decides in and out from those times, so the result is the same
 *     online or offline.
 *   - Wi-Fi, the broker and the clock are handled by a separate task. A slow or
 *     dead network can never delay reading a card.
 *   - A card the reader does not know is checked with the server if it can be
 *     reached. This also covers adding a new student, because the reader is told
 *     when the enrolment window is open.
 *
 * Libraries (Library Manager):
 *   Adafruit PN532
 *   PubSubClient  by Nick O'Leary
 * Board: ESP32C3 Dev Module (esp32 core 2.0.5 or newer)
 * Partition scheme: any that includes SPIFFS/LittleFS space (the default does)
 * Keep esp32c3_reader.ino and config.h in the same sketch folder.
 *
 * Set the PN532 DIP switches to I2C. On the common red V3 board that is
 * SEL0 = ON, SEL1 = OFF. Check the table printed on the board.
 *
 * Wiring
 *   PN532 VCC -> 5V      (works on 3V3 too, with shorter read range)
 *   PN532 GND -> GND
 *   PN532 SDA -> GPIO4
 *   PN532 SCL -> GPIO5
 *   Green LED -> GPIO6  -> 330R -> GND
 *   Red LED   -> GPIO7  -> 330R -> GND
 *   Buzzer    -> GPIO10 (through an S8050/2N2222 if it draws over ~12 mA)
 */

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <Adafruit_PN532.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <vector>
#include <algorithm>
#include <esp_system.h>
#if __has_include(<esp_random.h>)
#include <esp_random.h>
#endif

#include "config.h"

// Paste the Let's Encrypt root here if USE_TLS_VALIDATION is 1.
static const char ISRG_ROOT_X1[] PROGMEM = R"CERT(
-----BEGIN CERTIFICATE-----
...paste the contents of isrgrootx1.pem here...
-----END CERTIFICATE-----
)CERT";

Adafruit_PN532 nfc(PIN_PN532_IRQ, PIN_PN532_RESET);
WiFiClientSecure net;
PubSubClient mqtt(net);
Preferences prefs;

// Two tasks share the data below. dataLock guards the small in-memory pieces
// and is only ever held for an instant. fsLock guards the flash file system,
// where a write can take a few tens of milliseconds.
static SemaphoreHandle_t dataLock;
static SemaphoreHandle_t fsLock;

struct Guard {
  SemaphoreHandle_t m;
  explicit Guard(SemaphoreHandle_t mutex) : m(mutex) { xSemaphoreTake(m, portMAX_DELAY); }
  ~Guard() { xSemaphoreGive(m); }
};

static char topicScan[64];
static char topicCmd[64];
static char topicStatus[64];
static char topicAck[64];
static char topicTime[64];
static char topicRoster[64];
static char topicEnrol[64];
static char topicBeat[64];

// ------------------------------------------------------------------- types --
// Kept above the first function: the Arduino build inserts function declarations
// at the top of the file, and they must be able to see these types.

static const uint8_t F_APPROX = 1;

// One card tap. Written to flash exactly as it is in memory.
struct Tap {
  uint32_t boot;   // random number for this power-on, so ids never repeat across restarts
  uint32_t seq;    // counts taps within this power-on
  uint32_t epoch;  // unix time of the tap, 0 if unknown
  uint32_t upMs;   // millis() at the tap, used to correct the time later
  uint8_t flags;
  char uid[23];    // hex text, up to 10 bytes
};
static_assert(sizeof(Tap) == 40, "Tap is written to flash as-is; keep it 40 bytes");

struct Pending {
  Tap tap;
  uint32_t sentAt;  // millis() when last sent, 0 = not sent yet
};

enum Verdict { V_TIMEOUT, V_OK, V_DENY };


// ----------------------------------------------------------------- outputs --

static void buzzer(bool on) {
#if BUZZER_ACTIVE_HIGH
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
#else
  digitalWrite(PIN_BUZZER, on ? LOW : HIGH);
#endif
}

// The lights and beeps run on their own small task and never make the card
// reader wait. A student can tap again while the last light is still on.
enum : uint8_t { FB_NONE, FB_OK, FB_BAD, FB_NOANSWER, FB_READY };
static volatile uint8_t fbKind = FB_NONE;
static volatile uint32_t fbStart = 0;

static void feedbackStart(uint8_t kind) {
  fbStart = millis();
  fbKind = kind;
}

static void feedbackTick() {
  uint8_t kind = fbKind;
  uint32_t e = millis() - fbStart;
  bool green = false, red = false, beep = false;

  switch (kind) {
    case FB_OK:  // green light, one beep
      green = e < OK_LED_MS;
      beep = e < OK_BEEP_MS;
      if (!green) fbKind = FB_NONE;
      break;
    case FB_BAD: {  // red light, three beeps
      const uint32_t period = BAD_BEEP_MS + BAD_BEEP_GAP_MS;
      red = e < 3 * period + 300;
      beep = e < 3 * period && (e % period) < BAD_BEEP_MS;
      if (!red) fbKind = FB_NONE;
      break;
    }
    case FB_NOANSWER:  // red light, no beeps: could not decide, cannot be mistaken for a refusal
      red = e < 1000;
      if (!red) fbKind = FB_NONE;
      break;
    case FB_READY:  // one short beep at start-up
      beep = e < 60;
      if (!beep) fbKind = FB_NONE;
      break;
    default:
      break;
  }

  digitalWrite(PIN_LED_OK, green ? HIGH : LOW);
  digitalWrite(PIN_LED_BAD, red ? HIGH : LOW);
  buzzer(beep);
}

static void feedbackTask(void *) {
  for (;;) {
    feedbackTick();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ------------------------------------------------------------------- clock --
// The clock comes from NTP, or from the server if NTP is blocked. Until then a
// tap is stamped with the last saved time plus the time since power-on, and is
// marked approximate. Once the real time is known, taps from this power-on are
// corrected.

static uint32_t savedEpoch = 0;

static bool clockValid() { return time(nullptr) >= (time_t)MIN_VALID_EPOCH; }

static uint32_t nowEpoch(bool &approx) {
  if (clockValid()) {
    approx = false;
    return (uint32_t)time(nullptr);
  }
  approx = true;
  return savedEpoch ? savedEpoch + millis() / 1000 : 0;
}

// ------------------------------------------------------------ stored taps --

static const char QUEUE_FILE[] = "/taps.bin";
static const char QUEUE_TMP[] = "/taps.tmp";
static const char ROSTER_FILE[] = "/roster.txt";
static const char QUEUE_MAGIC[4] = {'B', 'B', 'T', '1'};

static std::vector<Pending> pend;  // taps not yet confirmed by the server (dataLock)
static bool queueDirty = false;    // the file no longer matches memory (dataLock)
static uint32_t bootId = 0;
static uint32_t tapSeq = 0;  // main task only

// Caller holds fsLock.
static bool writeQueueFileLocked(const std::vector<Pending> &items) {
  File f = LittleFS.open(QUEUE_TMP, "w");
  if (!f) return false;
  f.write((const uint8_t *)QUEUE_MAGIC, sizeof QUEUE_MAGIC);
  for (const Pending &p : items) f.write((const uint8_t *)&p.tap, sizeof(Tap));
  f.close();
  LittleFS.remove(QUEUE_FILE);
  return LittleFS.rename(QUEUE_TMP, QUEUE_FILE);
}

static void loadQueue() {
  Guard fsg(fsLock);
  // A power cut between remove and rename in writeQueueFileLocked leaves only the temp file.
  if (!LittleFS.exists(QUEUE_FILE) && LittleFS.exists(QUEUE_TMP)) LittleFS.rename(QUEUE_TMP, QUEUE_FILE);

  bool good = false;
  File f = LittleFS.open(QUEUE_FILE, "r");
  if (f) {
    char magic[sizeof QUEUE_MAGIC];
    if (f.read((uint8_t *)magic, sizeof magic) == sizeof magic && memcmp(magic, QUEUE_MAGIC, sizeof magic) == 0) {
      good = true;
      Tap t;
      while (f.read((uint8_t *)&t, sizeof t) == sizeof t) {
        t.uid[sizeof t.uid - 1] = 0;
        Pending p = {t, 0};
        pend.push_back(p);
      }
    }
    f.close();
  }
  while (pend.size() > MAX_QUEUE) pend.erase(pend.begin());
  if (!good) writeQueueFileLocked(pend);  // start a fresh, empty file
  Serial.printf("[store] %u tap(s) waiting to upload\n", (unsigned)pend.size());
}

static void appendTapToFile(const Tap &t) {
  Guard fsg(fsLock);
  File f = LittleFS.open(QUEUE_FILE, "a");
  if (!f) return;
  f.write((const uint8_t *)&t, sizeof t);
  f.close();
}

// Store one tap: in memory for uploading, and in flash so a power cut cannot lose it.
static void enqueueTap(const char *uid) {
  Tap t;
  memset(&t, 0, sizeof t);
  bool approx;
  t.epoch = nowEpoch(approx);
  t.flags = approx ? F_APPROX : 0;
  t.upMs = millis();
  t.boot = bootId;
  t.seq = ++tapSeq;
  strncpy(t.uid, uid, sizeof t.uid - 1);

  {
    Guard g(dataLock);
    if (pend.size() >= MAX_QUEUE) {
      pend.erase(pend.begin());  // oldest goes first
      queueDirty = true;
      Serial.println("[store] queue full, dropped the oldest tap");
    }
    Pending p = {t, 0};
    pend.push_back(p);
  }
  appendTapToFile(t);
}

// Rewrites the file from memory once taps have been confirmed and removed.
static void compactQueue() {
  static uint32_t last = 0;
  std::vector<Pending> copy;
  {
    Guard g(dataLock);
    if (!queueDirty) return;
    if (!pend.empty() && (int32_t)(millis() - last) < 20000) return;
    copy = pend;
    queueDirty = false;
  }
  last = millis();
  Guard fsg(fsLock);
  writeQueueFileLocked(copy);
}

// Taps made before the clock was known get their real time now.
static void fixApproxTimes() {
  bool approx;
  uint32_t nowEp = nowEpoch(approx);
  uint32_t nowUp = millis();
  Guard g(dataLock);
  for (Pending &p : pend) {
    if ((p.tap.flags & F_APPROX) && p.tap.boot == bootId) {
      p.tap.epoch = nowEp - (nowUp - p.tap.upMs) / 1000;
      p.tap.flags &= ~F_APPROX;
      queueDirty = true;
    }
  }
}

// ------------------------------------------------------------------ roster --
// Only card numbers are kept, as 64-bit fingerprints in a sorted list. Names
// and details stay on the server.

static std::vector<uint64_t> roster;  // dataLock
static bool rosterReady = false;      // dataLock
static char rosterVersion[24] = "";   // dataLock

static uint64_t hashUid(const char *s) {
  uint64_t h = 1469598103934665603ULL;  // FNV-1a
  while (*s) {
    h ^= (uint8_t)*s++;
    h *= 1099511628211ULL;
  }
  return h;
}

static bool rosterHas(const char *uid) {
  uint64_t h = hashUid(uid);
  Guard g(dataLock);
  return rosterReady && std::binary_search(roster.begin(), roster.end(), h);
}

static bool rosterIsReady() {
  Guard g(dataLock);
  return rosterReady;
}

// Payload: "<version>|UID,UID,...". Returns false if it is malformed.
static bool applyRoster(const char *data, size_t len, bool persist) {
  const char *bar = (const char *)memchr(data, '|', len);
  if (!bar) return false;
  size_t vl = (size_t)(bar - data);
  if (vl == 0 || vl >= sizeof rosterVersion) return false;

  char version[sizeof rosterVersion];
  memcpy(version, data, vl);
  version[vl] = 0;

  {
    Guard g(dataLock);
    if (rosterReady && strcmp(version, rosterVersion) == 0) return true;  // nothing changed
  }

  std::vector<uint64_t> fresh;
  const char *end = data + len;
  char uid[24];
  size_t n = 0;
  for (const char *p = bar + 1; p <= end; p++) {
    char c = (p < end) ? *p : ',';
    if (c == ',' || c == '\n' || c == '\r') {
      if (n) {
        uid[n] = 0;
        fresh.push_back(hashUid(uid));
        n = 0;
      }
    } else if (n < sizeof uid - 1) {
      uid[n++] = (char)toupper((unsigned char)c);
    }
  }
  std::sort(fresh.begin(), fresh.end());
  fresh.erase(std::unique(fresh.begin(), fresh.end()), fresh.end());
  size_t count = fresh.size();

  {
    Guard g(dataLock);
    roster.swap(fresh);
    strcpy(rosterVersion, version);
    rosterReady = true;
  }

  if (persist) {
    Guard fsg(fsLock);
    File f = LittleFS.open(ROSTER_FILE, "w");
    if (f) {
      f.write((const uint8_t *)data, len);
      f.close();
    }
  }
  Serial.printf("[roster] %u card(s), version %s\n", (unsigned)count, version);
  return true;
}

static void loadRoster() {
  char *buf = nullptr;
  size_t len = 0;
  {
    Guard fsg(fsLock);
    File f = LittleFS.open(ROSTER_FILE, "r");
    if (!f) return;
    len = f.size();
    if (len > 0 && len < 65536) {
      buf = (char *)malloc(len);
      if (buf && f.read((uint8_t *)buf, len) != len) {
        free(buf);
        buf = nullptr;
      }
    }
    f.close();
  }
  if (buf) {
    applyRoster(buf, len, false);
    free(buf);
  }
}

// -------------------------------------------------- server questions/answers --

static volatile bool mqttUp = false;
static volatile uint32_t enrolUntil = 0;  // millis() until which enrolment is open, 0 = closed

static char liveUid[24];
static volatile bool liveRequest = false;
static volatile uint32_t liveNonce = 0;
static volatile uint8_t liveVerdict = 0;  // 0 = waiting, 1 = ok, 2 = deny

// Ask the server about one tap and wait briefly for the answer. The network
// task does the actual sending. Used only for cards the reader cannot judge.
static Verdict askServer(const char *uid) {
  {
    Guard g(dataLock);
    strncpy(liveUid, uid, sizeof liveUid - 1);
    liveUid[sizeof liveUid - 1] = 0;
  }
  liveVerdict = 0;
  liveNonce = liveNonce + 1;
  liveRequest = true;

  uint32_t deadline = millis() + VERDICT_TIMEOUT_MS;
  while (liveVerdict == 0 && (int32_t)(deadline - millis()) > 0) delay(2);
  liveRequest = false;  // withdraw it if it was never sent

  if (liveVerdict == 1) return V_OK;
  if (liveVerdict == 2) return V_DENY;
  return V_TIMEOUT;
}

// Small helpers to read numbers and text out of the server's short JSON messages.
static bool jsonUInt(const char *body, const char *key, uint32_t &out) {
  char pat[16];
  snprintf(pat, sizeof pat, "\"%s\":", key);
  const char *p = strstr(body, pat);
  if (!p) return false;
  p += strlen(pat);
  while (*p == ' ') p++;
  if (*p < '0' || *p > '9') return false;
  out = (uint32_t)strtoul(p, nullptr, 10);
  return true;
}

static void onAck(const char *body) {
  const char *k = strstr(body, "\"id\":\"");
  if (!k) return;
  k += 6;
  char *dash = nullptr;
  uint32_t boot = (uint32_t)strtoul(k, &dash, 16);
  if (!dash || *dash != '-') return;
  uint32_t seq = (uint32_t)strtoul(dash + 1, nullptr, 10);

  Guard g(dataLock);
  size_t before = pend.size();
  pend.erase(std::remove_if(pend.begin(), pend.end(),
                            [boot, seq](const Pending &p) { return p.tap.boot == boot && p.tap.seq == seq; }),
             pend.end());
  if (pend.size() != before) queueDirty = true;
}

static void onCommand(const char *body) {
  uint32_t n;
  if (jsonUInt(body, "n", n) && n != liveNonce) return;  // an answer to an older question
  if (strstr(body, "\"ok\""))
    liveVerdict = 1;
  else if (strstr(body, "\"deny\""))
    liveVerdict = 2;
}

static void onServerTime(const char *body) {
  uint32_t t;
  if (clockValid() || !jsonUInt(body, "t", t) || t < MIN_VALID_EPOCH) return;
  struct timeval tv = {(time_t)t, 0};
  settimeofday(&tv, nullptr);
  Serial.println("[clock] set from the server");
}

static void onEnrol(const char *body) {
  uint32_t isOpen = 0, secs = 0;
  jsonUInt(body, "open", isOpen);
  jsonUInt(body, "secs", secs);
  if (isOpen && secs) {
    uint32_t until = millis() + secs * 1000UL;
    enrolUntil = until ? until : 1;
    Serial.printf("[enrol] open for %us\n", (unsigned)secs);
  } else {
    enrolUntil = 0;
    Serial.println("[enrol] closed");
  }
}

static void onMessage(char *topic, byte *payload, unsigned int len) {
  if (strcmp(topic, topicRoster) == 0) {
    applyRoster((const char *)payload, len, true);
    return;
  }
  char body[160];
  size_t n = len < sizeof body - 1 ? len : sizeof body - 1;
  memcpy(body, payload, n);
  body[n] = 0;

  if (strcmp(topic, topicAck) == 0)
    onAck(body);
  else if (strcmp(topic, topicCmd) == 0)
    onCommand(body);
  else if (strcmp(topic, topicTime) == 0)
    onServerTime(body);
  else if (strcmp(topic, topicEnrol) == 0)
    onEnrol(body);
}

// ---------------------------------------------------------- network task --

static bool wifiWasUp = false;

static void manageWifi() {
  static uint32_t lastBegin = 0;
  static bool begun = false;

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasUp) {
      wifiWasUp = true;
      Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }
  if (wifiWasUp) {
    wifiWasUp = false;
    Serial.println("[wifi] lost");
  }
  if (!begun || (int32_t)(millis() - lastBegin) > WIFI_RETRY_MS) {
    if (begun) WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    begun = true;
    lastBegin = millis();
  }
}

static void manageClock() {
  static bool ntpStarted = false;
  static bool announced = false;
  static uint32_t lastSave = 0;

  if (wifiWasUp && !ntpStarted) {
    configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
    ntpStarted = true;
  }
  if (!clockValid()) return;

  if (!announced) {
    announced = true;
    fixApproxTimes();
    Serial.printf("[clock] time is %lu\n", (unsigned long)time(nullptr));
  }
  if (lastSave == 0 || (int32_t)(millis() - lastSave) > CLOCK_SAVE_MS) {
    savedEpoch = (uint32_t)time(nullptr);
    prefs.putUInt("epoch", savedEpoch);
    lastSave = millis() ? millis() : 1;
  }
}

static void manageMqtt() {
  static uint32_t lastTry = 0;

  if (mqtt.connected()) {
    mqttUp = true;
    return;
  }
  if (mqttUp) {
    mqttUp = false;
    Serial.println("[mqtt] lost");
  }
  if (!wifiWasUp) return;
  if (lastTry && (int32_t)(millis() - lastTry) < MQTT_RETRY_MS) return;
  lastTry = millis() ? millis() : 1;

  char clientId[48];
  snprintf(clientId, sizeof clientId, "reader-%s-%08lx", DEVICE_ID, (unsigned long)(uint32_t)ESP.getEfuseMac());
  Serial.print("[mqtt] connecting... ");
  if (!mqtt.connect(clientId, MQTT_USERNAME, MQTT_PASSWORD, topicStatus, 1, true, "offline")) {
    Serial.printf("failed rc=%d\n", mqtt.state());
    return;
  }
  Serial.println("connected");
  // Subscribe before announcing "online": the server answers that with the time.
  mqtt.subscribe(topicRoster, 1);
  mqtt.subscribe(topicEnrol, 1);
  mqtt.subscribe(topicAck, 1);
  mqtt.subscribe(topicCmd, 1);
  mqtt.subscribe(topicTime, 0);
  mqtt.publish(topicStatus, "online", true);
  mqttUp = true;

  // Anything sent before the connection dropped may not have arrived. Send it again.
  Guard g(dataLock);
  for (Pending &p : pend) p.sentAt = 0;
}

// A card the reader could not judge: send it to the server now.
static void pumpLive() {
  if (!liveRequest) return;
  liveRequest = false;
  char msg[96];
  {
    Guard g(dataLock);
    snprintf(msg, sizeof msg, "{\"uid\":\"%s\",\"n\":%lu}", liveUid, (unsigned long)liveNonce);
  }
  mqtt.publish(topicScan, msg);
}

// Send stored taps, oldest first, a few at a time. Each stays stored until the
// server's confirmation arrives; if none comes it is sent again.
static void pumpUploads() {
  char out[UPLOAD_WINDOW][128];
  int count = 0;
  uint32_t now = millis();
  if (now == 0) now = 1;

  {
    Guard g(dataLock);
    int inFlight = 0;
    for (const Pending &p : pend)
      if (p.sentAt && (int32_t)(now - p.sentAt) < ACK_TIMEOUT_MS) inFlight++;

    for (Pending &p : pend) {
      if (inFlight + count >= UPLOAD_WINDOW) break;
      bool due = !p.sentAt || (int32_t)(now - p.sentAt) >= ACK_TIMEOUT_MS;
      if (!due) continue;
      p.sentAt = now;
      snprintf(out[count], sizeof out[count], "{\"uid\":\"%s\",\"t\":%lu,\"a\":%d,\"id\":\"%08lx-%lu\"}", p.tap.uid,
               (unsigned long)p.tap.epoch, (p.tap.flags & F_APPROX) ? 1 : 0, (unsigned long)p.tap.boot,
               (unsigned long)p.tap.seq);
      count++;
    }
  }

  for (int i = 0; i < count; i++) mqtt.publish(topicScan, out[i]);
}

// Tells the server the reader is still there. A reader that loses power sends
// no "offline" itself, so the server uses the silence to show it off quickly.
static void pumpHeartbeat() {
  static uint32_t last = 0;
  if (last && (int32_t)(millis() - last) < HEARTBEAT_MS) return;
  last = millis() ? millis() : 1;
  mqtt.publish(topicBeat, "1");
}

static void networkTask(void *) {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  // Wi-Fi power saving delays incoming packets, which makes the TLS link to the
  // broker drop now and then. The reader is mains powered, so keep the radio awake.
  WiFi.setSleep(false);

  for (;;) {
    manageWifi();
    manageClock();
    manageMqtt();
    if (mqttUp) {
      mqtt.loop();
      pumpLive();
      pumpHeartbeat();
      pumpUploads();
      compactQueue();
    }
    vTaskDelay(pdMS_TO_TICKS(15));
  }
}

// ------------------------------------------------------------------ setup --

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_BAD, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_LED_OK, LOW);
  digitalWrite(PIN_LED_BAD, LOW);
  buzzer(false);

  dataLock = xSemaphoreCreateMutex();
  fsLock = xSemaphoreCreateMutex();
  bootId = esp_random();

  snprintf(topicScan, sizeof(topicScan), "%s/%s/scan", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicCmd, sizeof(topicCmd), "%s/%s/cmd", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicStatus, sizeof(topicStatus), "%s/%s/status", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicAck, sizeof(topicAck), "%s/%s/ack", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicTime, sizeof(topicTime), "%s/%s/time", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicRoster, sizeof(topicRoster), "%s/roster", TOPIC_ROOT);
  snprintf(topicEnrol, sizeof(topicEnrol), "%s/enrol", TOPIC_ROOT);
  snprintf(topicBeat, sizeof(topicBeat), "%s/%s/beat", TOPIC_ROOT, DEVICE_ID);

  Wire.setPins(PIN_SDA, PIN_SCL);
  nfc.begin();
  uint32_t version = nfc.getFirmwareVersion();
  if (!version) {
    Serial.println("[pn532] not found. Check the DIP switches are set to I2C and the wiring.");
    // Slow red blink so the fault is visible without a serial monitor.
    while (true) {
      digitalWrite(PIN_LED_BAD, HIGH);
      delay(200);
      digitalWrite(PIN_LED_BAD, LOW);
      delay(800);
    }
  }
  Serial.printf("[pn532] firmware %d.%d\n", (int)((version >> 16) & 0xFF), (int)((version >> 8) & 0xFF));
  nfc.SAMConfig();

  // Everything the reader needs to work without a network is loaded from flash first.
  if (!LittleFS.begin(true)) Serial.println("[store] flash file system failed to start");
  prefs.begin("reader", false);
  savedEpoch = prefs.getUInt("epoch", 0);
  loadRoster();
  loadQueue();

#if USE_TLS_VALIDATION
  net.setCACert(ISRG_ROOT_X1);
#else
  net.setInsecure();
#endif
  net.setHandshakeTimeout(8);  // seconds. A dead link must not hold the network task for minutes.
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(16384);  // the whole roster arrives in one message
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setSocketTimeout(5);

  xTaskCreate(feedbackTask, "feedback", 2048, nullptr, 1, nullptr);
  xTaskCreate(networkTask, "network", 16384, nullptr, 1, nullptr);

  // One short beep once the reader is ready to use. It needs no network to be ready.
  feedbackStart(FB_READY);
  Serial.println("[ready] reading cards");
}

// ------------------------------------------------------------------- loop --

static char lastUid[24] = "";
static uint32_t lastSeenAt = 0;

static void handleTap(const char *uid) {
  uint32_t started = millis();
  uint32_t until = enrolUntil;
  bool enrolOpen = until && (int32_t)(until - millis()) > 0;

  // Fast path: a registered card is accepted straight away, with no network.
  if (!enrolOpen && rosterHas(uid)) {
    feedbackStart(FB_OK);
    enqueueTap(uid);
    Serial.printf("[card] %s ok in %lums\n", uid, (unsigned long)(millis() - started));
    return;
  }

  // The reader cannot judge this one: it is not on the list, the list has not
  // arrived yet, or an admin is adding a student. Ask the server if it can be reached.
  Verdict v = mqttUp ? askServer(uid) : V_TIMEOUT;
  if (v == V_OK) {
    feedbackStart(FB_OK);
  } else if (v == V_DENY) {
    feedbackStart(FB_BAD);
  } else {
    // Server out of reach. Keep the tap in case the card is real and our list is out of date.
    if (!enrolOpen) enqueueTap(uid);
    feedbackStart((!enrolOpen && rosterIsReady()) ? FB_BAD : FB_NOANSWER);
  }
  Serial.printf("[card] %s %s\n", uid, v == V_OK ? "ok (server)" : v == V_DENY ? "refused (server)" : "no answer");
}

void loop() {
  uint8_t raw[7];
  uint8_t rawLen;

  // Returns the moment a card is in range. The wait only applies when there is no card.
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, raw, &rawLen, 100)) {
    delay(1);  // always let the other tasks run
    return;
  }

  char uid[16];
  for (uint8_t i = 0; i < rawLen && i < 7; i++) snprintf(uid + 2 * i, 3, "%02X", raw[i]);

  // A card left on the reader is read over and over. Count it once, until it is taken away.
  uint32_t now = millis();
  if (strcmp(uid, lastUid) == 0 && (int32_t)(now - lastSeenAt) < SAME_CARD_HOLD_MS) {
    lastSeenAt = now;
    return;
  }
  strcpy(lastUid, uid);
  lastSeenAt = now;

  handleTap(uid);
  lastSeenAt = millis();
}
