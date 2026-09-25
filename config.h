#pragma once

// ---------------------------------------------------------------- network --
// The ESP32-C3 only joins 2.4 GHz Wi-Fi, not 5 GHz.
#define WIFI_SSID      "Thanujan"
#define WIFI_PASSWORD  "20010705"

// From your HiveMQ Cloud cluster page. Host only, no scheme.
#define MQTT_HOST      "ee8608044aae434e91c90dd9612c6ac1.s1.eu.hivemq.cloud"
#define MQTT_PORT      8883
#define MQTT_USERNAME  "BrainBots"
#define MQTT_PASSWORD  "BrainBots@2026"

// Must match MQTT_TOPIC_ROOT on the server.
#define TOPIC_ROOT     "bb/att"
#define DEVICE_ID      "reader1"

// 0 = accept any server certificate (fast to get running, but the connection
//     can be intercepted).
// 1 = verify against ISRG_ROOT_X1 below. Paste the certificate from
//     https://letsencrypt.org/certs/isrgrootx1.pem before switching this on.
#define USE_TLS_VALIDATION 0

// ------------------------------------------------------------------- pins --
// GPIO 2, 8 and 9 are strapping pins on the ESP32-C3 and are avoided here:
// pull-ups or an LED on those pins can stop the board from booting.
#define PIN_SDA     4
#define PIN_SCL     5
#define PIN_LED_OK  6    // green
#define PIN_LED_BAD 7    // red
#define PIN_BUZZER  10

// Only used if your PN532 board breaks these out. Leave unconnected otherwise.
#define PIN_PN532_IRQ   3
#define PIN_PN532_RESET 1

// Set to 0 if your buzzer sounds when the pin is LOW.
#define BUZZER_ACTIVE_HIGH 1

// --------------------------------------------------------------- timings --
#define OK_LED_MS        2000  // green LED on time
#define OK_BEEP_MS        150  // single beep on a good read
#define BAD_BEEP_MS       100  // each of the three beeps on a bad read
#define BAD_BEEP_GAP_MS   100
#define SAME_CARD_HOLD_MS 3000 // ignore the same card held against the reader
#define VERDICT_TIMEOUT_MS 1500 // how long a card the reader does not know waits for the server

// --------------------------------------------------------- offline storage --
// The reader keeps its own copy of every registered card and stores each tap
// in flash until the server confirms it, so it works with no internet.
#define MAX_QUEUE        400    // taps kept while offline (about 40 bytes each). The oldest is dropped when full.
#define UPLOAD_WINDOW      8    // stored taps sent at once without waiting for an answer
#define ACK_TIMEOUT_MS  6000    // send a stored tap again if the server has not confirmed it by then
#define WIFI_RETRY_MS  15000    // how often to retry Wi-Fi while it is down
#define MQTT_RETRY_MS   5000    // how often to retry the broker while it is down
#define HEARTBEAT_MS    3000    // "still here" message, so the dashboard shows the reader off within seconds
#define MQTT_KEEPALIVE_S  10    // the broker announces the reader offline after about 1.5x this with no traffic
#define CLOCK_SAVE_MS 600000    // how often the clock is saved to flash (10 minutes)
#define MIN_VALID_EPOCH 1700000000UL  // any clock reading below this means the clock is not set yet
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
