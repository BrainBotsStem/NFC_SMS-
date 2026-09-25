# Smart student attendance

ESP32-C3 SuperMini + PN532 card reader, a Node/Express + MongoDB server, and a React dashboard.
A student taps a card, the reader answers with a light and a beep straight away, and the arrival
is recorded. The reader keeps working when the internet is down and catches up when it returns.

```
PN532 --I2C--> ESP32-C3 --MQTT/TLS--> HiveMQ Cloud
               (flash: card list + stored taps)  |
                                            Express + MongoDB
                                                 |
                                           Socket.IO --> React dashboard
```

## How a tap is handled

The reader keeps a copy of every registered card in its own flash memory, so it decides on the spot
and never waits for the network. A card is read in well under a second, and the light and beep start
at once.

| Card | Reader | Recorded |
| --- | --- | --- |
| On the reader's list | Green LED 2s, one 150 ms beep | Stored in flash with its time, sent to the server, deleted from flash once the server confirms |
| Not on the list, server reachable | Asks the server. Refused: red LED, three 100 ms beeps | Nothing, unless the server knows the card (the list was out of date) |
| Not on the list, no network | Red LED, three beeps | Kept in flash and sent later, in case the list was out of date |
| List has never arrived, no network | Red LED 1s, no beeps | Kept in flash and sent later |

The last pattern exists so a network fault cannot be mistaken for a rejected card.

**Working offline.** Every tap is stamped with its real time and kept in flash (up to 400 taps, about
40 bytes each) until the server confirms it. When Wi-Fi and the broker are back, the reader sends its
backlog oldest first, and the server files each tap as if it had just happened, so the in and out
times are the same as they would have been online. Each tap has a unique id, so a tap that is sent
twice is only recorded once. A power cut loses nothing: stored taps and the card list survive a restart.

**The clock.** The reader gets the time from NTP, or from the server if NTP is blocked, and saves it
to flash every 10 minutes. If it restarts with no internet, taps are stamped from the last saved time
plus the time since power-on, and marked approximate. As soon as the real time is known, taps from
that power-on are corrected. Only a tap made after a restart, while the reader has never had the
correct time since, can be off, by however long the reader was switched off.

**The card list.** The server sends the list whenever a student is added or deleted, and again when it
starts. Only card numbers are sent, never names. It travels in one message, which holds about 900
cards. Above that the server logs an error.

**In and out times.** A batch can meet several times a day (for example 4 classes), and each class is
one row: the tap that starts it is the in time, the next tap at least 10 minutes later is the out time.
A tap after that starts the next class. Every tap gets the green light, because the card is valid:

| Tap | What happens |
| --- | --- |
| No class open | New row (the next class) with the in time |
| Under 10 minutes after the in time | Ignored, treated as a double tap |
| 10 minutes to 12 hours after the in time | Out time is set, the class is closed |
| Under 60 seconds after the out time | Ignored, treated as a double tap |
| 60 seconds or more after the out time | New row: the in time of the next class |
| Over 12 hours after an in time with no out | New row; the old one keeps a dash for Out |

A student who forgets to tap out of one class will have their next tap taken as that class's out time.
Change the limits with `OUT_MIN_MINUTES`, `REJOIN_MIN_SECONDS` and `VISIT_WINDOW_HOURS`.

## Student IDs

`Bb/EL/26/0101` — centre code, level (`EL`, `IL`, `AL`), intake year, number.

The number is a flat counter per level, starting at `0101`. Elementary 01 and Elementary 02 draw
from the same run, so Elementary 02's first student might be `Bb/EL/26/0117`. After `0199` comes
`0200`. The counter lives in its own collection and is incremented atomically, so two admins adding
students at the same moment cannot collide.

IDs are permanent. Moving a student to another batch does not change their ID, even across levels.

Run `npm test` in `server/` to check the ID rules and the timezone day boundary.

## Setup

**1. Server**

```bash
cd server
npm install
cp .env.example .env        # fill in MONGO_URI, JWT_SECRET, HiveMQ details
npm run seed                # creates the 8 batches + the admin account
npm start
```

The seed script never overwrites an existing account's password. Change the default passwords in
`.env` before the first run.

**2. Dashboard**

```bash
cd client
npm install
cp .env.example .env        # VITE_API_URL points at the server
npm run dev
```

**3. HiveMQ Cloud**

Create a cluster, add a username and password under Access Management, and put the host into both
`server/.env` (`MQTT_URL`, as `mqtts://host:8883`) and `firmware/esp32c3_reader/config.h`.

Topics, all under `MQTT_TOPIC_ROOT`:

| Topic | Direction | Payload |
| --- | --- | --- |
| `bb/att/reader1/scan` | reader to server | Stored tap: `{"uid":"A42B9F01","t":1789993042,"a":0,"id":"3f9a01c2-17"}`. Live tap: `{"uid":"A42B9F01","n":5}` |
| `bb/att/reader1/ack` | server to reader | `{"id":"3f9a01c2-17"}` the stored tap is safe, delete it |
| `bb/att/reader1/cmd` | server to reader | `{"result":"ok","n":5}` answer to a live tap |
| `bb/att/reader1/time` | server to reader | `{"t":1789993042}` the clock, for when NTP is blocked |
| `bb/att/reader1/status` | reader, retained | `online` / `offline` |
| `bb/att/roster` | server to readers, retained | `<version>\|UID,UID,...` every registered card |
| `bb/att/enrol` | server to readers | `{"open":1,"secs":60}` the enrolment window |

The device ID is in every topic, so a second reader is just a new `DEVICE_ID` in `config.h`.

**4. Firmware**

Arduino IDE, board **ESP32C3 Dev Module**, libraries **Adafruit PN532** and **PubSubClient**. Keep
`esp32c3_reader.ino` and `config.h` together in one sketch folder named `esp32c3_reader`. Fill in
`config.h` and flash. Use a partition scheme that includes SPIFFS/LittleFS space (the default does),
because the reader stores its card list and taps there.

The first time the reader connects, it downloads the card list. From then on it works without the
network. Watch the serial monitor: `[roster] 12 card(s)` means the list is stored, and
`[card] A42B9F01 ok in 0ms` shows a tap accepted.

## Wiring

Set the PN532 DIP switches to I2C. On the common red V3 board that is SEL0 on, SEL1 off — check the
table printed on the board.

| PN532 / part | ESP32-C3 |
| --- | --- |
| VCC | 5V |
| GND | GND |
| SDA | GPIO4 |
| SCL | GPIO5 |
| Green LED + 330R | GPIO6 |
| Red LED + 330R | GPIO7 |
| Buzzer | GPIO10 |

GPIO 2, 8 and 9 are deliberately unused. They are strapping pins on the ESP32-C3, and a pull-up or
an LED on them can stop the board from booting or entering flash mode.

The PN532 runs at 3.3V logic and carries its own I2C pull-ups, so no level shifter is needed. Power
it from 5V for the best read range; 3.3V works but the range drops. If your active buzzer draws more
than about 12 mA, drive it through an S8050 or 2N2222 rather than straight off the pin.

If the reader boots into a slow red blink, the PN532 was not found: check the DIP switches and SDA
and SCL.

## Enrolling a card

Admin presses **Add student**. That opens a 60-second window on the server. The next card read is
treated as a new card instead of an attendance tap, and its UID appears in the dashboard over
Socket.IO. The admin fills in the name and batch, and the server assigns the ID.

If the tapped card already belongs to someone, the reader rejects it and the dashboard names the
student who holds it.

While the window is open the server tells the reader, and the reader sends every tap to the server
live instead of judging it from its own list. That is how an already-registered card is refused
during enrolment. Enrolment needs the reader online. Once the student is saved, the server sends the
reader the updated card list.

## Sign-in

There is one role, **admin**. An admin sees the batch list and each batch's attendance rows, and
manages the student roll: search, edit, delete, and card enrolment. The account is created by the
seed script.

To change the admin username or password, run this in the project folder. No restart is needed:

```bash
npm run set-admin -- NEWNAME 'NEW-PASSWORD'
```

The password must be at least 8 characters. Editing `ADMIN_PASSWORD` in `.env` does not change an
existing account, because the seed script never overwrites one.

## Testing without hardware

With the server running, publish a scan by hand:

```bash
mosquitto_pub -h YOUR_HOST -p 8883 -u USER -P PASS --capath /etc/ssl/certs \
  -t 'bb/att/reader1/scan' -m '{"uid":"A42B9F01"}'
```

That is a live tap. Subscribe to `bb/att/reader1/cmd` in another terminal to see the verdict come
back. A UID that is not in the database returns `deny`; open the enrolment window in the dashboard
first and the same UID will be captured as a new card instead. To try a stored tap, add an `id`
and a time: `{"uid":"A42B9F01","t":1789993042,"id":"test-1"}`, and read `bb/att/reader1/ack`.

## Texts to parents

When a student taps in, their parent can get a text ("Priya (Bb/EL/26/0101) arrived at 9:05 AM"),
and another when they leave. Add the parent's mobile when enrolling a card, or later with Edit on the
Students page. The **Messages** page lists every text and what happened to it, and can send a test.

- `NOTIFY_PROVIDER`: `off`, `console` (written to the server log, nothing sent — for trying it out),
  or `notifylk` (real SMS through Notify.lk; fill in `NOTIFYLK_USER_ID`, `NOTIFYLK_API_KEY`,
  `NOTIFYLK_SENDER_ID`).
- `NOTIFY_MODE=daily` (default): one "arrived" per stay, and a "left" that waits
  `NOTIFY_OUT_DELAY_MINUTES` (20) and is dropped if the student taps in for the next class.
  `every`: a text for every in and out tap.
- A tap that reaches the server more than `NOTIFY_MAX_LATE_MINUTES` (60) late, because the reader was
  offline, is not texted. It shows as Skipped and can be sent by hand.
- Change the wording with `NOTIFY_TEMPLATE_IN` / `NOTIFY_TEMPLATE_OUT`
  (placeholders `{centre} {name} {id} {batch} {time} {date}`). Keep it under 160 characters; Tamil or
  other non-Latin text costs more, as each SMS then holds only 70 characters.

## Deliberately left out

Things that would be reasonable next steps, not built because they were not asked for:

- **Replacing a lost card.** Editing a student covers name and batch only. Today a lost card means
  deleting and re-adding the student, which loses their history and burns an ID. The enrolment
  window already does the hard part, so wiring it to an existing student is a small change.
- **An absent list.** A batch page shows who arrived, not who is missing. Comparing the roll against
  the day's rows would show both.
- **Attendance export** to CSV or Excel.
- **User management in the dashboard.** Accounts come from the seed script.
- **A distinct signal for in, out and ignored taps.** All three currently look identical on the
  reader. A different beep for the out tap would tell the student it was recorded.

## Notes

- Times are stored in UTC. The day a record belongs to is computed in `TZ_NAME`
  (`Asia/Colombo`), so a 7pm UTC tap is filed under the correct local date.
- The enrolment window is held in memory in one server process. Running more than one instance
  behind a load balancer would need it moved into MongoDB or Redis.
- `USE_TLS_VALIDATION` in `config.h` defaults to 0, which accepts any broker certificate. It gets
  you running quickly, but the connection can be intercepted. Paste the Let's Encrypt root from
  `letsencrypt.org/certs/isrgrootx1.pem` into the placeholder and set it to 1 before this goes live.
- Deleting a student deletes their attendance rows too.
